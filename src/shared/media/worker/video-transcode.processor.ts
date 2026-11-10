// src/shared/media/worker/video-transcode.processor.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — معالج تحويل الفيديو الخلفي (TRANSCODE_VIDEO)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §5)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { ProcessingStatus } from '@prisma/client';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FfprobeService,
  QualityVariantSpec,
  VideoInfo,
} from '../ffprobe.service';
import { computeFileDigest } from '../file-digest.util';
import {
  LocalFileDigest,
  ObjectStorageProvider,
  StorageProviderName,
} from '../object-storage.interface';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { evaluateWriteErrorSettlement } from '../r2-storage.provider';
import { StorageService } from '../storage.service';
import {
  computeHardVariantCapBytes,
  computeLiveRequiredFreeBytes,
  computePreStepRequiredFreeBytes,
  getVariantEncodingProfile,
  VideoMediaConfig,
  VideoQualityTier,
} from '../video-media.config';
import {
  ClaimedJobRow,
  JobLockContext,
  JobStepState,
  LeaseLostError,
  MAX_DISK_DEFERRALS,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';

export interface VariantRecord {
  storage_key: string;
  height: number;
  width: number;
  size_bytes: number;
  sha256: string;
  etag?: string;
  status: 'VERIFIED';
  verified_at: string;
}

export interface ThumbRecord {
  storage_key: string;
  size_bytes: number;
  sha256: string;
  etag?: string;
  status: 'VERIFIED';
  verified_at: string;
}

export interface SourceRecord {
  storage_key: string;
  ext: string;
  location: 'READY' | 'HOLD';
  size_bytes: number;
  sha256: string;
  etag?: string;
  status: 'VERIFIED';
  verified_at: string;
}

export interface VideoVariantsManifest {
  schema_version: 1;
  quality_ladder: number[];
  preferred_variant: VideoQualityTier;
  variants: Record<string, VariantRecord>;
  thumb?: ThumbRecord;
  source?: SourceRecord;
}

export interface TranscodeJobPayload {
  assetUuid: string;
  ownerType?: string;
  sourceKey?: string;
  contentType?: string;
  sizeBytes?: number;
  probe?: VideoInfo;
  qualityLadder?: number[];
  variantSpecs?: QualityVariantSpec[];
}

export class DiskPressureError extends Error {
  constructor(
    public readonly freeBytes: number,
    public readonly requiredBytes: number,
    public readonly stage: string,
  ) {
    super(
      `[DiskPressureError] مساحة القرص غير كافية في مرحلة ${stage}: المتاح=${freeBytes}B، المطلوب=${requiredBytes}B`,
    );
    this.name = 'DiskPressureError';
  }
}

export class VariantSizeLimitExceededError extends Error {
  constructor(
    public readonly quality: VideoQualityTier,
    public readonly actualBytes: number,
    public readonly hardCapBytes: number,
    public readonly wasFallbackProfile: boolean,
  ) {
    super(
      `[VARIANT_SIZE_LIMIT_EXCEEDED] حجم النسخة ${quality} (${actualBytes}B) تجاوز السقف الأقصى (${hardCapBytes}B) [fallback=${wasFallbackProfile}]`,
    );
    this.name = 'VariantSizeLimitExceededError';
  }
}

export class DeterministicTranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterministicTranscodeError';
  }
}

const ALL_QUALITY_TIERS: readonly VideoQualityTier[] = [
  '360p',
  '480p',
  '720p',
] as const;
const LIVE_DISK_WATCHDOG_INTERVAL_MS = 2_000;
const HEX_SHA256_RE = /^[a-f0-9]{64}$/;

export function parseVariantsManifest(
  raw: string | null | undefined,
  defaultLadder: number[] = [360],
): VideoVariantsManifest {
  const preferredDefault: VideoQualityTier = defaultLadder.includes(480)
    ? '480p'
    : '360p';
  if (!raw || raw.trim() === '') {
    return {
      schema_version: 1,
      quality_ladder: defaultLadder,
      preferred_variant: preferredDefault,
      variants: {},
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<VideoVariantsManifest>;
    if (parsed && typeof parsed === 'object') {
      const ladder = Array.isArray(parsed.quality_ladder)
        ? parsed.quality_ladder
        : defaultLadder;
      const preferred: VideoQualityTier =
        parsed.preferred_variant === '360p' ||
        parsed.preferred_variant === '480p' ||
        parsed.preferred_variant === '720p'
          ? parsed.preferred_variant
          : ladder.includes(480)
            ? '480p'
            : '360p';
      return {
        schema_version: 1,
        quality_ladder: ladder,
        preferred_variant: preferred,
        variants:
          parsed.variants && typeof parsed.variants === 'object'
            ? parsed.variants
            : {},
        thumb: parsed.thumb,
        source: parsed.source,
      };
    }
  } catch {
    // تجاهل JSON تالف
  }
  return {
    schema_version: 1,
    quality_ladder: defaultLadder,
    preferred_variant: preferredDefault,
    variants: {},
  };
}

@Injectable()
export class VideoTranscodeProcessor {
  private readonly logger = new Logger('VideoTranscodeProcessor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: VideoMediaConfig,
    private readonly storage: StorageService,
    private readonly storageRegistry: ObjectStorageRegistry,
    private readonly ffprobe: FfprobeService,
    private readonly queue: MediaJobQueueService,
  ) {}

  /**
   * تنفيذ دورة حياة مهمة TRANSCODE_VIDEO المسحوبة تحت قفل ctx.
   */
  async processClaimedJob(
    job: ClaimedJobRow,
    ctx: JobLockContext,
    externalAbortSignal?: AbortSignal,
  ): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: job.media_asset_id },
      include: { school: { select: { uuid: true } } },
    });

    if (!asset || asset.isDeleted) {
      await this.queue.runFencedMutation(ctx, async (tx) => {
        await tx.mediaProcessingJob.update({
          where: { id: ctx.jobId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            lockedBy: null,
            leaseUntil: null,
            lastError: 'ASSET_DELETED_OR_MISSING',
          },
        });
      });
      return;
    }

    const provider = this.storageRegistry.get(asset.storageProvider);
    const ownerPrefix =
      asset.ownerType === 'PLATFORM'
        ? 'platform'
        : (asset.school?.uuid ?? 'unknown-school');

    const payload = this.parsePayload(job.payload_json, asset.uuid);
    const ext = this.resolveSourceExtension(
      payload.sourceKey,
      payload.contentType,
    );
    const sourceKey =
      payload.sourceKey ?? `tmp/video-staging/${asset.uuid}/source.${ext}`;
    const sourcePath = this.storage.resolvePath(sourceKey);

    const stagingDir = this.storage.getVideoStagingDir(asset.uuid);
    const attemptDir = path.join(
      stagingDir,
      `attempt-f${ctx.fencingToken.toString()}`,
    );
    await fsp.mkdir(attemptDir, { recursive: true });

    // ── الخطوات 1-3 من بروتوكول عزل التخزين الخارجي (v1.7): التسجيل المسبق لجميع مفاتيح الجيل ──
    const buildGenerationKeys = (token: bigint): string[] => {
      const f = token.toString();
      return [
        `media/${ownerPrefix}/${asset.uuid}/f${f}/thumb.webp`,
        ...ALL_QUALITY_TIERS.map(
          (q) => `media/${ownerPrefix}/${asset.uuid}/f${f}/${q}.mp4`,
        ),
        `video-sources/ready/${ownerPrefix}/${asset.uuid}/f${f}/original.${ext}`,
        `video-sources/hold/${ownerPrefix}/${asset.uuid}/f${f}/original.${ext}`,
      ];
    };

    await this.queue.registerGenerationCandidateKeys(
      ctx,
      buildGenerationKeys(ctx.fencingToken),
      buildGenerationKeys,
    );

    const jobAbort = new AbortController();
    const onExternalAbort = (): void => {
      jobAbort.abort(
        externalAbortSignal?.reason ?? new Error('EXTERNAL_SHUTDOWN_ABORT'),
      );
    };
    if (externalAbortSignal) {
      if (externalAbortSignal.aborted) {
        onExternalAbort();
      } else {
        externalAbortSignal.addEventListener('abort', onExternalAbort, {
          once: true,
        });
      }
    }

    const tracker = {
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
    };
    let heartbeatAbortReason:
      | 'PROCESS_STALLED_TIMEOUT'
      | 'MAX_RUNTIME_EXCEEDED'
      | null = null;
    let leaseLostDuringHeartbeat: LeaseLostError | null = null;

    const heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          const hb = await this.queue.heartbeatIfProgressing(ctx, tracker);
          if (!hb.extended) {
            heartbeatAbortReason = hb.reason;
            jobAbort.abort(new Error(hb.reason));
          }
        } catch (err: unknown) {
          if (err instanceof LeaseLostError) {
            leaseLostDuringHeartbeat = err;
            jobAbort.abort(err);
          }
        }
      })();
    }, this.config.workerHeartbeatMs);
    heartbeatTimer.unref?.();

    const inFlightOperations = new Set<Promise<unknown>>();
    const trackOp = <T>(p: Promise<T>): Promise<T> => {
      inFlightOperations.add(p);
      p.finally(() => inFlightOperations.delete(p)).catch(() => undefined);
      return p;
    };

    try {
      await this.executeTranscodePipeline({
        ctx,
        asset,
        ownerPrefix,
        ext,
        sourcePath,
        attemptDir,
        payload,
        provider,
        jobAbort,
        tracker,
        trackOp,
      });

      // بعد اكتمال المهمة بنجاح (DONE): حذف مجلد video-staging المحلي وتشغيل ماسح الأجيال اليتيمة
      await this.storage.deleteVideoStagingDir(asset.uuid);
      await this.queue
        .sweepOrphanGenerationKeys(
          (name: StorageProviderName) => this.storageRegistry.get(name),
          { jobId: ctx.jobId },
        )
        .catch((sweepErr: unknown) => {
          this.logger.warn(
            `فشل التنظيف الفوري للأجيال بعد اكتمال المهمة #${ctx.jobId}: ${String(sweepErr)}`,
          );
        });
    } catch (caughtErr: unknown) {
      let effectiveErr: unknown = caughtErr;
      if (leaseLostDuringHeartbeat) {
        effectiveErr = leaseLostDuringHeartbeat;
      } else if (heartbeatAbortReason) {
        effectiveErr = new Error(heartbeatAbortReason);
      }

      // انتظار انتهاء أي عمليات فرعية جارية (بحد أقصى 10 ثوانٍ) قبل التنظيف
      if (inFlightOperations.size > 0) {
        await Promise.race([
          Promise.allSettled(Array.from(inFlightOperations)),
          new Promise((resolve) => setTimeout(resolve, 10_000)),
        ]);
      }

      // إذا كان الإلغاء بسبب الإيقاف الرشيق (SIGTERM/SIGINT): نحرر القفل دون زيادة attempt_count (+0)
      if (
        externalAbortSignal?.aborted &&
        !(effectiveErr instanceof LeaseLostError)
      ) {
        await this.queue.releaseOnGracefulShutdown(ctx).catch(() => undefined);
        return;
      }

      // إذا فُقد القفل لصالح عامل آخر: نتوقف فوراً ولا نلمس source.{ext} أو قاعدة البيانات
      if (effectiveErr instanceof LeaseLostError) {
        this.logger.warn(effectiveErr.message);
        return;
      }

      await this.handlePipelineError({
        err: effectiveErr,
        ctx,
        assetId: asset.id,
        assetUuid: asset.uuid,
        ownerPrefix,
        ext,
        sourcePath,
        provider,
      });
    } finally {
      clearInterval(heartbeatTimer);
      if (externalAbortSignal) {
        externalAbortSignal.removeEventListener('abort', onExternalAbort);
      }
      // حذف مجلد المحاولة المؤقت فقط (attempt-f{fencingToken}) دون المساس بـ source.{ext}
      await fsp
        .rm(attemptDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async executeTranscodePipeline(params: {
    ctx: JobLockContext;
    asset: {
      id: number;
      uuid: string;
      variantsJson: string | null;
      storageProvider: string;
    };
    ownerPrefix: string;
    ext: string;
    sourcePath: string;
    attemptDir: string;
    payload: TranscodeJobPayload;
    provider: ObjectStorageProvider;
    jobAbort: AbortController;
    tracker: { startedAt: number; lastProgressAt: number };
    trackOp: <T>(p: Promise<T>) => Promise<T>;
  }): Promise<void> {
    const {
      ctx,
      asset,
      ownerPrefix,
      ext,
      sourcePath,
      attemptDir,
      payload,
      provider,
      jobAbort,
      tracker,
      trackOp,
    } = params;

    // قراءة أحدث حالة للمهمة والأصل
    const snapshot = await this.queue.runFencedMutation(
      ctx,
      async (tx, jobRow) => {
        const freshAsset = await tx.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
          select: { variantsJson: true },
        });
        return {
          stepState: parseJobStepState(jobRow.step_state_json),
          variantsJson: freshAsset.variantsJson,
        };
      },
    );

    // فحص ملف المصدر عبر ffprobe (أو الاعتماد على الفحص المحفوظ إذا كانت كل الخطوات مكتملة سابقاً)
    let videoInfo: VideoInfo;
    let variantSpecs: QualityVariantSpec[];
    let qualityLadder: number[];

    const sourceExists = await this.fileExists(sourcePath);
    if (sourceExists) {
      const probeResult = await this.ffprobe.probe(sourcePath);
      if (!probeResult.valid || !probeResult.info) {
        throw new DeterministicTranscodeError(
          `INVALID_SOURCE_VIDEO: ${probeResult.errors.join('; ')}`,
        );
      }
      videoInfo = probeResult.info;
      variantSpecs = this.ffprobe.buildQualityVariantSpecs(videoInfo);
      qualityLadder = variantSpecs.map((s) => s.tierHeight);
    } else if (
      payload.probe &&
      Array.isArray(payload.variantSpecs) &&
      payload.variantSpecs.length > 0
    ) {
      videoInfo = payload.probe;
      variantSpecs = payload.variantSpecs;
      qualityLadder =
        payload.qualityLadder ?? variantSpecs.map((s) => s.tierHeight);
    } else {
      throw new DeterministicTranscodeError(
        `SOURCE_STAGING_FILE_MISSING: ${sourcePath}`,
      );
    }

    tracker.lastProgressAt = Date.now();

    let manifest = parseVariantsManifest(snapshot.variantsJson, qualityLadder);
    manifest.quality_ladder = qualityLadder;
    manifest.preferred_variant = qualityLadder.includes(480) ? '480p' : '360p';

    const f = ctx.fencingToken.toString();
    const plannedQualities = variantSpecs.map((s) => s.quality);

    // تسجيل خطة الجودات في step_state_json
    await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
      const st = parseJobStepState(jobRow.step_state_json);
      const nextSt: JobStepState = {
        ...st,
        plan: ['thumb', ...plannedQualities, 'source_ready'],
        source: st.source ?? 'LOCAL_STAGING',
      };
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: { stepStateJson: JSON.stringify(nextSt) },
      });
    });

    // ── الخطوة A: الصورة المصغرة (thumb.webp) ──
    const isThumbVerified = await this.isThumbAlreadyVerified(
      manifest.thumb,
      provider,
    );
    if (!isThumbVerified) {
      if (!sourceExists) {
        throw new DeterministicTranscodeError(
          'SOURCE_MISSING_BEFORE_THUMB_GENERATION',
        );
      }
      const thumbLocalPath = await trackOp(
        this.extractThumbnail(
          sourcePath,
          attemptDir,
          videoInfo,
          jobAbort.signal,
          tracker,
        ),
      );
      const thumbKey = `media/${ownerPrefix}/${asset.uuid}/f${f}/thumb.webp`;
      const uploadedThumb = await trackOp(
        this.uploadAndVerifyStepFile({
          ctx,
          provider,
          localFilePath: thumbLocalPath,
          targetKey: thumbKey,
          contentType: 'image/webp',
          jobAbortSignal: jobAbort.signal,
          tracker,
        }),
      );

      manifest = await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
        const freshAsset = await tx.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
          select: { variantsJson: true },
        });
        const curManifest = parseVariantsManifest(
          freshAsset.variantsJson,
          qualityLadder,
        );
        curManifest.quality_ladder = qualityLadder;
        curManifest.preferred_variant = qualityLadder.includes(480)
          ? '480p'
          : '360p';
        curManifest.thumb = {
          storage_key: thumbKey,
          size_bytes: uploadedThumb.digest.sizeBytes,
          sha256: uploadedThumb.digest.sha256Hex,
          etag: uploadedThumb.etag,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        };

        const st = parseJobStepState(jobRow.step_state_json);
        const nextSt: JobStepState = {
          ...st,
          thumb_verified: true,
        };

        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: {
            variantsJson: JSON.stringify(curManifest),
            rowVersion: { increment: 1 },
          },
        });
        await tx.mediaProcessingJob.update({
          where: { id: ctx.jobId },
          data: { stepStateJson: JSON.stringify(nextSt) },
        });
        return curManifest;
      });

      await fsp.unlink(thumbLocalPath).catch(() => undefined);
    }

    // ── الخطوة B: تحويل الجودات بالتسلسل (360p → 480p → 720p) ──
    for (const spec of variantSpecs) {
      const existingVariant = manifest.variants[spec.quality];
      const alreadyVerified = await this.isVariantAlreadyVerified(
        existingVariant,
        provider,
      );
      if (alreadyVerified) {
        tracker.lastProgressAt = Date.now();
        continue;
      }

      if (!sourceExists) {
        throw new DeterministicTranscodeError(
          `SOURCE_MISSING_BEFORE_VARIANT_${spec.quality}`,
        );
      }

      // فحص حالة fallback_profile لهذه الجودة
      const curState = await this.queue.runFencedMutation(ctx, (_tx, jobRow) =>
        Promise.resolve(parseJobStepState(jobRow.step_state_json)),
      );
      const useFallbackProfile = Boolean(
        curState.fallback_profile?.[spec.quality],
      );

      const variantLocalPath = await trackOp(
        this.encodeQualityVariant({
          sourcePath,
          attemptDir,
          spec,
          info: videoInfo,
          useFallbackProfile,
          jobAbortSignal: jobAbort.signal,
          tracker,
        }),
      );

      const variantKey = `media/${ownerPrefix}/${asset.uuid}/f${f}/${spec.quality}.mp4`;
      const uploadedVariant = await trackOp(
        this.uploadAndVerifyStepFile({
          ctx,
          provider,
          localFilePath: variantLocalPath,
          targetKey: variantKey,
          contentType: 'video/mp4',
          jobAbortSignal: jobAbort.signal,
          tracker,
        }),
      );

      manifest = await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
        const freshAsset = await tx.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
          select: { variantsJson: true },
        });
        const curManifest = parseVariantsManifest(
          freshAsset.variantsJson,
          qualityLadder,
        );
        curManifest.quality_ladder = qualityLadder;
        curManifest.preferred_variant = qualityLadder.includes(480)
          ? '480p'
          : '360p';
        curManifest.variants[spec.quality] = {
          storage_key: variantKey,
          height: spec.targetHeight,
          width: spec.targetWidth,
          size_bytes: uploadedVariant.digest.sizeBytes,
          sha256: uploadedVariant.digest.sha256Hex,
          etag: uploadedVariant.etag,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        };

        const st = parseJobStepState(jobRow.step_state_json);
        const nextSt: JobStepState = {
          ...st,
          variants_verified: {
            ...(st.variants_verified ?? {}),
            [spec.quality]: true,
          },
        };

        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: {
            variantsJson: JSON.stringify(curManifest),
            rowVersion: { increment: 1 },
          },
        });
        await tx.mediaProcessingJob.update({
          where: { id: ctx.jobId },
          data: { stepStateJson: JSON.stringify(nextSt) },
        });
        return curManifest;
      });

      await fsp.unlink(variantLocalPath).catch(() => undefined);
    }

    // ── الخطوة C: رفع الملف الأصلي إلى video-sources/ready/ والتحقق من SHA-256 ──
    const isSourceReadyVerified = await this.isSourceAlreadyVerified(
      manifest.source,
      'READY',
      provider,
    );
    if (!isSourceReadyVerified) {
      if (!sourceExists) {
        throw new DeterministicTranscodeError(
          'SOURCE_MISSING_BEFORE_READY_UPLOAD',
        );
      }
      const readyKey = `video-sources/ready/${ownerPrefix}/${asset.uuid}/f${f}/original.${ext}`;
      const sourceContentType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      const uploadedSource = await trackOp(
        this.uploadAndVerifyStepFile({
          ctx,
          provider,
          localFilePath: sourcePath,
          targetKey: readyKey,
          contentType: sourceContentType,
          jobAbortSignal: jobAbort.signal,
          tracker,
        }),
      );

      manifest = await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
        const freshAsset = await tx.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
          select: { variantsJson: true },
        });
        const curManifest = parseVariantsManifest(
          freshAsset.variantsJson,
          qualityLadder,
        );
        curManifest.quality_ladder = qualityLadder;
        curManifest.preferred_variant = qualityLadder.includes(480)
          ? '480p'
          : '360p';
        curManifest.source = {
          storage_key: readyKey,
          ext,
          location: 'READY',
          size_bytes: uploadedSource.digest.sizeBytes,
          sha256: uploadedSource.digest.sha256Hex,
          etag: uploadedSource.etag,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        };

        const st = parseJobStepState(jobRow.step_state_json);
        const nextSt: JobStepState = {
          ...st,
          source: 'READY',
        };

        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: {
            variantsJson: JSON.stringify(curManifest),
            rowVersion: { increment: 1 },
          },
        });
        await tx.mediaProcessingJob.update({
          where: { id: ctx.jobId },
          data: { stepStateJson: JSON.stringify(nextSt) },
        });
        return curManifest;
      });
    }

    // ── الخطوة D: بوابة الاعتماد النهائي (DONE Gate — §5.2) ──
    await this.assertDoneGateIntegrity(manifest, variantSpecs, provider);

    const preferredVariantRecord =
      manifest.variants[manifest.preferred_variant] ??
      manifest.variants['360p'];
    if (!preferredVariantRecord) {
      throw new DeterministicTranscodeError(
        'DONE_GATE_MISSING_PREFERRED_VARIANT',
      );
    }

    await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
      const st = parseJobStepState(jobRow.step_state_json);
      const registry = { ...(st.generations_registry ?? {}) };
      const nowIso = new Date().toISOString();

      // تعليم جميع الأجيال المسجلة ليتم فحصها وتنظيف مفاتيحها غير المعتمدة في الماسح
      for (const [tok, entry] of Object.entries(registry)) {
        if (entry.reconciliation_status === 'ACTIVE') {
          registry[tok] = {
            ...entry,
            reconciliation_status: 'PENDING_SWEEP',
            next_sweep_at: nowIso,
          };
        }
      }

      const nextSt: JobStepState = {
        ...st,
        source: 'READY',
        generations_registry: registry,
      };

      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          processingStatus: ProcessingStatus.DONE,
          preferredVariant: manifest.preferred_variant,
          storageKey: preferredVariantRecord.storage_key,
          sizeBytes: BigInt(preferredVariantRecord.size_bytes),
          sha256: preferredVariantRecord.sha256,
          etag: preferredVariantRecord.etag ?? null,
          width: videoInfo.width,
          height: videoInfo.height,
          durationSec: Math.ceil(videoInfo.durationSec),
          variantsJson: JSON.stringify(manifest),
          rowVersion: { increment: 1 },
        },
      });

      await tx.mediaUploadSession.updateMany({
        where: { mediaAssetId: asset.id },
        data: { processingStatus: ProcessingStatus.DONE },
      });

      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          lockedBy: null,
          leaseUntil: null,
          stepStateJson: JSON.stringify(nextSt),
          lastError: null,
        },
      });
    });
  }

  /**
   * البروتوكول السداسي لرفع ملف خطوة والتحقق من حجمه وبصمته SHA-256 وتسجيل نتيجة الاستقرار.
   */
  private async uploadAndVerifyStepFile(params: {
    ctx: JobLockContext;
    provider: ObjectStorageProvider;
    localFilePath: string;
    targetKey: string;
    contentType: string;
    jobAbortSignal: AbortSignal;
    tracker: { lastProgressAt: number };
  }): Promise<{ digest: LocalFileDigest; etag?: string }> {
    const {
      ctx,
      provider,
      localFilePath,
      targetKey,
      contentType,
      jobAbortSignal,
      tracker,
    } = params;

    const digest = await computeFileDigest(localFilePath);
    tracker.lastProgressAt = Date.now();

    // الخطوة 4: تسجيل write_initiated = true قبل إرسال البايتات
    await this.queue.markGenerationWriteInitiated(ctx, targetKey);

    const uploadTimeoutSignal = AbortSignal.timeout(
      this.config.uploadMaxDurationMs,
    );
    const combinedSignal = AbortSignal.any([
      jobAbortSignal,
      uploadTimeoutSignal,
    ]);
    const preWriteAborted = combinedSignal.aborted;

    try {
      const uploadRes = await provider.uploadFromFile(
        localFilePath,
        targetKey,
        {
          contentType,
          digest,
          abortSignal: combinedSignal,
          onProgress: () => {
            tracker.lastProgressAt = Date.now();
          },
        },
      );
      tracker.lastProgressAt = Date.now();

      // الخطوة 5: التحقق المتدفق من الحجم وبصمة SHA-256 للكائن المرفوع
      if (!uploadRes.verified) {
        const verifyRes = await provider.verifyStoredObjectSha256(
          targetKey,
          digest,
          { abortSignal: combinedSignal },
        );
        if (!verifyRes.ok) {
          throw new Error(
            `STORAGE_SHA256_VERIFICATION_FAILED (${targetKey}): ${verifyRes.reason ?? 'SHA256_MISMATCH'}`,
          );
        }
      }
      tracker.lastProgressAt = Date.now();

      // استقرار نهائي مؤكد بعد نجاح 2xx والتحقق من SHA-256
      await this.queue.markGenerationWriteOutcome(ctx, targetKey, {
        settled: true,
        reason: 'DEFINITIVE_SUCCESS',
      });

      return { digest, etag: uploadRes.etag ?? undefined };
    } catch (err: unknown) {
      const settlement = evaluateWriteErrorSettlement(err, {
        failedBeforeNetworkSend: preWriteAborted,
      });
      await this.queue
        .markGenerationWriteOutcome(ctx, targetKey, settlement)
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * استخراج الصورة المصغرة بصيغة WebP عبر ffmpeg (shell: false).
   */
  private async extractThumbnail(
    sourcePath: string,
    attemptDir: string,
    info: VideoInfo,
    abortSignal: AbortSignal,
    tracker: { lastProgressAt: number },
  ): Promise<string> {
    const partPath = path.join(attemptDir, 'thumb.part.webp');
    const finalPath = path.join(attemptDir, 'thumb.webp');

    const primarySeek = Math.min(1, Math.max(0, info.durationSec * 0.1));
    const seekCandidates = primarySeek > 0 ? [primarySeek, 0] : [0];

    for (const seekSec of seekCandidates) {
      await fsp.unlink(partPath).catch(() => undefined);
      const args = [
        '-y',
        '-ss',
        seekSec.toFixed(2),
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        '-vf',
        "scale='min(640,iw)':-2",
        '-c:v',
        'libwebp',
        '-lossless',
        '0',
        '-compression_level',
        '4',
        '-q:v',
        '75',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        partPath,
      ];

      await this.runFfmpegProcess({
        args,
        abortSignal,
        tracker,
      });

      const st = await fsp.stat(partPath).catch(() => null);
      if (st && st.size > 0) {
        await fsp.rename(partPath, finalPath);
        tracker.lastProgressAt = Date.now();
        return finalPath;
      }
    }

    throw new Error('THUMBNAIL_EXTRACTION_EMPTY_OUTPUT');
  }

  /**
   * تحويل نسخة جودة واحدة (360p / 480p / 720p) مع حارس مساحة القرص الحي وسقف الحجم الأقصى.
   */
  private async encodeQualityVariant(params: {
    sourcePath: string;
    attemptDir: string;
    spec: QualityVariantSpec;
    info: VideoInfo;
    useFallbackProfile: boolean;
    jobAbortSignal: AbortSignal;
    tracker: { lastProgressAt: number };
  }): Promise<string> {
    const {
      sourcePath,
      attemptDir,
      spec,
      info,
      useFallbackProfile,
      jobAbortSignal,
      tracker,
    } = params;

    // 1. فحص مساحة القرص قبل بدء الخطوة (Pre-Step Check — v1.7 §3)
    // تُمرَّر حدود العامل من VideoMediaConfig (MEDIA_WORKER_*) بدلاً من الثوابت الافتراضية
    const minFreeFloorBytes = this.config.workerMinFreeBytes;
    const liveFloorBytes = this.config.workerLiveMinFreeBytes;
    const maxVariantBytes = this.config.workerMaxVariantBytes;
    const preStepRequired = computePreStepRequiredFreeBytes(
      spec.quality,
      info.durationSec,
      minFreeFloorBytes,
      liveFloorBytes,
      maxVariantBytes,
    );
    const initialFreeBytes = await this.getFreeDiskBytes();
    if (initialFreeBytes < preStepRequired) {
      throw new DiskPressureError(
        initialFreeBytes,
        preStepRequired,
        `pre-step:${spec.quality}`,
      );
    }

    const profile = getVariantEncodingProfile(spec.quality, useFallbackProfile);
    const hardCapBytes = computeHardVariantCapBytes(
      spec.quality,
      info.durationSec,
      maxVariantBytes,
    );

    const partPath = path.join(attemptDir, `${spec.quality}.part.mp4`);
    const finalPath = path.join(attemptDir, `${spec.quality}.mp4`);
    await fsp.unlink(partPath).catch(() => undefined);

    const targetFps = Math.min(30, Math.max(1, Math.round(info.fps || 30)));
    const vfFilter = `scale=${spec.targetWidth}:${spec.targetHeight},fps=${targetFps}`;

    const audioArgs = info.isSilent
      ? ['-an']
      : [
          '-map',
          '0:a:0?',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ac',
          '2',
          '-ar',
          '48000',
        ];

    // ضبط FFmpeg من VideoMediaConfig: خيوط المفكّك (قبل -i) والفلتر والمشفّر كلٌّ على حدة
    const tuning = this.config.ffmpegTuning;
    const decodeThreadArgs =
      tuning.decodeThreads > 0
        ? ['-threads', String(tuning.decodeThreads)]
        : [];

    const args = [
      '-y',
      ...decodeThreadArgs,
      '-i',
      sourcePath,
      '-progress',
      'pipe:1',
      '-nostats',
      '-threads',
      String(tuning.encoderThreads),
      '-filter_threads',
      String(tuning.filterThreads),
      '-map',
      '0:v:0',
      ...audioArgs,
      '-vf',
      vfFilter,
      '-c:v',
      'libx264',
      '-preset',
      tuning.preset,
      '-profile:v',
      'main',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      String(profile.crf),
      '-maxrate',
      `${profile.maxrateKbps}k`,
      '-bufsize',
      `${profile.bufsizeKbps}k`,
      '-movflags',
      '+faststart',
      partPath,
    ];

    const stepAbort = new AbortController();
    const combinedSignal = AbortSignal.any([jobAbortSignal, stepAbort.signal]);
    let watchdogError: Error | null = null;
    let latestReportedSize = 0;

    const checkLiveConstraints = async (
      reportedBytes?: number,
    ): Promise<void> => {
      if (watchdogError) return;
      if (reportedBytes !== undefined && reportedBytes > latestReportedSize) {
        latestReportedSize = reportedBytes;
      }
      const statSize = await fsp
        .stat(partPath)
        .then((s) => s.size)
        .catch(() => 0);
      const currentPartBytes = Math.max(statSize, latestReportedSize);

      // فحص السقف الأقصى لحجم النسخة (V_hard_cap)
      if (currentPartBytes > hardCapBytes) {
        watchdogError = new VariantSizeLimitExceededError(
          spec.quality,
          currentPartBytes,
          hardCapBytes,
          useFallbackProfile,
        );
        stepAbort.abort(watchdogError);
        return;
      }

      // فحص مساحة القرص الحية (Live Watchdog بدون حساب مزدوج)
      const freeBytes = await this.getFreeDiskBytes();
      const liveRequired = computeLiveRequiredFreeBytes(
        spec.quality,
        info.durationSec,
        currentPartBytes,
        liveFloorBytes,
        maxVariantBytes,
      );
      if (freeBytes < liveRequired) {
        watchdogError = new DiskPressureError(
          freeBytes,
          liveRequired,
          `live-watchdog:${spec.quality}`,
        );
        stepAbort.abort(watchdogError);
      }
    };

    const watchdogTimer = setInterval(() => {
      void checkLiveConstraints();
    }, LIVE_DISK_WATCHDOG_INTERVAL_MS);
    watchdogTimer.unref?.();

    try {
      await this.runFfmpegProcess({
        args,
        abortSignal: combinedSignal,
        tracker,
        onTotalSizeProgress: (bytes) => {
          void checkLiveConstraints(bytes);
        },
      });

      // فحص أخير بعد اكتمال عملية ffmpeg مباشرة
      await checkLiveConstraints();
      const postFfmpegWatchdogErr = watchdogError as Error | null;
      if (postFfmpegWatchdogErr) {
        throw postFfmpegWatchdogErr;
      }

      const finalStat = await fsp.stat(partPath).catch(() => null);
      if (!finalStat || finalStat.size <= 0) {
        throw new Error(`FFMPEG_EMPTY_VARIANT_OUTPUT:${spec.quality}`);
      }
      if (finalStat.size > hardCapBytes) {
        throw new VariantSizeLimitExceededError(
          spec.quality,
          finalStat.size,
          hardCapBytes,
          useFallbackProfile,
        );
      }

      await fsp.rename(partPath, finalPath);
      tracker.lastProgressAt = Date.now();
      return finalPath;
    } catch (err: unknown) {
      await fsp.unlink(partPath).catch(() => undefined);
      const caughtWatchdogErr = watchdogError as Error | null;
      if (caughtWatchdogErr) {
        throw caughtWatchdogErr;
      }
      throw err;
    } finally {
      clearInterval(watchdogTimer);
    }
  }

  /**
   * تشغيل عملية ffmpeg فرعية عبر spawn (shell: false) مع مراقبة التقدم الفعلي (-progress pipe:1)
   * وربط حياة عملية ffmpeg الفرعية بحياة عامل Node الأب (POSIX Pipe-EOF Parent-Death Tether — F-7B-3)
   * لمنع بقاء عملية ffmpeg يتيمة (ppid=1) إذا قُتل العامل الأب بـ SIGKILL أو OOM-Killer.
   */
  protected runFfmpegProcess(params: {
    args: string[];
    abortSignal: AbortSignal;
    tracker: { lastProgressAt: number };
    onTotalSizeProgress?: (totalSizeBytes: number) => void;
    onSpawn?: (pid: number) => void;
  }): Promise<void> {
    const { args, abortSignal, tracker, onTotalSizeProgress, onSpawn } = params;

    return new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(
          abortSignal.reason instanceof Error
            ? abortSignal.reason
            : new Error('FFMPEG_ABORTED_BEFORE_START'),
        );
        return;
      }

      const child = spawn(this.config.ffmpegBin, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const ffmpegPid = child.pid;
      if (typeof ffmpegPid === 'number' && ffmpegPid > 0) {
        onSpawn?.(ffmpegPid);
      }

      // حارس ربط حياة ffmpeg بعامل Node الأب عبر أنبوب POSIX (Pipe-EOF Tether):
      // يتجاهل ffmpeg إشارة SIGPIPE افتراضياً، لذا إذا قُتل عامل Node بـ SIGKILL (kill -9)
      // يغلق نظام التشغيل طرف الكتابة لهذا الأنبوب فوراً، فيستيقظ الحارس على EOF ويقتل ffmpegPid خلال أجزاء من الثانية.
      let parentDeathTether: ReturnType<typeof spawn> | null = null;
      if (
        typeof ffmpegPid === 'number' &&
        ffmpegPid > 0 &&
        process.platform !== 'win32'
      ) {
        try {
          parentDeathTether = spawn(
            '/bin/sh',
            [
              '-c',
              'read line || true; if [ "$line" != "CLEAN" ]; then kill -9 "$1" 2>/dev/null || true; fi',
              '--',
              String(ffmpegPid),
            ],
            {
              shell: false,
              stdio: ['pipe', 'ignore', 'ignore'],
              detached: true,
            },
          );
          parentDeathTether.unref();
          parentDeathTether.stdin?.on('error', () => undefined);
          parentDeathTether.on('error', () => undefined);
        } catch {
          parentDeathTether = null;
        }
      }

      let tetherDisarmed = false;
      const disarmTether = (): void => {
        if (tetherDisarmed) return;
        tetherDisarmed = true;
        if (!parentDeathTether) return;
        try {
          parentDeathTether.stdin?.end('CLEAN\n');
        } catch {
          try {
            parentDeathTether.kill('SIGKILL');
          } catch {
            // تجاهل
          }
        }
        parentDeathTether = null;
      };

      let lastFrame = -1;
      let lastOutTimeUs = -1;
      let lastTotalSize = -1;
      let stdoutRemainder = '';
      let stderrTail = '';

      const onAbort = (): void => {
        disarmTether();
        try {
          child.kill('SIGKILL');
        } catch {
          // تجاهل
        }
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutRemainder += chunk.toString('utf8');
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          const eqIdx = line.indexOf('=');
          if (eqIdx <= 0) continue;
          const key = line.slice(0, eqIdx).trim();
          const valStr = line.slice(eqIdx + 1).trim();

          if (key === 'frame') {
            const frame = Number(valStr);
            if (Number.isFinite(frame) && frame > lastFrame) {
              lastFrame = frame;
              tracker.lastProgressAt = Date.now();
            }
          } else if (key === 'out_time_us' || key === 'out_time_ms') {
            const outUs = Number(valStr);
            if (Number.isFinite(outUs) && outUs > lastOutTimeUs) {
              lastOutTimeUs = outUs;
              tracker.lastProgressAt = Date.now();
            }
          } else if (key === 'total_size') {
            const totalSize = Number(valStr);
            if (Number.isFinite(totalSize) && totalSize > lastTotalSize) {
              lastTotalSize = totalSize;
              tracker.lastProgressAt = Date.now();
              onTotalSizeProgress?.(totalSize);
            }
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
      });

      child.on('error', (err) => {
        abortSignal.removeEventListener('abort', onAbort);
        disarmTether();
        reject(err);
      });

      child.on('close', (code, signal) => {
        abortSignal.removeEventListener('abort', onAbort);
        disarmTether();
        if (abortSignal.aborted) {
          reject(
            abortSignal.reason instanceof Error
              ? abortSignal.reason
              : new Error('FFMPEG_ABORTED'),
          );
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `FFMPEG_EXIT_ERROR (code=${String(code)}, signal=${String(signal)}): ${stderrTail.trim()}`,
          ),
        );
      });
    });
  }

  /**
   * معالجة أخطاء المعالجة وفق القواعد الصارمة لـ v1.7:
   * - DiskPressureError → تأجيل (RETRYING) مع attempt_count + 0 (حتى MAX_DISK_DEFERRALS).
   * - VariantSizeLimitExceededError → تفعيل fallback_profile (CRF 28) للمرة الأولى (+1 attempt)، أو الفشل الحتمي في المرة الثانية.
   * - الفشل النهائي (FAILED) → رفع source.{ext} إلى video-sources/hold/ والتحقق من SHA-256 قبل حذف المحلي.
   */
  private async handlePipelineError(params: {
    err: unknown;
    ctx: JobLockContext;
    assetId: number;
    assetUuid: string;
    ownerPrefix: string;
    ext: string;
    sourcePath: string;
    provider: ObjectStorageProvider;
  }): Promise<void> {
    const {
      err,
      ctx,
      assetId,
      assetUuid,
      ownerPrefix,
      ext,
      sourcePath,
      provider,
    } = params;

    try {
      // 1. حالة ضغط مساحة القرص المؤقت (DISK_PRESSURE)
      if (err instanceof DiskPressureError) {
        const snapshot = await this.queue.runFencedMutation(
          ctx,
          (_tx, jobRow) =>
            Promise.resolve(parseJobStepState(jobRow.step_state_json)),
        );
        const currentDeferrals = snapshot.disk_deferral_count ?? 0;
        if (currentDeferrals + 1 < MAX_DISK_DEFERRALS) {
          await this.queue.deferOnDiskPressure(ctx, err.message);
          return;
        }
        // تجاوز الحد الأقصى للتأجيل بسبب القرص (10 مرات) → يعامَل كفشل محاولة فعلي
      }

      // 2. حالة تجاوز السقف الأقصى لحجم النسخة (VARIANT_SIZE_LIMIT_EXCEEDED)
      let forceTerminalFailure = err instanceof DeterministicTranscodeError;
      let stepStatePatch: Partial<JobStepState> | undefined;

      if (err instanceof VariantSizeLimitExceededError) {
        if (!err.wasFallbackProfile) {
          const snapshot = await this.queue.runFencedMutation(
            ctx,
            (_tx, jobRow) =>
              Promise.resolve(parseJobStepState(jobRow.step_state_json)),
          );
          stepStatePatch = {
            fallback_profile: {
              ...(snapshot.fallback_profile ?? {}),
              [err.quality]: true,
            },
          };
          forceTerminalFailure = false;
        } else {
          forceTerminalFailure = true;
        }
      }

      const errorReason = err instanceof Error ? err.message : String(err);

      // فحص ما إذا كانت هذه المحاولة ستؤدي إلى فشل نهائي (FAILED)
      const jobSnapshot = await this.queue.runFencedMutation(
        ctx,
        (_tx, jobRow) => Promise.resolve(jobRow),
      );
      const willBeTerminal =
        forceTerminalFailure ||
        jobSnapshot.attempt_count + 1 >= jobSnapshot.max_attempts;

      let holdVerifiedOnStorage = false;
      let holdRecord: SourceRecord | null = null;

      if (willBeTerminal) {
        const holdOutcome = await this.tryUploadSourceToHold({
          ctx,
          assetUuid,
          ownerPrefix,
          ext,
          sourcePath,
          provider,
        });
        holdVerifiedOnStorage = holdOutcome.verified;
        holdRecord = holdOutcome.record;
      }

      const result = await this.queue.failOrRetryJob(ctx, errorReason, {
        forceTerminalFailure,
        stepStatePatch,
        onBeforeTerminalFailure: async (tx, _jobRow, nextState) => {
          const freshAsset = await tx.mediaAsset.findUnique({
            where: { id: assetId },
            select: { variantsJson: true },
          });
          const curManifest = parseVariantsManifest(freshAsset?.variantsJson);
          if (holdRecord) {
            curManifest.source = holdRecord;
          }

          await tx.mediaAsset.update({
            where: { id: assetId },
            data: {
              processingStatus: ProcessingStatus.ERROR,
              variantsJson: JSON.stringify(curManifest),
              rowVersion: { increment: 1 },
            },
          });
          await tx.mediaUploadSession.updateMany({
            where: { mediaAssetId: assetId },
            data: {
              processingStatus: ProcessingStatus.ERROR,
              lastError: errorReason.slice(0, 2000),
            },
          });

          return {
            ...nextState,
            source: holdVerifiedOnStorage
              ? 'HOLD'
              : (nextState.source ?? 'LOCAL_STAGING'),
          };
        },
      });

      // لا نحذف مجلد video-staging المحلي عند الفشل النهائي إلا إذا تأكد رفع source.{ext} إلى hold/ والتحقق من SHA-256!
      if (result.status === 'FAILED' && holdVerifiedOnStorage) {
        await this.storage.deleteVideoStagingDir(assetUuid);
      }

      await this.queue
        .sweepOrphanGenerationKeys(
          (name: StorageProviderName) => this.storageRegistry.get(name),
          { jobId: ctx.jobId },
        )
        .catch(() => undefined);
    } catch (innerErr: unknown) {
      if (innerErr instanceof LeaseLostError) {
        this.logger.warn(innerErr.message);
        return;
      }
      this.logger.error(
        `فشل في معالجة خطأ المهمة #${ctx.jobId}: ${String(innerErr)}`,
      );
    }
  }

  /**
   * رفع الملف الأصلي إلى video-sources/hold/ عند الفشل النهائي والتحقق من SHA-256.
   * إذا فشل الرفع إلى hold/، يُحافظ على الملف المحلي في video-staging ولا يُحذف أبداً.
   */
  private async tryUploadSourceToHold(params: {
    ctx: JobLockContext;
    assetUuid: string;
    ownerPrefix: string;
    ext: string;
    sourcePath: string;
    provider: ObjectStorageProvider;
  }): Promise<{ verified: boolean; record: SourceRecord | null }> {
    const { ctx, assetUuid, ownerPrefix, ext, sourcePath, provider } = params;
    const exists = await this.fileExists(sourcePath);
    if (!exists) {
      return { verified: false, record: null };
    }

    const f = ctx.fencingToken.toString();
    const holdKey = `video-sources/hold/${ownerPrefix}/${assetUuid}/f${f}/original.${ext}`;
    const contentType = ext === 'mov' ? 'video/quicktime' : 'video/mp4';

    try {
      const uploaded = await this.uploadAndVerifyStepFile({
        ctx,
        provider,
        localFilePath: sourcePath,
        targetKey: holdKey,
        contentType,
        jobAbortSignal: new AbortController().signal,
        tracker: { lastProgressAt: Date.now() },
      });
      return {
        verified: true,
        record: {
          storage_key: holdKey,
          ext,
          location: 'HOLD',
          size_bytes: uploaded.digest.sizeBytes,
          sha256: uploaded.digest.sha256Hex,
          etag: uploaded.etag,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        },
      };
    } catch (holdErr: unknown) {
      this.logger.error(
        `تعذّر رفع الملف الأصلي إلى hold/ للأصل ${assetUuid} (سيبقى محفوظاً في video-staging المحلي): ${String(holdErr)}`,
      );
      return { verified: false, record: null };
    }
  }

  // ── فحوصات التحقق والاستئناف وبوابة DONE ──

  private async isThumbAlreadyVerified(
    thumb: ThumbRecord | undefined,
    provider: ObjectStorageProvider,
  ): Promise<boolean> {
    if (
      !thumb ||
      thumb.status !== 'VERIFIED' ||
      !thumb.storage_key ||
      thumb.size_bytes <= 0 ||
      !HEX_SHA256_RE.test(thumb.sha256)
    ) {
      return false;
    }
    const head = await provider.headObject(thumb.storage_key);
    if (head.kind !== 'FOUND') return false;
    if (head.info.sizeBytes !== thumb.size_bytes) return false;
    if (thumb.etag && head.info.etag !== thumb.etag) return false;
    return true;
  }

  private async isVariantAlreadyVerified(
    variant: VariantRecord | undefined,
    provider: ObjectStorageProvider,
  ): Promise<boolean> {
    if (
      !variant ||
      variant.status !== 'VERIFIED' ||
      !variant.storage_key ||
      variant.size_bytes <= 0 ||
      !HEX_SHA256_RE.test(variant.sha256)
    ) {
      return false;
    }
    const head = await provider.headObject(variant.storage_key);
    if (head.kind !== 'FOUND') return false;
    if (head.info.sizeBytes !== variant.size_bytes) return false;
    if (variant.etag && head.info.etag !== variant.etag) return false;
    return true;
  }

  private async isSourceAlreadyVerified(
    source: SourceRecord | undefined,
    expectedLocation: 'READY' | 'HOLD',
    provider: ObjectStorageProvider,
  ): Promise<boolean> {
    if (
      !source ||
      source.status !== 'VERIFIED' ||
      source.location !== expectedLocation ||
      !source.storage_key ||
      source.size_bytes <= 0 ||
      !HEX_SHA256_RE.test(source.sha256)
    ) {
      return false;
    }
    const head = await provider.headObject(source.storage_key);
    if (head.kind !== 'FOUND') return false;
    if (head.info.sizeBytes !== source.size_bytes) return false;
    if (source.etag && head.info.etag !== source.etag) return false;
    return true;
  }

  private async assertDoneGateIntegrity(
    manifest: VideoVariantsManifest,
    variantSpecs: QualityVariantSpec[],
    provider: ObjectStorageProvider,
  ): Promise<void> {
    if (!(await this.isThumbAlreadyVerified(manifest.thumb, provider))) {
      throw new Error('DONE_GATE_FAILED: thumb غير متحقق منه في التخزين');
    }
    for (const spec of variantSpecs) {
      const v = manifest.variants[spec.quality];
      if (!(await this.isVariantAlreadyVerified(v, provider))) {
        throw new Error(
          `DONE_GATE_FAILED: النسخة ${spec.quality} غير متحقق منها في التخزين`,
        );
      }
    }
    if (
      !(await this.isSourceAlreadyVerified(manifest.source, 'READY', provider))
    ) {
      throw new Error(
        'DONE_GATE_FAILED: ملف المصدر في ready/ غير متحقق منه في التخزين',
      );
    }
  }

  protected async getFreeDiskBytes(): Promise<number> {
    const stat = await fsp.statfs(this.storage.getBasePath());
    return Number(stat.bavail) * Number(stat.bsize);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private parsePayload(
    raw: string | null,
    fallbackAssetUuid: string,
  ): TranscodeJobPayload {
    if (!raw) return { assetUuid: fallbackAssetUuid };
    try {
      const parsed = JSON.parse(raw) as Partial<TranscodeJobPayload>;
      return {
        ...parsed,
        assetUuid: parsed.assetUuid ?? fallbackAssetUuid,
      };
    } catch {
      return { assetUuid: fallbackAssetUuid };
    }
  }

  private resolveSourceExtension(
    sourceKey?: string,
    contentType?: string,
  ): 'mp4' | 'mov' {
    if (sourceKey?.toLowerCase().endsWith('.mov')) return 'mov';
    if (contentType?.toLowerCase() === 'video/quicktime') return 'mov';
    return 'mp4';
  }
}
