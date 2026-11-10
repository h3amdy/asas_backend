// src/shared/media/worker/delete-objects.processor.ts
// ═══════════════════════════════════════════════════════════════
// 🗑️ VIDEO P4-6 — معالج مهمة DELETE_OBJECTS (الخطوات 5–7 من دورة الحذف السباعي)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §9.2)
// ═══════════════════════════════════════════════════════════════
// التسلسل داخل المعالج:
//   (أ) فحص مسبق تحت السياج الأربعي + قفل media_assets FOR UPDATE:
//       - isDeleted = true، وصفر مراجع (العدّ الشامل المحافظ)، ولا مهام أخرى غير منتهية.
//       - إن عاد الأصل مرتبطاً أو لم يعد محذوفاً ← CANCELED دون لمس أي كائن.
//       - جمع المفاتيح المعروفة والمسجلة فقط (variants_json + سجلات الأجيال لكل مهام الأصل)
//         وتثبيتها في step_state_json (لا ListObjectsV2 إطلاقاً).
//   (ب) الخطوة 5: حذف كل مفتاح لدى المزود + حذف مجلد video-staging المحلي.
//   (ج) الخطوة 6: HeadObject لكل مفتاح مع تصنيف صارم: 404 فقط = محذوف.
//       403 / 5xx / 429 / Timeout / 200 ← RETRYING (أو FAILED بعد الحد) مع بقاء صف الأصل.
//   (د) الخطوة 7: معاملة مسيّجة تقفل الأصل وتعيد التحقق، ثم تحذف الجلسات والمهام وصف الأصل.
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fsp from 'fs/promises';
import { PrismaService } from '../../../prisma/prisma.service';
import { MediaLifecycleService } from '../media-lifecycle.service';
import {
  HeadOutcome,
  ObjectStorageProvider,
} from '../object-storage.interface';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { StorageService } from '../storage.service';
import { VideoMediaConfig } from '../video-media.config';
import {
  ClaimedJobRow,
  extractAdoptedStorageKeys,
  JobLockContext,
  JobStepState,
  LeaseLostError,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';

export const DELETE_OBJECTS_JOB = 'DELETE_OBJECTS';

export function deleteObjectsIdempotencyKey(assetUuid: string): string {
  return `${DELETE_OBJECTS_JOB}:${assetUuid}`;
}

/** نتيجة التحقق من مفتاح واحد بعد الحذف (§9.2 الخطوة 6) */
export type KeyVerification =
  | 'VERIFIED_DELETED'
  | 'STILL_EXISTS'
  | 'R2_DELETE_FORBIDDEN'
  | 'TRANSIENT_ERROR';

/**
 * التصنيف الصارم لنتيجة HeadObject: 404 وحده دليل الحذف.
 */
export function classifyHeadForDeletion(head: HeadOutcome): KeyVerification {
  switch (head.kind) {
    case 'NOT_FOUND':
      return 'VERIFIED_DELETED';
    case 'FOUND':
      return 'STILL_EXISTS';
    case 'FORBIDDEN':
      return 'R2_DELETE_FORBIDDEN';
    default:
      return 'TRANSIENT_ERROR';
  }
}

export interface DeleteObjectsStepState {
  delete_keys?: string[];
  delete_phase?: 'KEYS_COLLECTED' | 'VERIFY_FAILED';
  delete_verification?: Record<string, KeyVerification>;
  delete_staging_verified?: boolean;
}

export interface PurgedJobSummary {
  jobType: string;
  status: string;
  attemptCount: number;
}

/** يجمع كل المفاتيح المسجلة في سجلات الأجيال لمهمة واحدة */
export function extractRegistryKeys(stepStateJson: string | null): string[] {
  const state = parseJobStepState(stepStateJson);
  const keys: string[] = [];
  for (const entry of Object.values(state.generations_registry ?? {})) {
    keys.push(...Object.keys(entry.keys ?? {}));
  }
  return keys;
}

type PreCheckOutcome =
  | { kind: 'PROCEED'; keys: string[]; assetUuid: string; provider: string }
  | { kind: 'CANCELED'; reason: string }
  | { kind: 'DEFERRED'; reason: string };

@Injectable()
export class DeleteObjectsProcessor {
  private readonly logger = new Logger('DeleteObjectsProcessor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: VideoMediaConfig,
    private readonly storage: StorageService,
    private readonly storageRegistry: ObjectStorageRegistry,
    private readonly queue: MediaJobQueueService,
    private readonly lifecycle: MediaLifecycleService,
  ) {}

  async processClaimedJob(
    job: ClaimedJobRow,
    ctx: JobLockContext,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.run(job, ctx, abortSignal);
    } catch (err: unknown) {
      if (err instanceof LeaseLostError) {
        // عامل آخر يملك المهمة الآن (أو انتهى القفل): لا نكتب شيئاً.
        this.logger.warn(err.message);
        return;
      }
      this.logger.error(
        `خطأ غير متوقع في DELETE_OBJECTS للمهمة #${ctx.jobId}: ${String(err)}`,
      );
      await this.queue
        .failOrRetryJob(ctx, `DELETE_UNEXPECTED_ERROR: ${String(err)}`)
        .catch((e: unknown) => {
          if (!(e instanceof LeaseLostError)) throw e;
        });
    }
  }

  private async run(
    job: ClaimedJobRow,
    ctx: JobLockContext,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    // ── (أ) الفحص المسبق تحت السياج والقفل ──
    const pre = await this.queue.runFencedMutation(ctx, (tx, jobRow) =>
      this.preCheckAndCollectKeys(tx, jobRow),
    );

    if (pre.kind === 'CANCELED') {
      this.logger.warn(
        JSON.stringify({
          event: 'MEDIA_DELETE_ABORTED',
          reason: pre.reason,
          jobId: ctx.jobId,
          mediaAssetId: job.media_asset_id,
        }),
      );
      return;
    }
    if (pre.kind === 'DEFERRED') {
      return;
    }

    const provider = this.storageRegistry.get(pre.provider);

    // ── (ب) الخطوة 5: الحذف لدى المزود ──
    const deleteErrors: string[] = [];
    for (const key of pre.keys) {
      if (abortSignal?.aborted) {
        await this.queue.releaseOnGracefulShutdown(ctx);
        return;
      }
      try {
        await provider.deleteObject(key);
      } catch (err: unknown) {
        deleteErrors.push(`${key}: ${String(err)}`);
      }
    }
    await this.storage.deleteVideoStagingDir(pre.assetUuid).catch((err) => {
      deleteErrors.push(`video-staging: ${String(err)}`);
    });

    if (abortSignal?.aborted) {
      await this.queue.releaseOnGracefulShutdown(ctx);
      return;
    }

    // تمديد القفل قبل التحقق (ويكشف فقدان القفل مبكراً)
    await this.queue.runFencedMutation(
      ctx,
      (_tx, row) => Promise.resolve(row),
      { extendLeaseSec: this.config.workerLeaseSec },
    );

    // ── (ج) الخطوة 6: التحقق الصارم ──
    const verification = await this.verifyKeys(provider, pre.keys);
    const stagingGone = await this.isStagingDirAbsent(pre.assetUuid);
    const unverified = Object.entries(verification).filter(
      ([, v]) => v !== 'VERIFIED_DELETED',
    );

    if (unverified.length > 0 || !stagingGone) {
      const hasForbidden = unverified.some(
        ([, v]) => v === 'R2_DELETE_FORBIDDEN',
      );
      const reasonCode = hasForbidden
        ? 'R2_DELETE_FORBIDDEN'
        : unverified.some(([, v]) => v === 'STILL_EXISTS')
          ? 'R2_DELETE_NOT_VERIFIED_STILL_EXISTS'
          : unverified.length > 0
            ? 'R2_DELETE_TRANSIENT_ERROR'
            : 'LOCAL_STAGING_NOT_REMOVED';
      if (hasForbidden) {
        this.logger.error(
          JSON.stringify({
            event: 'R2_DELETE_FORBIDDEN',
            severity: 'CRITICAL',
            jobId: ctx.jobId,
            assetUuid: pre.assetUuid,
            keys: unverified
              .filter(([, v]) => v === 'R2_DELETE_FORBIDDEN')
              .map(([k]) => k),
          }),
        );
      }
      const patch: DeleteObjectsStepState = {
        delete_keys: pre.keys,
        delete_phase: 'VERIFY_FAILED',
        delete_verification: verification,
        delete_staging_verified: stagingGone,
      };
      await this.queue.failOrRetryJob(
        ctx,
        `${reasonCode}: ${unverified
          .map(([k, v]) => `${k}=${v}`)
          .join(
            ', ',
          )}${deleteErrors.length ? ` | deleteErrors: ${deleteErrors.join('; ')}` : ''}`,
        { stepStatePatch: patch as unknown as Partial<JobStepState> },
      );
      return;
    }

    // ── (د) الخطوة 7: الحذف النهائي لصف الأصل تحت السياج والقفل ──
    const finalOutcome = await this.queue.runFencedMutation(ctx, (tx) =>
      this.finalPurge(tx, job.media_asset_id, ctx.jobId),
    );

    if (finalOutcome.purged) {
      this.logger.log(
        JSON.stringify({
          event: 'MEDIA_ASSET_PURGED',
          assetUuid: pre.assetUuid,
          kind: finalOutcome.kind,
          ownerType: finalOutcome.ownerType,
          schoolId: finalOutcome.schoolId,
          storageProvider: pre.provider,
          deletedAt: finalOutcome.deletedAt,
          keysVerifiedDeleted: pre.keys.length,
          jobId: ctx.jobId,
          jobsSummary: finalOutcome.jobsSummary,
        }),
      );
      return;
    }

    // لا يُحذف الصف: حالة شاذة (مرجع ظهر بعد حذف الكائنات) — تنبيه حرج ومهمة FAILED
    this.logger.error(
      JSON.stringify({
        event: 'MEDIA_DELETE_FINAL_RECHECK_FAILED',
        severity: 'CRITICAL',
        reason: finalOutcome.reason,
        assetUuid: pre.assetUuid,
        jobId: ctx.jobId,
      }),
    );
    if (finalOutcome.reason === 'OTHER_ACTIVE_JOBS') {
      await this.queue.failOrRetryJob(ctx, 'DELETE_FINAL_DEFERRED_ACTIVE_JOBS');
      return;
    }
    await this.queue.failOrRetryJob(
      ctx,
      `DELETE_FINAL_RECHECK_FAILED: ${finalOutcome.reason}`,
      { forceTerminalFailure: true },
    );
  }

  /**
   * الفحص المسبق داخل المعاملة المسيّجة: قفل الأصل، إعادة التحقق، وجمع المفاتيح المعروفة.
   */
  private async preCheckAndCollectKeys(
    tx: Prisma.TransactionClient,
    jobRow: ClaimedJobRow,
  ): Promise<PreCheckOutcome> {
    const [locked] = await this.lifecycle.lockMediaAssetsForUpdate(tx, [
      jobRow.media_asset_id,
    ]);
    if (!locked) {
      // لا يمكن عملياً (FK Restrict)، لكن نغلق المهمة دفاعياً
      await this.markCanceled(tx, jobRow.id, 'DELETE_ABORTED_ASSET_MISSING');
      return { kind: 'CANCELED', reason: 'ASSET_MISSING' };
    }
    if (!locked.isDeleted) {
      await this.markCanceled(tx, jobRow.id, 'DELETE_ABORTED_ASSET_RESTORED');
      return { kind: 'CANCELED', reason: 'ASSET_NOT_SOFT_DELETED' };
    }
    const refs = await this.lifecycle.countAllActiveReferences(tx, locked.id);
    if (refs > 0) {
      await this.markCanceled(
        tx,
        jobRow.id,
        `DELETE_ABORTED_ACTIVE_REFERENCES (${refs})`,
      );
      return { kind: 'CANCELED', reason: `ACTIVE_REFERENCES_${refs}` };
    }
    const otherJobs = await this.lifecycle.countNonTerminalJobs(
      tx,
      locked.id,
      jobRow.id,
    );
    if (otherJobs > 0) {
      // تأجيل دون زيادة attempt_count حتى تنتهي مهام المعالجة الأخرى
      await tx.mediaProcessingJob.update({
        where: { id: jobRow.id },
        data: {
          status: 'RETRYING',
          nextRetryAt: new Date(Date.now() + 5 * 60_000),
          lockedBy: null,
          leaseUntil: null,
          lastError: `DELETE_DEFERRED_OTHER_ACTIVE_JOBS (${otherJobs})`,
        },
      });
      return { kind: 'DEFERRED', reason: 'OTHER_ACTIVE_JOBS' };
    }

    const asset = await tx.mediaAsset.findUniqueOrThrow({
      where: { id: locked.id },
      select: { uuid: true, variantsJson: true, storageKey: true },
    });
    const siblingJobs = await tx.mediaProcessingJob.findMany({
      where: { mediaAssetId: locked.id, id: { not: jobRow.id } },
      select: { stepStateJson: true },
    });

    const prevState = parseJobStepState(
      jobRow.step_state_json,
    ) as DeleteObjectsStepState;
    const keySet = new Set<string>(prevState.delete_keys ?? []);
    for (const k of extractAdoptedStorageKeys(asset.variantsJson)) {
      keySet.add(k);
    }
    for (const sj of siblingJobs) {
      for (const k of extractRegistryKeys(sj.stepStateJson)) keySet.add(k);
    }
    if (asset.storageKey && !asset.storageKey.startsWith('tmp/')) {
      keySet.add(asset.storageKey);
    }
    const keys = Array.from(keySet).sort();

    const nextState = {
      ...parseJobStepState(jobRow.step_state_json),
      delete_keys: keys,
      delete_phase: 'KEYS_COLLECTED',
    };
    await tx.mediaProcessingJob.update({
      where: { id: jobRow.id },
      data: { stepStateJson: JSON.stringify(nextState) },
    });

    return {
      kind: 'PROCEED',
      keys,
      assetUuid: asset.uuid,
      provider: locked.storageProvider ?? 'LOCAL',
    };
  }

  private async verifyKeys(
    provider: ObjectStorageProvider,
    keys: string[],
  ): Promise<Record<string, KeyVerification>> {
    const result: Record<string, KeyVerification> = {};
    for (const key of keys) {
      try {
        result[key] = classifyHeadForDeletion(await provider.headObject(key));
      } catch {
        result[key] = 'TRANSIENT_ERROR';
      }
    }
    return result;
  }

  private async isStagingDirAbsent(assetUuid: string): Promise<boolean> {
    try {
      await fsp.stat(this.storage.getVideoStagingDir(assetUuid));
      return false;
    } catch (err: unknown) {
      return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
    }
  }

  private async finalPurge(
    tx: Prisma.TransactionClient,
    assetId: number,
    jobId: number,
  ): Promise<
    | {
        purged: true;
        kind: string;
        ownerType: string;
        schoolId: number | null;
        deletedAt: string | null;
        jobsSummary: PurgedJobSummary[];
      }
    | {
        purged: false;
        reason:
          | 'ASSET_MISSING'
          | 'ASSET_RESTORED'
          | 'ACTIVE_REFERENCES'
          | 'OTHER_ACTIVE_JOBS';
      }
  > {
    const [locked] = await this.lifecycle.lockMediaAssetsForUpdate(tx, [
      assetId,
    ]);
    if (!locked) return { purged: false, reason: 'ASSET_MISSING' };
    if (!locked.isDeleted) return { purged: false, reason: 'ASSET_RESTORED' };
    if ((await this.lifecycle.countAllActiveReferences(tx, assetId)) > 0) {
      return { purged: false, reason: 'ACTIVE_REFERENCES' };
    }
    if ((await this.lifecycle.countNonTerminalJobs(tx, assetId, jobId)) > 0) {
      return { purged: false, reason: 'OTHER_ACTIVE_JOBS' };
    }

    const assetMeta = await tx.mediaAsset.findUnique({
      where: { id: assetId },
      select: {
        deletedAt: true,
      },
    });
    const jobsBeforePurge = await tx.mediaProcessingJob.findMany({
      where: { mediaAssetId: assetId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        jobType: true,
        status: true,
        attemptCount: true,
      },
    });
    const jobsSummary: PurgedJobSummary[] = jobsBeforePurge.map((j) => ({
      jobType: j.jobType,
      status: j.id === jobId ? 'COMPLETED' : j.status,
      attemptCount: j.id === jobId ? j.attemptCount + 1 : j.attemptCount,
    }));

    await tx.mediaUploadSession.deleteMany({
      where: { mediaAssetId: assetId },
    });
    await tx.mediaProcessingJob.deleteMany({
      where: { mediaAssetId: assetId },
    });
    await tx.mediaAsset.delete({ where: { id: assetId } });
    return {
      purged: true,
      kind: String(locked.kind),
      ownerType: locked.ownerType,
      schoolId: locked.schoolId,
      deletedAt: assetMeta?.deletedAt
        ? assetMeta.deletedAt.toISOString()
        : null,
      jobsSummary,
    };
  }

  private async markCanceled(
    tx: Prisma.TransactionClient,
    jobId: number,
    reason: string,
  ): Promise<void> {
    await tx.mediaProcessingJob.update({
      where: { id: jobId },
      data: {
        status: 'CANCELED',
        finishedAt: new Date(),
        lockedBy: null,
        leaseUntil: null,
        lastError: reason,
      },
    });
  }
}
