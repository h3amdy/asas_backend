// src/shared/media/worker/move-source.processor.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — معالج نقل الملف الأصلي بين ready/ و hold/ (MOVE_SOURCE)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §5.2)
//        p4-4-design-and-audit.md (v1.7 §6)
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LocalFileDigest,
  ObjectStorageProvider,
  StorageProviderName,
} from '../object-storage.interface';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { evaluateWriteErrorSettlement } from '../r2-storage.provider';
import { VideoMediaConfig } from '../video-media.config';
import {
  ClaimedJobRow,
  JobLockContext,
  JobStepState,
  LeaseLostError,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';
import { parseVariantsManifest } from './video-transcode.processor';

export interface MoveSourceJobPayload {
  assetUuid?: string;
  targetLocation: 'READY' | 'HOLD';
}

const HEX_SHA256_RE = /^[a-f0-9]{64}$/;

@Injectable()
export class MoveSourceProcessor {
  private readonly logger = new Logger('MoveSourceProcessor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: VideoMediaConfig,
    private readonly storageRegistry: ObjectStorageRegistry,
    private readonly queue: MediaJobQueueService,
  ) {}

  /**
   * تنفيذ دورة حياة مهمة MOVE_SOURCE المسحوبة تحت قفل ctx.
   * يضمن الذرّية الكاملة عبر 4 نقاط انهيار محتملة:
   *   1) INIT: قبل اكتمال النسخ أو التحقق من SHA-256.
   *   2) COPIED: بعد النسخ وقبل تحديث DB (يُنظَّف المفتاح اليتيم عبر generations_registry).
   *   3) DB_COMMITTED: بعد تحديث DB وقبل حذف المفتاح القديم (يُستأنف بحذف المفتاح القديم فقط دون إعادة النسخ).
   *   4) فشل حذف المفتاح القديم: يعيد المحاولة حتى يتأكد headObject(oldKey) === NOT_FOUND.
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

    const payload = this.parsePayload(job.payload_json);
    const targetLocation = payload.targetLocation;
    const targetLocationLower = targetLocation === 'HOLD' ? 'hold' : 'ready';
    const ownerPrefix =
      asset.ownerType === 'PLATFORM'
        ? 'platform'
        : (asset.school?.uuid ?? 'unknown-school');

    const manifestInitial = parseVariantsManifest(asset.variantsJson);
    const ext = manifestInitial.source?.ext === 'mov' ? 'mov' : 'mp4';

    const buildGenerationKeys = (token: bigint): string[] => {
      const f = token.toString();
      return [
        `video-sources/${targetLocationLower}/${ownerPrefix}/${asset.uuid}/f${f}/original.${ext}`,
      ];
    };

    // الخطوات 1-3: التسجيل المسبق الإلزامي لمفتاح الوجهة في generations_registry
    await this.queue.registerGenerationCandidateKeys(
      ctx,
      buildGenerationKeys(ctx.fencingToken),
      buildGenerationKeys,
    );

    const provider = this.storageRegistry.get(asset.storageProvider);
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

    const heartbeatTimer = setInterval(() => {
      void (async () => {
        try {
          const hb = await this.queue.heartbeatIfProgressing(ctx, tracker);
          if (!hb.extended) {
            jobAbort.abort(new Error(hb.reason));
          }
        } catch (err: unknown) {
          if (err instanceof LeaseLostError) {
            jobAbort.abort(err);
          }
        }
      })();
    }, this.config.workerHeartbeatMs);
    heartbeatTimer.unref?.();

    try {
      await this.executeMoveSource({
        ctx,
        assetId: asset.id,
        assetUuid: asset.uuid,
        ownerPrefix,
        ext,
        targetLocation,
        targetLocationLower,
        provider,
        jobAbortSignal: jobAbort.signal,
        tracker,
      });

      await this.queue
        .sweepOrphanGenerationKeys(
          (name: StorageProviderName) => this.storageRegistry.get(name),
          { jobId: ctx.jobId },
        )
        .catch(() => undefined);
    } catch (err: unknown) {
      if (externalAbortSignal?.aborted && !(err instanceof LeaseLostError)) {
        await this.queue.releaseOnGracefulShutdown(ctx).catch(() => undefined);
        return;
      }
      if (err instanceof LeaseLostError) {
        this.logger.warn(err.message);
        return;
      }
      const reason = err instanceof Error ? err.message : String(err);
      await this.queue.failOrRetryJob(ctx, reason).catch((failErr: unknown) => {
        if (!(failErr instanceof LeaseLostError)) {
          this.logger.error(
            `فشل تحديث حالة مهمة MOVE_SOURCE #${ctx.jobId}: ${String(failErr)}`,
          );
        }
      });
    } finally {
      clearInterval(heartbeatTimer);
      if (externalAbortSignal) {
        externalAbortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private async executeMoveSource(params: {
    ctx: JobLockContext;
    assetId: number;
    assetUuid: string;
    ownerPrefix: string;
    ext: string;
    targetLocation: 'READY' | 'HOLD';
    targetLocationLower: 'ready' | 'hold';
    provider: ObjectStorageProvider;
    jobAbortSignal: AbortSignal;
    tracker: { lastProgressAt: number };
  }): Promise<void> {
    const {
      ctx,
      assetId,
      assetUuid,
      ownerPrefix,
      ext,
      targetLocation,
      targetLocationLower,
      provider,
      jobAbortSignal,
      tracker,
    } = params;

    const snapshot = await this.queue.runFencedMutation(
      ctx,
      async (tx, jobRow) => {
        const freshAsset = await tx.mediaAsset.findUniqueOrThrow({
          where: { id: assetId },
          select: { variantsJson: true },
        });
        return {
          stepState: parseJobStepState(jobRow.step_state_json),
          manifest: parseVariantsManifest(freshAsset.variantsJson),
        };
      },
    );

    const sourceRec = snapshot.manifest.source;
    if (
      !sourceRec ||
      !sourceRec.storage_key ||
      sourceRec.size_bytes <= 0 ||
      !HEX_SHA256_RE.test(sourceRec.sha256)
    ) {
      throw new Error(
        'MOVE_SOURCE_INVALID_SOURCE_MANIFEST: بيانات الملف الأصلي أو بصمته SHA-256 غير مكتملة',
      );
    }

    const expectedDigest: LocalFileDigest = {
      sizeBytes: sourceRec.size_bytes,
      sha256Hex: sourceRec.sha256,
      sha256Base64: Buffer.from(sourceRec.sha256, 'hex').toString('base64'),
    };

    const timeoutSignal = AbortSignal.timeout(this.config.uploadMaxDurationMs);
    const combinedSignal = AbortSignal.any([jobAbortSignal, timeoutSignal]);

    // ── الحالة 1: إذا كانت قاعدة البيانات قد اعتمدت المفتاح الجديد سابقاً (DB_COMMITTED أو location === targetLocation) ──
    if (
      snapshot.stepState.move_source_phase === 'DB_COMMITTED' ||
      sourceRec.location === targetLocation
    ) {
      // التحقق من سلامة المفتاح المعتمد حالياً في الوجهة قبل حذف القديم
      await this.assertObjectIntegrity(
        provider,
        sourceRec.storage_key,
        expectedDigest,
        combinedSignal,
      );
      tracker.lastProgressAt = Date.now();

      const oldKey = snapshot.stepState.move_source_old_key;
      if (oldKey && oldKey !== sourceRec.storage_key) {
        await this.deleteAndVerifyAbsent(provider, oldKey);
        tracker.lastProgressAt = Date.now();
      }

      await this.markMoveSourceCompleted(ctx, targetLocation);
      return;
    }

    // ── الحالة 2: بدء النقل من المفتاح الحالي (oldKey) إلى مفتاح الجيل الحالي (targetKey) ──
    const oldKey = sourceRec.storage_key;
    const f = ctx.fencingToken.toString();
    const targetKey = `video-sources/${targetLocationLower}/${ownerPrefix}/${assetUuid}/f${f}/original.${ext}`;

    // التحقق من سلامة وبصمة SHA-256 للملف المصدر قبل نسخه
    await this.assertObjectIntegrity(
      provider,
      oldKey,
      expectedDigest,
      combinedSignal,
    );
    tracker.lastProgressAt = Date.now();

    // تسجيل مرحلة INIT ومفتاح المصدر والوجهة
    await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
      const st = parseJobStepState(jobRow.step_state_json);
      const nextSt: JobStepState = {
        ...st,
        move_source_phase: 'INIT',
        move_source_old_key: oldKey,
        move_source_target_key: targetKey,
      };
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: { stepStateJson: JSON.stringify(nextSt) },
      });
    });

    // الخطوة 4: تسجيل write_initiated = true قبل استدعاء copyObject
    await this.queue.markGenerationWriteInitiated(ctx, targetKey);
    const preWriteAborted = combinedSignal.aborted;

    let copiedEtag: string | undefined;
    try {
      const copyRes = await provider.copyObject(oldKey, targetKey, {
        abortSignal: combinedSignal,
      });
      copiedEtag = copyRes.etag ?? undefined;
      tracker.lastProgressAt = Date.now();

      // الخطوة 5: التحقق المتدفق من الحجم وبصمة SHA-256 للنسخة الجديدة في targetKey
      await this.assertObjectIntegrity(
        provider,
        targetKey,
        expectedDigest,
        combinedSignal,
      );
      tracker.lastProgressAt = Date.now();

      await this.queue.markGenerationWriteOutcome(ctx, targetKey, {
        settled: true,
        reason: 'DEFINITIVE_SUCCESS',
      });
    } catch (err: unknown) {
      const settlement = evaluateWriteErrorSettlement(err, {
        failedBeforeNetworkSend: preWriteAborted,
      });
      await this.queue
        .markGenerationWriteOutcome(ctx, targetKey, settlement)
        .catch(() => undefined);
      throw err;
    }

    // تسجيل مرحلة COPIED ثم الترقية الذرّية إلى DB_COMMITTED تحت السياج الأربعي (الخطوة 6)
    await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
      const freshAsset = await tx.mediaAsset.findUniqueOrThrow({
        where: { id: assetId },
        select: { variantsJson: true },
      });
      const curManifest = parseVariantsManifest(freshAsset.variantsJson);
      curManifest.source = {
        storage_key: targetKey,
        ext,
        location: targetLocation,
        size_bytes: expectedDigest.sizeBytes,
        sha256: expectedDigest.sha256Hex,
        etag: copiedEtag ?? sourceRec.etag,
        status: 'VERIFIED',
        verified_at: new Date().toISOString(),
      };

      const st = parseJobStepState(jobRow.step_state_json);
      const nextSt: JobStepState = {
        ...st,
        source: targetLocation,
        move_source_phase: 'DB_COMMITTED',
        move_source_old_key: oldKey,
        move_source_target_key: targetKey,
      };

      await tx.mediaAsset.update({
        where: { id: assetId },
        data: {
          variantsJson: JSON.stringify(curManifest),
          rowVersion: { increment: 1 },
        },
      });
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: { stepStateJson: JSON.stringify(nextSt) },
      });
    });

    // حذف المفتاح القديم فقط بعد نجاح التزام DB_COMMITTED والتحقق من اختفائه
    if (oldKey !== targetKey) {
      await this.deleteAndVerifyAbsent(provider, oldKey);
      tracker.lastProgressAt = Date.now();
    }

    await this.markMoveSourceCompleted(ctx, targetLocation);
  }

  private async assertObjectIntegrity(
    provider: ObjectStorageProvider,
    key: string,
    expected: LocalFileDigest,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const verify = await provider.verifyStoredObjectSha256(key, expected, {
      abortSignal,
    });
    if (!verify.ok) {
      throw new Error(
        `MOVE_SOURCE_INTEGRITY_FAILED (${key}): ${verify.reason ?? 'SHA256_MISMATCH'}`,
      );
    }
  }

  private async deleteAndVerifyAbsent(
    provider: ObjectStorageProvider,
    key: string,
  ): Promise<void> {
    await provider.deleteObject(key);
    const head = await provider.headObject(key);
    if (head.kind !== 'NOT_FOUND') {
      throw new Error(
        `MOVE_SOURCE_OLD_KEY_STILL_PRESENT: المفتاح القديم "${key}" ما زال موجوداً بعد الحذف`,
      );
    }
  }

  private async markMoveSourceCompleted(
    ctx: JobLockContext,
    targetLocation: 'READY' | 'HOLD',
  ): Promise<void> {
    await this.queue.runFencedMutation(ctx, async (tx, jobRow) => {
      const st = parseJobStepState(jobRow.step_state_json);
      const registry = { ...(st.generations_registry ?? {}) };
      const nowIso = new Date().toISOString();

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
        source: targetLocation,
        move_source_phase: 'DB_COMMITTED',
        move_source_old_key: undefined,
        generations_registry: registry,
      };

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

  private parsePayload(raw: string | null): MoveSourceJobPayload {
    if (!raw) {
      throw new Error('MOVE_SOURCE_MISSING_PAYLOAD');
    }
    let parsed: Partial<MoveSourceJobPayload>;
    try {
      parsed = JSON.parse(raw) as Partial<MoveSourceJobPayload>;
    } catch {
      throw new Error('MOVE_SOURCE_INVALID_JSON_PAYLOAD');
    }
    if (parsed.targetLocation !== 'READY' && parsed.targetLocation !== 'HOLD') {
      throw new Error(
        `MOVE_SOURCE_INVALID_TARGET_LOCATION: "${String(parsed.targetLocation)}"`,
      );
    }
    return {
      assetUuid: parsed.assetUuid,
      targetLocation: parsed.targetLocation,
    };
  }
}
