/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/no-base-to-string */
// src/shared/media/queue/worker-fencing-four-conditions.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — اختبارات وحدة السياج الأربعي وفصل المحاولات ومعيار write_settled (v1.7)
// مرجع: p4-4-design-and-audit.md (v1.7 §2.1)
// ═══════════════════════════════════════════════════════════════

import {
  HeadOutcome,
  ObjectStorageProvider,
} from '../object-storage.interface';
import { evaluateWriteErrorSettlement } from '../r2-storage.provider';
import { StorageOperationError } from '../storage-errors';
import { VideoMediaConfig } from '../video-media.config';
import {
  ClaimedJobRow,
  JobLockContext,
  LeaseLostError,
  MediaJobQueueService,
  parseJobStepState,
} from './media-job-queue.service';

interface InMemoryJobState {
  id: number;
  uuid: string;
  mediaAssetId: number;
  jobType: string;
  status: string;
  idempotencyKey: string;
  payloadJson: string | null;
  stepStateJson: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: Date;
  fencingToken: bigint;
  lockedBy: string | null;
  leaseUntil: Date | null;
  heartbeatAt: Date | null;
  lastError: string | null;
  finishedAt: Date | null;
  assetVariantsJson: string | null;
  assetProcessingStatus: string;
  assetIsDeleted: boolean;
}

function createFakeQueueEnvironment(initial?: Partial<InMemoryJobState>) {
  const state: InMemoryJobState = {
    id: 1,
    uuid: 'job-uuid-1',
    mediaAssetId: 10,
    jobType: 'TRANSCODE_VIDEO',
    status: 'PENDING',
    idempotencyKey: 'TRANSCODE_VIDEO:asset-1',
    payloadJson: JSON.stringify({ assetUuid: 'asset-1' }),
    stepStateJson: null,
    attemptCount: 0,
    maxAttempts: 4,
    nextRetryAt: new Date(Date.now() - 1000),
    fencingToken: 0n,
    lockedBy: null,
    leaseUntil: null,
    heartbeatAt: null,
    lastError: null,
    finishedAt: null,
    assetVariantsJson: null,
    assetProcessingStatus: 'PROCESSING',
    assetIsDeleted: false,
    ...initial,
  };

  const toClaimedRow = (s: InMemoryJobState): ClaimedJobRow => ({
    id: s.id,
    uuid: s.uuid,
    media_asset_id: s.mediaAssetId,
    job_type: s.jobType,
    status: s.status,
    idempotency_key: s.idempotencyKey,
    payload_json: s.payloadJson,
    step_state_json: s.stepStateJson,
    attempt_count: s.attemptCount,
    max_attempts: s.maxAttempts,
    next_retry_at: s.nextRetryAt,
    fencing_token: s.fencingToken,
    locked_by: s.lockedBy,
    lease_until: s.leaseUntil,
    heartbeat_at: s.heartbeatAt,
    last_error: s.lastError,
    created_at: new Date(),
    updated_at: new Date(),
    finished_at: s.finishedAt,
  });

  const buildTx = (working: InMemoryJobState) => ({
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join(' ');
        // سحب أو قفل في runFencedMutation (الشروط الأربعة: status = 'PROCESSING', locked_by, fencing_token, lease_until > now())
        if (
          sql.includes('UPDATE media_processing_jobs') &&
          sql.includes('AND locked_by =')
        ) {
          const hasExtend = sql.includes('lease_until = now() +');
          const jobId = Number(values[hasExtend ? 1 : 0]);
          const workerId = String(values[hasExtend ? 2 : 1]);
          const fencingToken = BigInt(values[hasExtend ? 3 : 2] as bigint);
          const now = new Date();

          const condId = working.id === jobId;
          const condStatus = working.status === 'PROCESSING';
          const condWorker = working.lockedBy === workerId;
          const condToken = working.fencingToken === fencingToken;
          const condLease =
            working.leaseUntil !== null &&
            working.leaseUntil.getTime() > now.getTime();

          if (condId && condStatus && condWorker && condToken && condLease) {
            working.heartbeatAt = now;
            if (hasExtend) {
              const sec = Number(values[0]);
              working.leaseUntil = new Date(now.getTime() + sec * 1000);
            }
            return [toClaimedRow(working)];
          }
          return [];
        }

        // recoverStaleLeases SELECT ... FOR UPDATE SKIP LOCKED
        if (
          sql.includes('FROM media_processing_jobs') &&
          sql.includes('FOR UPDATE SKIP LOCKED')
        ) {
          if (
            working.status === 'PROCESSING' &&
            working.leaseUntil !== null &&
            working.leaseUntil.getTime() <= Date.now()
          ) {
            return [toClaimedRow(working)];
          }
          return [];
        }

        // sweepOrphanGenerationKeys SELECT * FROM media_processing_jobs WHERE id = ... FOR UPDATE
        if (
          sql.includes('FROM media_processing_jobs') &&
          sql.includes('FOR UPDATE') &&
          !sql.includes('SKIP LOCKED')
        ) {
          const targetId = Number(values[0]);
          if (working.id === targetId) {
            return [toClaimedRow(working)];
          }
          return [];
        }

        return [];
      },
    ),
    mediaProcessingJob: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status !== undefined) working.status = String(data.status);
        if (data.stepStateJson !== undefined)
          working.stepStateJson = data.stepStateJson as string | null;
        if (data.attemptCount !== undefined)
          working.attemptCount = Number(data.attemptCount);
        if (data.nextRetryAt !== undefined)
          working.nextRetryAt = data.nextRetryAt as Date;
        if (data.lockedBy !== undefined)
          working.lockedBy = data.lockedBy as string | null;
        if (data.leaseUntil !== undefined)
          working.leaseUntil = data.leaseUntil as Date | null;
        if (data.lastError !== undefined)
          working.lastError = data.lastError as string | null;
        if (data.finishedAt !== undefined)
          working.finishedAt = data.finishedAt as Date | null;
        return working;
      }),
    },
    mediaAsset: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.variantsJson !== undefined)
          working.assetVariantsJson = data.variantsJson as string | null;
        if (data.processingStatus !== undefined)
          working.assetProcessingStatus = String(data.processingStatus);
        return working;
      }),
    },
    mediaUploadSession: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  });

  const prismaMock = {
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join(' ');
        if (
          sql.includes('UPDATE media_processing_jobs') &&
          sql.includes('FOR UPDATE SKIP LOCKED')
        ) {
          const workerId = String(values[0]);
          const leaseSec = Number(values[1]);
          if (
            (state.status === 'PENDING' || state.status === 'RETRYING') &&
            state.nextRetryAt.getTime() <= Date.now()
          ) {
            state.status = 'PROCESSING';
            state.fencingToken += 1n;
            state.lockedBy = workerId;
            state.leaseUntil = new Date(Date.now() + leaseSec * 1000);
            state.heartbeatAt = new Date();
            return [toClaimedRow(state)];
          }
          return [];
        }
        if (sql.includes("WHERE status = 'PROCESSING'")) {
          if (
            state.status === 'PROCESSING' &&
            state.leaseUntil !== null &&
            state.leaseUntil.getTime() <= Date.now()
          ) {
            return [{ id: state.id }];
          }
          return [];
        }
        return [{ id: state.id }];
      },
    ),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot: InMemoryJobState = { ...state };
      const tx = buildTx(snapshot);
      const res = await fn(tx);
      Object.assign(state, snapshot);
      return res;
    }),
    mediaProcessingJob: {
      findUnique: jest.fn(async () => ({
        id: state.id,
        status: state.status,
        fencingToken: state.fencingToken,
        leaseUntil: state.leaseUntil,
        stepStateJson: state.stepStateJson,
        mediaAsset: {
          id: state.mediaAssetId,
          uuid: 'asset-1',
          storageProvider: 'LOCAL',
          variantsJson: state.assetVariantsJson,
          isDeleted: state.assetIsDeleted,
        },
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.stepStateJson !== undefined) {
          state.stepStateJson = data.stepStateJson as string | null;
        }
        return state;
      }),
    },
  };

  const config = new VideoMediaConfig();
  const queue = new MediaJobQueueService(prismaMock as any, config);
  return { state, queue, prismaMock };
}

describe('P4-4: السياج الأربعي وفصل المحاولات ومعيار write_settled الصارم (v1.7)', () => {
  it('1) يرفض الكتابة ويتراجع عن المعاملة بالكامل (ROLLBACK) عند اختلال أي شرط من الشروط الأربعة', async () => {
    const { state, queue } = createFakeQueueEnvironment();
    const claimed = await queue.claimNextJob('worker-A', 300);
    expect(claimed).not.toBeNull();
    const ctxA: JobLockContext = {
      jobId: state.id,
      workerId: 'worker-A',
      fencingToken: 1n,
    };

    // الحالة أ: اختلاف fencing_token (عامل قديم يحمل التوكن 0)
    await expect(
      queue.runFencedMutation({ ...ctxA, fencingToken: 0n }, async (tx) => {
        await tx.mediaAsset.update({
          where: { id: state.mediaAssetId },
          data: { processingStatus: 'DONE' },
        });
      }),
    ).rejects.toThrow(LeaseLostError);
    expect(state.assetProcessingStatus).toBe('PROCESSING');

    // الحالة ب: اختلاف locked_by
    await expect(
      queue.runFencedMutation({ ...ctxA, workerId: 'worker-B' }, async (tx) => {
        await tx.mediaAsset.update({
          where: { id: state.mediaAssetId },
          data: { processingStatus: 'DONE' },
        });
      }),
    ).rejects.toThrow(LeaseLostError);
    expect(state.assetProcessingStatus).toBe('PROCESSING');

    // الحالة ج: انتهاء صلاحية القفل (lease_until <= now())
    state.leaseUntil = new Date(Date.now() - 1000);
    await expect(
      queue.runFencedMutation(ctxA, async (tx) => {
        await tx.mediaAsset.update({
          where: { id: state.mediaAssetId },
          data: { processingStatus: 'DONE' },
        });
      }),
    ).rejects.toThrow(LeaseLostError);
    expect(state.assetProcessingStatus).toBe('PROCESSING');

    // الحالة د: تغير الحالة عن PROCESSING
    state.leaseUntil = new Date(Date.now() + 60_000);
    state.status = 'RETRYING';
    await expect(
      queue.runFencedMutation(ctxA, async (tx) => {
        await tx.mediaAsset.update({
          where: { id: state.mediaAssetId },
          data: { processingStatus: 'DONE' },
        });
      }),
    ).rejects.toThrow(LeaseLostError);
    expect(state.assetProcessingStatus).toBe('PROCESSING');
  });

  it('2) يفصل بصرامة بين fencing_token و attempt_count عبر دورة السحب والإيقاف الرشيق وضغط القرص واستعادة القفل والفشل', async () => {
    const { state, queue } = createFakeQueueEnvironment();

    // السحب الأول: fencing_token = 1، attempt_count = 0
    const claim1 = await queue.claimNextJob('worker-1', 300);
    expect(claim1?.fencing_token).toBe(1n);
    expect(state.attemptCount).toBe(0);

    // تحرير بسبب الإيقاف الرشيق (SIGTERM): attempt_count يبقى 0
    await queue.releaseOnGracefulShutdown({
      jobId: state.id,
      workerId: 'worker-1',
      fencingToken: 1n,
    });
    expect(state.status).toBe('RETRYING');
    expect(state.attemptCount).toBe(0);

    // السحب الثاني: fencing_token = 2، attempt_count = 0
    state.nextRetryAt = new Date(Date.now() - 100);
    const claim2 = await queue.claimNextJob('worker-2', 300);
    expect(claim2?.fencing_token).toBe(2n);
    expect(state.attemptCount).toBe(0);

    // تأجيل بسبب ضغط القرص المؤقت (DISK_PRESSURE): attempt_count يبقى 0
    await queue.deferOnDiskPressure(
      { jobId: state.id, workerId: 'worker-2', fencingToken: 2n },
      'Free space below required threshold',
    );
    expect(state.status).toBe('RETRYING');
    expect(state.attemptCount).toBe(0);

    // السحب الثالث ثم انتهاء صلاحية القفل واستعادته (recoverStaleLeases): attempt_count يبقى 0
    state.nextRetryAt = new Date(Date.now() - 100);
    const claim3 = await queue.claimNextJob('worker-3', 300);
    expect(claim3?.fencing_token).toBe(3n);
    state.leaseUntil = new Date(Date.now() - 5000);
    const rec = await queue.recoverStaleLeases();
    expect(rec.recoveredToRetrying).toBe(1);
    expect(state.attemptCount).toBe(0);

    // السحب الرابع ثم فشل معالجة فعلي (failOrRetryJob): هنا فقط يزيد attempt_count بمقدار +1
    state.nextRetryAt = new Date(Date.now() - 100);
    const claim4 = await queue.claimNextJob('worker-4', 300);
    expect(claim4?.fencing_token).toBe(4n);
    const failRes = await queue.failOrRetryJob(
      { jobId: state.id, workerId: 'worker-4', fencingToken: 4n },
      'FFMPEG_NON_ZERO_EXIT',
    );
    expect(failRes.status).toBe('RETRYING');
    expect(failRes.attemptCount).toBe(1);
    expect(state.attemptCount).toBe(1);
  });

  describe('3) الحالات الأربع الإلزامية لمعنى write_settled وإغلاق سجل الجيل (v1.7)', () => {
    function createFakeProvider(existingKeys: Set<string>): {
      provider: ObjectStorageProvider;
      deletedKeys: string[];
    } {
      const deletedKeys: string[] = [];
      const provider: ObjectStorageProvider = {
        name: 'LOCAL',
        uploadFromFile: jest.fn(),
        copyObject: jest.fn(),
        verifyStoredObjectSha256: jest.fn(),
        getObjectStream: jest.fn(),
        deleteObject: jest.fn(async (key: string) => {
          deletedKeys.push(key);
          existingKeys.delete(key);
        }),
        headObject: jest.fn(async (key: string): Promise<HeadOutcome> => {
          if (existingKeys.has(key)) {
            return {
              kind: 'FOUND',
              info: { key, sizeBytes: 1024, etag: null },
            };
          }
          return { kind: 'NOT_FOUND' };
        }),
      };
      return { provider, deletedKeys };
    }

    it('الحالة (1): نجاح الكتابة واستلام استجابة نهائية مؤكدة (2xx/rename) -> write_settled=true -> ينتقل إلى RECONCILIATION_CLOSED بعد الحذف وتأكيد 404', async () => {
      const { state, queue } = createFakeQueueEnvironment();
      await queue.claimNextJob('worker-1', 300);
      const ctx1: JobLockContext = {
        jobId: state.id,
        workerId: 'worker-1',
        fencingToken: 1n,
      };
      const keyF1 = 'media/school-1/asset-1/f1/360p.mp4';

      await queue.registerGenerationCandidateKeys(ctx1, [keyF1]);
      await queue.markGenerationWriteInitiated(ctx1, keyF1);
      await queue.markGenerationWriteDefinitiveOutcome(ctx1, keyF1, {
        settled: true,
        reason: 'DEFINITIVE_SUCCESS',
      });

      // محاكاة انتهاء الجيل 1 وانتقال المهمة إلى COMPLETED بواسطة جيل لاحق
      state.status = 'COMPLETED';
      const existingKeys = new Set<string>([keyF1]);
      const { provider, deletedKeys } = createFakeProvider(existingKeys);

      const sweepRes = await queue.sweepOrphanGenerationKeys(() => provider, {
        jobId: state.id,
      });

      expect(deletedKeys).toContain(keyF1);
      expect(sweepRes.generationsClosed).toBe(1);
      expect(sweepRes.generationsVerifiedAbsent).toBe(0);

      const stepState = parseJobStepState(state.stepStateJson);
      expect(
        stepState.generations_registry?.['1'].keys[keyF1].write_settled,
      ).toBe(true);
      expect(stepState.generations_registry?.['1'].reconciliation_status).toBe(
        'RECONCILIATION_CLOSED',
      );
    });

    it('الحالة (2): إلغاء مؤكد للعملية قبل تثبيت الكائن (Confirmed Abort) -> write_settled=true -> ينتقل إلى RECONCILIATION_CLOSED بعد تأكيد 404', async () => {
      const { state, queue } = createFakeQueueEnvironment();
      await queue.claimNextJob('worker-1', 300);
      const ctx1: JobLockContext = {
        jobId: state.id,
        workerId: 'worker-1',
        fencingToken: 1n,
      };
      const keyF1 = 'media/school-1/asset-1/f1/480p.mp4';

      await queue.registerGenerationCandidateKeys(ctx1, [keyF1]);
      await queue.markGenerationWriteInitiated(ctx1, keyF1);

      const outcome = evaluateWriteErrorSettlement(new Error('Aborted'), {
        confirmedServerSideAbortBeforeComplete: true,
      });
      expect(outcome).toEqual({
        settled: true,
        reason: 'DEFINITIVE_ABORT_OR_PRE_COMMIT_REJECT',
      });

      await queue.markGenerationWriteDefinitiveOutcome(ctx1, keyF1, outcome);
      state.status = 'COMPLETED';

      const existingKeys = new Set<string>();
      const { provider } = createFakeProvider(existingKeys);

      const sweepRes = await queue.sweepOrphanGenerationKeys(() => provider, {
        jobId: state.id,
      });

      expect(sweepRes.generationsClosed).toBe(1);
      const stepState = parseJobStepState(state.stepStateJson);
      expect(stepState.generations_registry?.['1'].reconciliation_status).toBe(
        'RECONCILIATION_CLOSED',
      );
    });

    it('الحالة (3): انقطاع الاتصال (ECONNRESET) بعد إرسال الطلب وقبل معرفة نتيجة المزود -> يبقى write_settled=false ويُمنع RECONCILIATION_CLOSED', async () => {
      const { state, queue } = createFakeQueueEnvironment();
      await queue.claimNextJob('worker-1', 300);
      const ctx1: JobLockContext = {
        jobId: state.id,
        workerId: 'worker-1',
        fencingToken: 1n,
      };
      const keyF1 = 'media/school-1/asset-1/f1/720p.mp4';

      await queue.registerGenerationCandidateKeys(ctx1, [keyF1]);
      await queue.markGenerationWriteInitiated(ctx1, keyF1);

      // انقطاع الشبكة بعد إرسال الطلب: Promise انتهى محلياً، لكن مصير المزود ملتبس
      const netErr = new StorageOperationError(
        'TRANSIENT',
        'ECONNRESET',
        true,
        undefined,
        'r2.upload',
      );
      const outcome = evaluateWriteErrorSettlement(netErr);
      expect(outcome).toEqual({
        settled: false,
        reason: 'AMBIGUOUS_OUTCOME',
      });

      await queue.markGenerationWriteDefinitiveOutcome(ctx1, keyF1, outcome);
      state.status = 'COMPLETED';

      const existingKeys = new Set<string>();
      const { provider } = createFakeProvider(existingKeys);

      const sweepRes = await queue.sweepOrphanGenerationKeys(() => provider, {
        jobId: state.id,
      });

      expect(sweepRes.generationsClosed).toBe(0);
      expect(sweepRes.generationsVerifiedAbsent).toBe(1);

      const stepState = parseJobStepState(state.stepStateJson);
      expect(
        stepState.generations_registry?.['1'].keys[keyF1].write_settled,
      ).toBe(false);
      expect(stepState.generations_registry?.['1'].reconciliation_status).toBe(
        'VERIFIED_ABSENT',
      );
    });

    it('الحالة (4): انتهاء المهلة (Timeout/AbortSignal) مع احتمال استمرار العملية لدى المزود + ظهور كائن متأخر بعد VERIFIED_ABSENT', async () => {
      const { state, queue } = createFakeQueueEnvironment();
      await queue.claimNextJob('worker-1', 300);
      const ctx1: JobLockContext = {
        jobId: state.id,
        workerId: 'worker-1',
        fencingToken: 1n,
      };
      const keyF1 = 'media/school-1/asset-1/f1/360p.mp4';
      const adoptedKeyF2 = 'media/school-1/asset-1/f2/360p.mp4';

      await queue.registerGenerationCandidateKeys(ctx1, [keyF1]);
      await queue.markGenerationWriteInitiated(ctx1, keyF1);

      // انتهاء المهلة أثناء وجود الكتابة في الخلفية
      const timeoutErr = new StorageOperationError(
        'ABORTED',
        'TimeoutError',
        false,
        undefined,
        'r2.upload',
      );
      const outcome = evaluateWriteErrorSettlement(timeoutErr);
      expect(outcome.settled).toBe(false);
      await queue.markGenerationWriteDefinitiveOutcome(ctx1, keyF1, outcome);

      // اعتماد الجيل 2 في variants_json واكتمال المهمة
      state.assetVariantsJson = JSON.stringify({
        schema_version: 1,
        quality_ladder: [360],
        preferred_variant: '360p',
        variants: {
          '360p': {
            storage_key: adoptedKeyF2,
            height: 360,
            width: 640,
            size_bytes: 2048,
            sha256: 'a'.repeat(64),
            status: 'VERIFIED',
            verified_at: new Date().toISOString(),
          },
        },
      });
      state.status = 'COMPLETED';

      // المسحة الأولى: الكائن المتأخر لم يظهر بعد (404) -> ينتقل إلى VERIFIED_ABSENT (وليس RECONCILIATION_CLOSED حتى مع assetDeleted=true!)
      const existingKeys = new Set<string>([adoptedKeyF2]);
      const { provider, deletedKeys } = createFakeProvider(existingKeys);

      const pass1 = await queue.sweepOrphanGenerationKeys(() => provider, {
        jobId: state.id,
        assetDeleted: true,
        now: new Date(Date.now()),
      });
      expect(pass1.generationsClosed).toBe(0);
      expect(pass1.generationsVerifiedAbsent).toBe(1);

      // الآن نعيد assetDeleted = false ونحاكي ظهور الكائن المتأخر keyF1 بعد انتقال الجيل إلى VERIFIED_ABSENT!
      existingKeys.add(keyF1);
      existingKeys.add(adoptedKeyF2);
      deletedKeys.length = 0;

      const futureNow = new Date(Date.now() + 15 * 60 * 1000);
      const pass2 = await queue.sweepOrphanGenerationKeys(() => provider, {
        jobId: state.id,
        now: futureNow,
      });

      // تم اكتشاف وحذف الكائن المتأخر keyF1 دون المساس بالمفتاح المعتمد adoptedKeyF2!
      expect(deletedKeys).toContain(keyF1);
      expect(deletedKeys).not.toContain(adoptedKeyF2);
      expect(existingKeys.has(keyF1)).toBe(false);
      expect(existingKeys.has(adoptedKeyF2)).toBe(true);
      expect(pass2.generationsVerifiedAbsent).toBe(1);
    });

    it('الحالة (5): تزامن sweepOrphanGenerationKeys مع العامل النشط f2 أثناء فحص المزود -> يعيد قراءة stepStateJson تحت FOR UPDATE ويدمج مدخل f1 فقط دون مسح تحديثات f2', async () => {
      const { state, queue } = createFakeQueueEnvironment();
      await queue.claimNextJob('worker-f1', 300);
      const ctx1: JobLockContext = {
        jobId: state.id,
        workerId: 'worker-f1',
        fencingToken: 1n,
      };
      const keyF1 = 'media/school-1/asset-1/f1/360p.mp4';
      await queue.registerGenerationCandidateKeys(ctx1, [keyF1]);
      await queue.markGenerationWriteInitiated(ctx1, keyF1);
      await queue.markGenerationWriteDefinitiveOutcome(ctx1, keyF1, {
        settled: true,
        reason: 'DEFINITIVE_SUCCESS',
      });

      // انتهاء إيجار f1 واستعادته ثم سحبه بواسطة العامل النشط f2
      state.leaseUntil = new Date(Date.now() - 10_000);
      await queue.recoverStaleLeases();
      state.nextRetryAt = new Date(Date.now() - 1_000);
      const claimedF2 = await queue.claimNextJob('worker-f2', 300);
      expect(claimedF2).not.toBeNull();
      const ctx2: JobLockContext = {
        jobId: state.id,
        workerId: 'worker-f2',
        fencingToken: 2n,
      };
      const keyF2_360 = 'media/school-1/asset-1/f2/360p.mp4';
      const keyF2_480 = 'media/school-1/asset-1/f2/480p.mp4';
      await queue.registerGenerationCandidateKeys(ctx2, [keyF2_360, keyF2_480]);

      const existingKeys = new Set<string>([keyF1]);
      const deletedKeys: string[] = [];

      // أثناء قيام الماسح بحذف keyF1 خارج قفل DB، يقوم العامل f2 بتحديث stepStateJson (توثيق خطوة 360p وتسجيل كتابة 480p)
      const interleavingProvider: ObjectStorageProvider = {
        name: 'LOCAL',
        uploadFromFile: jest.fn(),
        verifyStoredObjectSha256: jest.fn(),
        copyObject: jest.fn(),
        getObjectStream: jest.fn(),
        deleteObject: jest.fn(async (key: string) => {
          existingKeys.delete(key);
          deletedKeys.push(key);
          // العامل f2 يجري تحديثات متزامنة على stepStateJson بعد أن قرأ الماسح النسخة القديمة!
          await queue.markGenerationWriteInitiated(ctx2, keyF2_360);
          await queue.markGenerationWriteDefinitiveOutcome(ctx2, keyF2_360, {
            settled: true,
            reason: 'DEFINITIVE_SUCCESS',
          });
          await queue.runFencedMutation(ctx2, async (tx, jobRow) => {
            const st = parseJobStepState(jobRow.step_state_json);
            st.variants_verified = {
              ...(st.variants_verified ?? {}),
              '360p': true,
            };
            st.fallback_profile = { '480p': true };
            await tx.mediaProcessingJob.update({
              where: { id: ctx2.jobId },
              data: { stepStateJson: JSON.stringify(st) },
            });
          });
        }),
        headObject: jest.fn(async (key: string): Promise<HeadOutcome> => {
          if (existingKeys.has(key)) {
            return {
              kind: 'FOUND',
              info: { key, sizeBytes: 1024, etag: null },
            };
          }
          return { kind: 'NOT_FOUND' };
        }),
      };

      const sweepRes = await queue.sweepOrphanGenerationKeys(
        () => interleavingProvider,
        { jobId: state.id },
      );

      expect(deletedKeys).toContain(keyF1);
      expect(sweepRes.generationsClosed).toBe(1);

      const finalStepState = parseJobStepState(state.stepStateJson);
      // 1) مدخل الجيل القديم f1 أُغلق بنجاح
      expect(
        finalStepState.generations_registry?.['1'].reconciliation_status,
      ).toBe('RECONCILIATION_CLOSED');
      // 2) جميع تحديثات العامل النشط f2 التي حدثت أثناء عمل الماسح محفوظة بالكامل ولم تُمحَ!
      expect(finalStepState.variants_verified?.['360p']).toBe(true);
      expect(finalStepState.fallback_profile?.['480p']).toBe(true);
      expect(
        finalStepState.generations_registry?.['2'].reconciliation_status,
      ).toBe('ACTIVE');
      expect(
        finalStepState.generations_registry?.['2'].keys[keyF2_360]
          .write_initiated,
      ).toBe(true);
      expect(
        finalStepState.generations_registry?.['2'].keys[keyF2_360]
          .write_settled,
      ).toBe(true);
    });
  });
});
