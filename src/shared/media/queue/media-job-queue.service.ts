// src/shared/media/queue/media-job-queue.service.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — طابور مهام معالجة الفيديو في PostgreSQL + السياج الأربعي
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §5)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ObjectStorageProvider,
  StorageProviderName,
  WriteSettlementOutcome,
} from '../object-storage.interface';
import { VideoMediaConfig } from '../video-media.config';

export interface JobLockContext {
  jobId: number;
  workerId: string;
  fencingToken: bigint;
}

export interface ClaimedJobRow {
  id: number;
  uuid: string;
  media_asset_id: number;
  job_type: string;
  status: string;
  idempotency_key: string;
  payload_json: string | null;
  step_state_json: string | null;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: Date;
  fencing_token: bigint;
  locked_by: string | null;
  lease_until: Date | null;
  heartbeat_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export interface GenerationKeyRecord {
  write_initiated: boolean;
  write_settled: boolean;
  settlement_reason?: string;
  updated_at: string;
}

export type GenerationReconciliationStatus =
  | 'ACTIVE'
  | 'PENDING_SWEEP'
  | 'VERIFIED_ABSENT'
  | 'RECONCILIATION_CLOSED';

export interface GenerationRegistryEntry {
  fencing_token: string;
  registered_at: string;
  lease_expires_at: string;
  keys: Record<string, GenerationKeyRecord>;
  reconciliation_status: GenerationReconciliationStatus;
  sweep_pass_count: number;
  last_verified_at?: string;
  next_sweep_at?: string;
}

export interface JobStepState {
  plan?: string[];
  thumb_verified?: boolean;
  variants_verified?: Record<string, boolean>;
  source?: 'LOCAL_STAGING' | 'READY' | 'HOLD' | 'DELETED';
  fallback_profile?: Record<string, boolean>;
  stale_recovery_count?: number;
  disk_deferral_count?: number;
  move_source_phase?: 'INIT' | 'COPIED' | 'DB_COMMITTED';
  move_source_target_key?: string;
  move_source_old_key?: string;
  generations_registry?: Record<string, GenerationRegistryEntry>;
}

/**
 * استثناء فقدان قفل المهمة (الشروط الأربعة لـ Worker Fencing).
 * عند رميه داخل runFencedMutation تتراجع المعاملة بالكامل (ROLLBACK).
 */
export class LeaseLostError extends Error {
  constructor(public readonly context: JobLockContext) {
    super(
      `[LeaseLostError] العامل "${context.workerId}" فقد القفل على المهمة #${context.jobId} (fencing_token=${context.fencingToken.toString()})`,
    );
    this.name = 'LeaseLostError';
  }
}

/** فترات التأخير الأسي لإعادة المحاولة عند الفشل الفعلي: 1m → 3m → 10m → 30m */
export const RETRY_BACKOFF_MS = [60_000, 180_000, 600_000, 1_800_000] as const;

/** فترات المصالحة الدورية للأجيال في حالة VERIFIED_ABSENT: 2m → 20m → 1h → 6h → 24h → 7d */
export const RECONCILIATION_SWEEP_INTERVALS_MS = [
  120_000, 1_200_000, 3_600_000, 21_600_000, 86_400_000, 604_800_000,
] as const;

export const MAX_DISK_DEFERRALS = 10;
export const MAX_RECONCILIATION_JOBS_PER_SWEEP = 5;

export function computeRetryBackoffMs(attemptNumber: number): number {
  const idx = Math.max(
    0,
    Math.min(RETRY_BACKOFF_MS.length - 1, attemptNumber - 1),
  );
  return RETRY_BACKOFF_MS[idx];
}

export function parseJobStepState(
  raw: string | null | undefined,
): JobStepState {
  if (!raw || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as JobStepState) : {};
  } catch {
    return {};
  }
}

/**
 * يستخرج مجموعة جميع مفاتيح التخزين المعتمدة حالياً في MediaAsset.variantsJson
 * لحمايتها الصارمة من أي حذف في ماسح الأجيال اليتيمة.
 */
export function extractAdoptedStorageKeys(
  variantsJsonRaw: string | null | undefined,
): Set<string> {
  const adopted = new Set<string>();
  if (!variantsJsonRaw) return adopted;
  try {
    const data = JSON.parse(variantsJsonRaw) as Record<string, unknown>;
    const thumb = data.thumb as Record<string, unknown> | undefined;
    if (typeof thumb?.storage_key === 'string' && thumb.storage_key) {
      adopted.add(thumb.storage_key);
    }
    const variants = data.variants as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (variants && typeof variants === 'object') {
      for (const v of Object.values(variants)) {
        if (typeof v?.storage_key === 'string' && v.storage_key) {
          adopted.add(v.storage_key);
        }
      }
    }
    const source = data.source as Record<string, unknown> | undefined;
    if (typeof source?.storage_key === 'string' && source.storage_key) {
      adopted.add(source.storage_key);
    }
  } catch {
    // تجاهل JSON غير صالح
  }
  return adopted;
}

@Injectable()
export class MediaJobQueueService {
  private readonly logger = new Logger('MediaJobQueueService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: VideoMediaConfig,
  ) {}

  /**
   * 1. سحب المهمة الذرّي (Atomic Claim via ORDER BY ... LIMIT 1 FOR UPDATE SKIP LOCKED).
   * - يزيد fencing_token بمقدار +1.
   * - لا يزيد attempt_count مطلقاً عند السحب (v1.7 §1).
   */
  async claimNextJob(
    workerId: string,
    leaseSec: number = this.config.workerLeaseSec,
  ): Promise<ClaimedJobRow | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJobRow[]>`
      UPDATE media_processing_jobs
      SET status = 'PROCESSING',
          fencing_token = fencing_token + 1,
          locked_by = ${workerId},
          lease_until = now() + (${String(leaseSec)} || ' seconds')::interval,
          heartbeat_at = now(),
          updated_at = now()
      WHERE id = (
        SELECT id
        FROM media_processing_jobs
        WHERE status IN ('PENDING', 'RETRYING')
          AND next_retry_at <= now()
        ORDER BY next_retry_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    return rows[0] ?? null;
  }

  /**
   * 2. تنفيذ أي كتابة على المهمة أو على MediaAsset تحت شروط الـ Fencing الأربعة معاً (§5.1):
   *    - id = ctx.jobId
   *    - status = 'PROCESSING'
   *    - locked_by = ctx.workerId
   *    - fencing_token = ctx.fencingToken
   *    - lease_until > now()
   * إذا أعاد التحديث 0 صفوف، يرمي LeaseLostError داخل المعاملة فتُجهَض المعاملة بالكامل (ROLLBACK).
   */
  async runFencedMutation<T>(
    ctx: JobLockContext,
    mutateFn: (
      tx: Prisma.TransactionClient,
      jobRow: ClaimedJobRow,
    ) => Promise<T>,
    options?: { extendLeaseSec?: number },
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const extendSec = options?.extendLeaseSec;
        const rows =
          extendSec !== undefined
            ? await tx.$queryRaw<ClaimedJobRow[]>`
                UPDATE media_processing_jobs
                SET updated_at = now(),
                    heartbeat_at = now(),
                    lease_until = now() + (${String(extendSec)} || ' seconds')::interval
                WHERE id = ${ctx.jobId}
                  AND status = 'PROCESSING'
                  AND locked_by = ${ctx.workerId}
                  AND fencing_token = ${ctx.fencingToken}
                  AND lease_until > now()
                RETURNING *
              `
            : await tx.$queryRaw<ClaimedJobRow[]>`
                UPDATE media_processing_jobs
                SET updated_at = now(),
                    heartbeat_at = now()
                WHERE id = ${ctx.jobId}
                  AND status = 'PROCESSING'
                  AND locked_by = ${ctx.workerId}
                  AND fencing_token = ${ctx.fencingToken}
                  AND lease_until > now()
                RETURNING *
              `;

        const jobRow = rows[0];
        if (!jobRow) {
          throw new LeaseLostError(ctx);
        }

        return mutateFn(tx, jobRow);
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  /**
   * 3. تمديد النبض المشروط بالتقدم الفعلي ومراقبة التجمد (§5.2):
   * لا يمدد lease_until إلا إذا كان هناك تقدم فعلي خلال نافذة workerStallTimeoutMs
   * ولم يتجاوز الزمن الكلي ffmpegMaxRuntimeMs.
   */
  async heartbeatIfProgressing(
    ctx: JobLockContext,
    tracker: { lastProgressAt: number; startedAt: number },
    nowMs: number = Date.now(),
  ): Promise<
    | { extended: true; leaseUntil: Date | null }
    | {
        extended: false;
        reason: 'PROCESS_STALLED_TIMEOUT' | 'MAX_RUNTIME_EXCEEDED';
      }
  > {
    if (nowMs - tracker.lastProgressAt >= this.config.workerStallTimeoutMs) {
      return { extended: false, reason: 'PROCESS_STALLED_TIMEOUT' };
    }
    if (nowMs - tracker.startedAt >= this.config.ffmpegMaxRuntimeMs) {
      return { extended: false, reason: 'MAX_RUNTIME_EXCEEDED' };
    }

    const updated = await this.runFencedMutation(
      ctx,
      (_tx, jobRow) => Promise.resolve(jobRow),
      { extendLeaseSec: this.config.workerLeaseSec },
    );
    return { extended: true, leaseUntil: updated.lease_until };
  }

  /**
   * 4. التسجيل المسبق الإلزامي لمفاتيح الجيل قبل بدء أي عملية رفع أو نسخ (Write-Ahead Key Registration — v1.7).
   */
  async registerGenerationCandidateKeys(
    ctx: JobLockContext,
    candidateKeys: string[],
    backfillBuilder?: (token: bigint) => string[],
  ): Promise<JobStepState> {
    return this.runFencedMutation(ctx, async (tx, jobRow) => {
      const state = parseJobStepState(jobRow.step_state_json);
      const registry: Record<string, GenerationRegistryEntry> = {
        ...(state.generations_registry ?? {}),
      };

      const nowIso = new Date().toISOString();
      const leaseIso = (
        jobRow.lease_until ??
        new Date(Date.now() + this.config.workerLeaseSec * 1000)
      ).toISOString();

      // استكمال تسجيل أي جيل سابق غير مسجل (دفاعياً)
      if (backfillBuilder && ctx.fencingToken > 1n) {
        for (let k = 1n; k < ctx.fencingToken; k++) {
          const kStr = k.toString();
          if (!registry[kStr]) {
            const kKeys: Record<string, GenerationKeyRecord> = {};
            for (const key of backfillBuilder(k)) {
              kKeys[key] = {
                write_initiated: true,
                write_settled: false,
                settlement_reason: 'BACKFILLED_UNSETTLED',
                updated_at: nowIso,
              };
            }
            registry[kStr] = {
              fencing_token: kStr,
              registered_at: nowIso,
              lease_expires_at: nowIso,
              keys: kKeys,
              reconciliation_status: 'PENDING_SWEEP',
              sweep_pass_count: 0,
              next_sweep_at: nowIso,
            };
          } else if (registry[kStr].reconciliation_status === 'ACTIVE') {
            registry[kStr] = {
              ...registry[kStr],
              reconciliation_status: 'PENDING_SWEEP',
              next_sweep_at: nowIso,
            };
          }
        }
      }

      const tokenStr = ctx.fencingToken.toString();
      const existingEntry = registry[tokenStr];
      const keysMap: Record<string, GenerationKeyRecord> = {
        ...(existingEntry?.keys ?? {}),
      };
      for (const key of candidateKeys) {
        if (!keysMap[key]) {
          keysMap[key] = {
            write_initiated: false,
            write_settled: false,
            updated_at: nowIso,
          };
        }
      }

      registry[tokenStr] = {
        fencing_token: tokenStr,
        registered_at: existingEntry?.registered_at ?? nowIso,
        lease_expires_at: leaseIso,
        keys: keysMap,
        reconciliation_status: 'ACTIVE',
        sweep_pass_count: existingEntry?.sweep_pass_count ?? 0,
      };

      const nextState: JobStepState = {
        ...state,
        generations_registry: registry,
      };

      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: { stepStateJson: JSON.stringify(nextState) },
      });

      return nextState;
    });
  }

  /**
   * 5. تسجيل بدء عملية الكتابة الخارجية لمفتاح محدد (write_initiated = true, write_settled = false)
   * قبل إرسال البايتات إلى مزود التخزين.
   */
  async markGenerationWriteInitiated(
    ctx: JobLockContext,
    key: string,
  ): Promise<void> {
    await this.runFencedMutation(ctx, async (tx, jobRow) => {
      const state = parseJobStepState(jobRow.step_state_json);
      const registry = { ...(state.generations_registry ?? {}) };
      const tokenStr = ctx.fencingToken.toString();
      const nowIso = new Date().toISOString();
      const entry = registry[tokenStr] ?? {
        fencing_token: tokenStr,
        registered_at: nowIso,
        lease_expires_at: (jobRow.lease_until ?? new Date()).toISOString(),
        keys: {},
        reconciliation_status: 'ACTIVE' as const,
        sweep_pass_count: 0,
      };

      entry.keys = {
        ...entry.keys,
        [key]: {
          write_initiated: true,
          write_settled: false,
          updated_at: nowIso,
        },
      };
      registry[tokenStr] = entry;

      const nextState: JobStepState = {
        ...state,
        generations_registry: registry,
      };
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: { stepStateJson: JSON.stringify(nextState) },
      });
    });
  }

  /**
   * 6. تسجيل نتيجة استقرار الكتابة الخارجية وفق معيار v1.7 الصارم:
   * - لا يُضبط write_settled = true إلا إذا كانت outcome.settled === true (استجابة نجاح نهائية مؤكدة أو إلغاء مؤكد قبل التثبيت).
   * - عند انقطاع الاتصال أو Timeout أو Abort غير مؤكد أو 5xx يبقى write_settled = false وجوباً.
   */
  async markGenerationWriteOutcome(
    ctx: JobLockContext,
    key: string,
    outcome: WriteSettlementOutcome,
  ): Promise<void> {
    await this.runFencedMutation(ctx, async (tx, jobRow) => {
      const state = parseJobStepState(jobRow.step_state_json);
      const registry = { ...(state.generations_registry ?? {}) };
      const tokenStr = ctx.fencingToken.toString();
      const entry = registry[tokenStr];
      if (!entry) return;

      const nowIso = new Date().toISOString();
      const prevKeyRecord = entry.keys[key] ?? {
        write_initiated: true,
        write_settled: false,
        updated_at: nowIso,
      };

      entry.keys = {
        ...entry.keys,
        [key]: {
          ...prevKeyRecord,
          write_initiated: true,
          write_settled: outcome.settled === true,
          settlement_reason: outcome.reason,
          updated_at: nowIso,
        },
      };
      registry[tokenStr] = entry;

      const nextState: JobStepState = {
        ...state,
        generations_registry: registry,
      };
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: { stepStateJson: JSON.stringify(nextState) },
      });
    });
  }

  /** اسم بديل متوافق مع مواصفة v1.7 لـ markGenerationWriteOutcome */
  async markGenerationWriteDefinitiveOutcome(
    ctx: JobLockContext,
    key: string,
    outcome: WriteSettlementOutcome,
  ): Promise<void> {
    return this.markGenerationWriteOutcome(ctx, key, outcome);
  }

  /**
   * 7. تحرير القفل عند الإيقاف الرشيق (SIGTERM / SIGINT) دون زيادة attempt_count (+0).
   */
  async releaseOnGracefulShutdown(ctx: JobLockContext): Promise<void> {
    await this.runFencedMutation(ctx, async (tx, jobRow) => {
      const state = parseJobStepState(jobRow.step_state_json);
      const registry = this.markGenerationForSweep(
        state.generations_registry,
        ctx.fencingToken,
      );
      const nextState: JobStepState = {
        ...state,
        generations_registry: registry,
      };

      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: {
          status: 'RETRYING',
          nextRetryAt: new Date(),
          lockedBy: null,
          leaseUntil: null,
          stepStateJson: JSON.stringify(nextState),
          lastError: 'GRACEFUL_SHUTDOWN_RELEASED',
        },
      });
    });
  }

  /**
   * 8. تأجيل المهمة عند ضغط مساحة القرص المؤقت (DISK_PRESSURE) دون زيادة attempt_count (+0).
   */
  async deferOnDiskPressure(
    ctx: JobLockContext,
    reason: string,
  ): Promise<{ deferred: boolean; deferralsCount: number }> {
    return this.runFencedMutation(ctx, async (tx, jobRow) => {
      const state = parseJobStepState(jobRow.step_state_json);
      const deferralsCount = (state.disk_deferral_count ?? 0) + 1;
      const registry = this.markGenerationForSweep(
        state.generations_registry,
        ctx.fencingToken,
      );
      const nextState: JobStepState = {
        ...state,
        disk_deferral_count: deferralsCount,
        generations_registry: registry,
      };

      const delayMs = Math.min(300_000, 60_000 * deferralsCount);
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: {
          status: 'RETRYING',
          nextRetryAt: new Date(Date.now() + delayMs),
          lockedBy: null,
          leaseUntil: null,
          stepStateJson: JSON.stringify(nextState),
          lastError: `DISK_PRESSURE (${deferralsCount}/${MAX_DISK_DEFERRALS}): ${reason}`,
        },
      });

      return { deferred: true, deferralsCount };
    });
  }

  /**
   * 9. معالجة الفشل الفعلي في المعالجة (تزيد attempt_count بمقدار +1):
   * - إذا كان newAttemptCount < max_attempts (ولم يُطلب forceTerminalFailure): تنتقل إلى RETRYING مع تأخير أسي.
   * - إذا بلغ newAttemptCount >= max_attempts (أو forceTerminalFailure = true): تنتقل إلى FAILED.
   */
  async failOrRetryJob(
    ctx: JobLockContext,
    errorReason: string,
    options?: {
      forceTerminalFailure?: boolean;
      stepStatePatch?: Partial<JobStepState>;
      onBeforeTerminalFailure?: (
        tx: Prisma.TransactionClient,
        jobRow: ClaimedJobRow,
        nextState: JobStepState,
      ) => Promise<JobStepState | void>;
    },
  ): Promise<{
    status: 'RETRYING' | 'FAILED';
    attemptCount: number;
    nextRetryAt: Date | null;
  }> {
    return this.runFencedMutation(ctx, async (tx, jobRow) => {
      const newAttemptCount = jobRow.attempt_count + 1;
      const isTerminal =
        options?.forceTerminalFailure === true ||
        newAttemptCount >= jobRow.max_attempts;

      const currentState = parseJobStepState(jobRow.step_state_json);
      const registry = this.markGenerationForSweep(
        currentState.generations_registry,
        ctx.fencingToken,
      );
      let nextState: JobStepState = {
        ...currentState,
        ...(options?.stepStatePatch ?? {}),
        generations_registry: registry,
      };

      if (isTerminal) {
        if (options?.onBeforeTerminalFailure) {
          const patched = await options.onBeforeTerminalFailure(
            tx,
            jobRow,
            nextState,
          );
          if (patched) nextState = patched;
        }
        const now = new Date();
        await tx.mediaProcessingJob.update({
          where: { id: ctx.jobId },
          data: {
            status: 'FAILED',
            attemptCount: newAttemptCount,
            finishedAt: now,
            lockedBy: null,
            leaseUntil: null,
            stepStateJson: JSON.stringify(nextState),
            lastError: errorReason.slice(0, 2000),
          },
        });
        return {
          status: 'FAILED',
          attemptCount: newAttemptCount,
          nextRetryAt: null,
        };
      }

      const backoffMs = computeRetryBackoffMs(newAttemptCount);
      const nextRetryAt = new Date(Date.now() + backoffMs);
      await tx.mediaProcessingJob.update({
        where: { id: ctx.jobId },
        data: {
          status: 'RETRYING',
          attemptCount: newAttemptCount,
          nextRetryAt,
          lockedBy: null,
          leaseUntil: null,
          stepStateJson: JSON.stringify(nextState),
          lastError: errorReason.slice(0, 2000),
        },
      });

      return {
        status: 'RETRYING',
        attemptCount: newAttemptCount,
        nextRetryAt,
      };
    });
  }

  /**
   * 10. استعادة الأقفال المنتهية (recoverStaleLeases — v1.7):
   * - لا تزيد attempt_count عند استعادة مهمة بعد إعادة تشغيل الخادم أو انهيار عابر!
   * - تزيد stale_recovery_count في step_state_json لحماية الخادم من حلقات الانهيار اللانهائية (Poison-Pill >= max_attempts).
   */
  async recoverStaleLeases(): Promise<{
    recoveredToRetrying: number;
    markedFailed: number;
  }> {
    const candidates = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM media_processing_jobs
      WHERE status = 'PROCESSING'
        AND lease_until <= now()
      ORDER BY lease_until ASC, id ASC
    `;

    let recoveredToRetrying = 0;
    let markedFailed = 0;

    for (const candidate of candidates) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<ClaimedJobRow[]>`
          SELECT *
          FROM media_processing_jobs
          WHERE id = ${candidate.id}
            AND status = 'PROCESSING'
            AND lease_until <= now()
          FOR UPDATE SKIP LOCKED
        `;
        const job = rows[0];
        if (!job) return 'SKIPPED' as const;

        const state = parseJobStepState(job.step_state_json);
        const staleRecoveryCount = (state.stale_recovery_count ?? 0) + 1;
        const registry = this.markGenerationForSweep(
          state.generations_registry,
          job.fencing_token,
        );
        const nextState: JobStepState = {
          ...state,
          stale_recovery_count: staleRecoveryCount,
          generations_registry: registry,
        };

        if (
          job.attempt_count < job.max_attempts &&
          staleRecoveryCount < job.max_attempts
        ) {
          const backoffMs = computeRetryBackoffMs(staleRecoveryCount);
          await tx.mediaProcessingJob.update({
            where: { id: job.id },
            data: {
              status: 'RETRYING',
              nextRetryAt: new Date(Date.now() + backoffMs),
              lockedBy: null,
              leaseUntil: null,
              stepStateJson: JSON.stringify(nextState),
              lastError: `STALE_LEASE_RECOVERED (stale_recovery=${staleRecoveryCount}/${job.max_attempts})`,
            },
          });
          return 'RETRYING' as const;
        }

        const now = new Date();
        await tx.mediaProcessingJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            finishedAt: now,
            lockedBy: null,
            leaseUntil: null,
            stepStateJson: JSON.stringify(nextState),
            lastError: `STALE_LEASE_MAX_RECOVERIES_EXCEEDED (attempt=${job.attempt_count}, stale_recovery=${staleRecoveryCount})`,
          },
        });
        await tx.mediaAsset.update({
          where: { id: job.media_asset_id },
          data: { processingStatus: 'ERROR', rowVersion: { increment: 1 } },
        });
        await tx.mediaUploadSession.updateMany({
          where: { mediaAssetId: job.media_asset_id },
          data: { processingStatus: 'ERROR' },
        });
        return 'FAILED' as const;
      });

      if (outcome === 'RETRYING') recoveredToRetrying++;
      else if (outcome === 'FAILED') markedFailed++;
    }

    return { recoveredToRetrying, markedFailed };
  }

  /**
   * 11. الماسح الدوري لتنظيف ومصالحة مفاتيح الأجيال غير المعتمدة (sweepOrphanGenerationKeys — v1.7):
   * - يفصل بصرامة بين VERIFIED_ABSENT و RECONCILIATION_CLOSED.
   * - لا ينقل الجيل إلى RECONCILIATION_CLOSED (حتى عند حذف الأصل assetDeleted=true) إلا إذا:
   *   (أ) كان لكل مفتاح في الجيل write_initiated === false أو write_settled === true (حُسم مصير الكتابة لدى المزود).
   *   (ب) حُذفت جميع المفاتيح غير المعتمدة (أو كل المفاتيح عند حذف الأصل) وتأكد headObject(key) === NOT_FOUND (404).
   * - إذا كانت هناك أي كتابة ملتبسة (write_initiated === true && write_settled === false)، يبقى الجيل في VERIFIED_ABSENT
   *   وخاضعاً للمصالحة الدورية المحدودة (LIMIT 5) حتى لو ظهر كائن متأخر بعد VERIFIED_ABSENT!
   */
  async sweepOrphanGenerationKeys(
    resolveProvider: (name: StorageProviderName) => ObjectStorageProvider,
    options?: {
      jobId?: number;
      assetDeleted?: boolean;
      now?: Date;
    },
  ): Promise<{
    jobsInspected: number;
    keysDeleted: number;
    generationsClosed: number;
    generationsVerifiedAbsent: number;
  }> {
    const now = options?.now ?? new Date();
    const candidateRows =
      options?.jobId !== undefined
        ? await this.prisma.$queryRaw<Array<{ id: number }>>`
            SELECT id
            FROM media_processing_jobs
            WHERE id = ${options.jobId}
          `
        : await this.prisma.$queryRaw<Array<{ id: number }>>`
            SELECT id
            FROM media_processing_jobs
            WHERE step_state_json IS NOT NULL
              AND (
                step_state_json LIKE '%"PENDING_SWEEP"%'
                OR step_state_json LIKE '%"VERIFIED_ABSENT"%'
                OR (status IN ('COMPLETED', 'FAILED') AND step_state_json LIKE '%"ACTIVE"%')
              )
            ORDER BY updated_at ASC, id ASC
            LIMIT ${MAX_RECONCILIATION_JOBS_PER_SWEEP}
          `;

    let jobsInspected = 0;
    let keysDeleted = 0;
    let generationsClosed = 0;
    let generationsVerifiedAbsent = 0;

    for (const row of candidateRows) {
      const jobRecord = await this.prisma.mediaProcessingJob.findUnique({
        where: { id: row.id },
        include: {
          mediaAsset: {
            select: {
              id: true,
              uuid: true,
              storageProvider: true,
              variantsJson: true,
              isDeleted: true,
            },
          },
        },
      });
      if (!jobRecord || !jobRecord.stepStateJson) continue;

      const state = parseJobStepState(jobRecord.stepStateJson);
      const registry = state.generations_registry;
      if (!registry || Object.keys(registry).length === 0) continue;

      // قراءة أحدث المراجع المعتمدة من MediaAsset.variantsJson
      const isAssetDeleted = options?.assetDeleted === true;
      const adoptedKeys = isAssetDeleted
        ? new Set<string>()
        : extractAdoptedStorageKeys(jobRecord.mediaAsset.variantsJson);

      const providerName: StorageProviderName =
        jobRecord.mediaAsset.storageProvider === 'R2' ? 'R2' : 'LOCAL';
      const provider = resolveProvider(providerName);

      const currentFencingStr = jobRecord.fencingToken.toString();
      const isJobActiveProcessing =
        jobRecord.status === 'PROCESSING' &&
        jobRecord.leaseUntil !== null &&
        jobRecord.leaseUntil > now;

      const sweptObservations = new Map<
        string,
        {
          initialKeysSnapshot: Record<string, GenerationKeyRecord>;
          allNonAdoptedConfirmedAbsent: boolean;
          foundLateObjectInThisPass: boolean;
        }
      >();

      // المرحلة (أ): فحص وحذف المفاتيح اليتيمة لدى المزود خارج أي قفل لقاعدة البيانات
      for (const [genToken, entry] of Object.entries(registry)) {
        if (entry.reconciliation_status === 'RECONCILIATION_CLOSED') {
          continue;
        }
        // لا نمس الجيل النشط الجاري حالياً بينما قفله سارٍ
        if (
          isJobActiveProcessing &&
          genToken === currentFencingStr &&
          !isAssetDeleted
        ) {
          continue;
        }

        if (
          options?.jobId === undefined &&
          entry.next_sweep_at &&
          new Date(entry.next_sweep_at) > now
        ) {
          continue;
        }

        jobsInspected++;
        let allNonAdoptedConfirmedAbsent = true;
        let foundLateObjectInThisPass = false;

        for (const key of Object.keys(entry.keys)) {
          // حماية صارمة: لا نحذف أي storage_key معتمد حالياً في variants_json
          if (adoptedKeys.has(key)) {
            continue;
          }

          try {
            const beforeHead = await provider.headObject(key);
            if (beforeHead.kind === 'FOUND') {
              foundLateObjectInThisPass = true;
              await provider.deleteObject(key);
              keysDeleted++;
            } else if (beforeHead.kind !== 'NOT_FOUND') {
              allNonAdoptedConfirmedAbsent = false;
              continue;
            }

            // تحقق صريح من الغياب (404 NOT_FOUND) بعد الحذف
            const afterHead = await provider.headObject(key);
            if (afterHead.kind !== 'FOUND' && afterHead.kind !== 'NOT_FOUND') {
              allNonAdoptedConfirmedAbsent = false;
            } else if (afterHead.kind === 'FOUND') {
              allNonAdoptedConfirmedAbsent = false;
            }
          } catch {
            allNonAdoptedConfirmedAbsent = false;
          }
        }

        sweptObservations.set(genToken, {
          initialKeysSnapshot: { ...entry.keys },
          allNonAdoptedConfirmedAbsent,
          foundLateObjectInThisPass,
        });
      }

      // المرحلة (ب): معاملة PostgreSQL قصيرة بـ SELECT ... FOR UPDATE لدمج نتيجة الجيل الممسوح فقط دون طمس تحديثات العامل النشط
      if (sweptObservations.size > 0) {
        await this.prisma.$transaction(async (tx) => {
          const lockedRows = await tx.$queryRaw<ClaimedJobRow[]>`
            SELECT *
            FROM media_processing_jobs
            WHERE id = ${jobRecord.id}
            FOR UPDATE
          `;
          const lockedJob = lockedRows[0];
          if (!lockedJob || !lockedJob.step_state_json) {
            return;
          }

          const freshState = parseJobStepState(lockedJob.step_state_json);
          const freshRegistry: Record<string, GenerationRegistryEntry> = {
            ...(freshState.generations_registry ?? {}),
          };

          const freshFencingStr = BigInt(lockedJob.fencing_token).toString();
          const isFreshJobActiveProcessing =
            lockedJob.status === 'PROCESSING' &&
            lockedJob.lease_until !== null &&
            new Date(lockedJob.lease_until) > now;

          let registryMutated = false;

          for (const [genToken, obs] of sweptObservations.entries()) {
            const freshEntry = freshRegistry[genToken];
            if (
              !freshEntry ||
              freshEntry.reconciliation_status === 'RECONCILIATION_CLOSED'
            ) {
              continue;
            }
            if (
              isFreshJobActiveProcessing &&
              genToken === freshFencingStr &&
              !isAssetDeleted
            ) {
              continue;
            }

            const freshKeys = freshEntry.keys ?? {};
            const hasConcurrentlyAddedOrInitiatedKey = Object.entries(
              freshKeys,
            ).some(([k, freshKr]) => {
              const initKr = obs.initialKeysSnapshot[k];
              if (!initKr) return true;
              return !initKr.write_initiated && freshKr.write_initiated;
            });

            const effectiveAllConfirmedAbsent =
              obs.allNonAdoptedConfirmedAbsent &&
              !hasConcurrentlyAddedOrInitiatedKey;

            // إعادة التحقق من شروط إغلاق الجيل على أحدث حالة مقفلة (يُمنع إغلاق أي جيل فيه write_settled = false)
            const allWritesDefinitivelySettled = Object.values(freshKeys).every(
              (kr) => kr.write_initiated === false || kr.write_settled === true,
            );

            const nowIso = now.toISOString();
            const nextPassCount = (freshEntry.sweep_pass_count ?? 0) + 1;

            if (!effectiveAllConfirmedAbsent) {
              freshRegistry[genToken] = {
                ...freshEntry,
                reconciliation_status: 'PENDING_SWEEP',
                sweep_pass_count: nextPassCount,
                next_sweep_at: new Date(now.getTime() + 60_000).toISOString(),
              };
              registryMutated = true;
              continue;
            }

            if (allWritesDefinitivelySettled) {
              freshRegistry[genToken] = {
                ...freshEntry,
                reconciliation_status: 'RECONCILIATION_CLOSED',
                sweep_pass_count: nextPassCount,
                last_verified_at: nowIso,
                next_sweep_at: undefined,
              };
              generationsClosed++;
              registryMutated = true;
            } else {
              const intervalIdx = obs.foundLateObjectInThisPass
                ? 0
                : Math.min(
                    RECONCILIATION_SWEEP_INTERVALS_MS.length - 1,
                    nextPassCount - 1,
                  );
              const nextDelayMs =
                RECONCILIATION_SWEEP_INTERVALS_MS[intervalIdx];
              freshRegistry[genToken] = {
                ...freshEntry,
                reconciliation_status: 'VERIFIED_ABSENT',
                sweep_pass_count: nextPassCount,
                last_verified_at: nowIso,
                next_sweep_at: new Date(
                  now.getTime() + nextDelayMs,
                ).toISOString(),
              };
              generationsVerifiedAbsent++;
              registryMutated = true;
            }
          }

          if (registryMutated) {
            const mergedState: JobStepState = {
              ...freshState,
              generations_registry: freshRegistry,
            };
            await tx.mediaProcessingJob.update({
              where: { id: lockedJob.id },
              data: { stepStateJson: JSON.stringify(mergedState) },
            });
          }
        });
      }
    }

    return {
      jobsInspected,
      keysDeleted,
      generationsClosed,
      generationsVerifiedAbsent,
    };
  }

  /**
   * مساعد لتعليم الجيل المنتهي أو المتوقف بأنه جاهز للماسح إذا لم يكن مغلقاً.
   */
  markGenerationForSweep(
    registry: Record<string, GenerationRegistryEntry> | undefined,
    fencingToken: bigint,
  ): Record<string, GenerationRegistryEntry> {
    const copy: Record<string, GenerationRegistryEntry> = {
      ...(registry ?? {}),
    };
    const tokenStr = fencingToken.toString();
    const entry = copy[tokenStr];
    if (entry && entry.reconciliation_status === 'ACTIVE') {
      const allNoWrite = Object.values(entry.keys).every(
        (k) => k.write_initiated === false,
      );
      copy[tokenStr] = {
        ...entry,
        reconciliation_status: allNoWrite
          ? 'RECONCILIATION_CLOSED'
          : 'PENDING_SWEEP',
        next_sweep_at: allNoWrite ? undefined : new Date().toISOString(),
      };
    }
    return copy;
  }
}
