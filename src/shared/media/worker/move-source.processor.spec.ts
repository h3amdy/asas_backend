/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/no-base-to-string */
// src/shared/media/worker/move-source.processor.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — اختبارات وحدة MoveSourceProcessor (v1.7)
// مرجع: p4-4-design-and-audit.md (v1.7 §2.1 & §6)
// ═══════════════════════════════════════════════════════════════

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { computeFileDigest } from '../file-digest.util';
import { LocalObjectStorageProvider } from '../local-object-storage.provider';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { StorageService } from '../storage.service';
import { VideoMediaConfig } from '../video-media.config';
import {
  ClaimedJobRow,
  JobLockContext,
  JobStepState,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';
import { MoveSourceProcessor } from './move-source.processor';
import { parseVariantsManifest } from './video-transcode.processor';

describe('P4-4: MoveSourceProcessor (v1.7)', () => {
  let tmpStorageRoot: string;
  let storageService: StorageService;
  let localProvider: LocalObjectStorageProvider;
  let storageRegistry: ObjectStorageRegistry;
  let config: VideoMediaConfig;

  beforeEach(async () => {
    tmpStorageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'asas-p44-movesource-unit-'),
    );
    process.env.MEDIA_STORAGE_PATH = tmpStorageRoot;
    storageService = new StorageService();
    localProvider = new LocalObjectStorageProvider(storageService);
    storageRegistry = {
      get: jest.fn(() => localProvider),
    } as unknown as ObjectStorageRegistry;
    config = new VideoMediaConfig();
  });

  afterEach(async () => {
    await fsp
      .rm(tmpStorageRoot, { recursive: true, force: true })
      .catch(() => undefined);
    jest.restoreAllMocks();
  });

  async function seedReadySource(
    assetUuid: string,
    schoolUuid: string,
  ): Promise<{ key: string; sizeBytes: number; sha256Hex: string }> {
    const tmpFile = path.join(tmpStorageRoot, 'tmp', 'seed-original.mp4');
    await fsp.writeFile(
      tmpFile,
      Buffer.from('original-video-source-bytes-123'),
    );
    const digest = await computeFileDigest(tmpFile);
    const key = `video-sources/ready/${schoolUuid}/${assetUuid}/f1/original.mp4`;
    await localProvider.uploadFromFile(tmpFile, key, {
      contentType: 'video/mp4',
      digest,
    });
    return {
      key,
      sizeBytes: digest.sizeBytes,
      sha256Hex: digest.sha256Hex,
    };
  }

  function buildMoveFixture(params: {
    assetUuid: string;
    schoolUuid: string;
    initialSourceKey: string;
    initialLocation: 'READY' | 'HOLD';
    sizeBytes: number;
    sha256Hex: string;
    targetLocation: 'READY' | 'HOLD';
    initialStepState?: JobStepState;
  }) {
    const state = {
      jobStatus: 'PROCESSING',
      attemptCount: 0,
      maxAttempts: 4,
      fencingToken: 2n,
      lockedBy: 'worker-move-1',
      leaseUntil: new Date(Date.now() + 300_000),
      stepStateJson: params.initialStepState
        ? JSON.stringify(params.initialStepState)
        : null,
      lastError: null as string | null,
      assetVariantsJson: JSON.stringify({
        schema_version: 1,
        quality_ladder: [360],
        preferred_variant: '360p',
        variants: {},
        source: {
          storage_key: params.initialSourceKey,
          ext: 'mp4',
          location: params.initialLocation,
          size_bytes: params.sizeBytes,
          sha256: params.sha256Hex,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        },
      }),
    };

    const toClaimedRow = (): ClaimedJobRow => ({
      id: 202,
      uuid: 'job-move-202',
      media_asset_id: 602,
      job_type: 'MOVE_SOURCE',
      status: state.jobStatus,
      idempotency_key: `MOVE_SOURCE:${params.assetUuid}:${params.targetLocation}`,
      payload_json: JSON.stringify({
        assetUuid: params.assetUuid,
        targetLocation: params.targetLocation,
      }),
      step_state_json: state.stepStateJson,
      attempt_count: state.attemptCount,
      max_attempts: state.maxAttempts,
      next_retry_at: new Date(),
      fencing_token: state.fencingToken,
      locked_by: state.lockedBy,
      lease_until: state.leaseUntil,
      heartbeat_at: new Date(),
      last_error: state.lastError,
      created_at: new Date(),
      updated_at: new Date(),
      finished_at: null,
    });

    const txMock = {
      $queryRaw: jest.fn(async () => [toClaimedRow()]),
      mediaProcessingJob: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.status !== undefined) state.jobStatus = String(data.status);
          if (data.attemptCount !== undefined)
            state.attemptCount = Number(data.attemptCount);
          if (data.stepStateJson !== undefined)
            state.stepStateJson = data.stepStateJson as string | null;
          if (data.lastError !== undefined)
            state.lastError = data.lastError as string | null;
          return state;
        }),
      },
      mediaAsset: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 602,
          uuid: params.assetUuid,
          variantsJson: state.assetVariantsJson,
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.variantsJson !== undefined)
            state.assetVariantsJson = String(data.variantsJson ?? '');
          return state;
        }),
      },
      mediaUploadSession: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };

    const prismaMock = {
      mediaAsset: {
        findUnique: jest.fn(async () => ({
          id: 602,
          uuid: params.assetUuid,
          ownerType: 'SCHOOL',
          storageProvider: 'LOCAL',
          variantsJson: state.assetVariantsJson,
          isDeleted: false,
          school: { uuid: params.schoolUuid },
        })),
      },
      mediaProcessingJob: {
        findUnique: jest.fn(async () => ({
          id: 202,
          status: state.jobStatus,
          fencingToken: state.fencingToken,
          leaseUntil: state.leaseUntil,
          stepStateJson: state.stepStateJson,
          mediaAsset: {
            id: 602,
            uuid: params.assetUuid,
            storageProvider: 'LOCAL',
            variantsJson: state.assetVariantsJson,
            isDeleted: false,
          },
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.stepStateJson !== undefined)
            state.stepStateJson = data.stepStateJson as string | null;
          return state;
        }),
      },
      $queryRaw: jest.fn(async () => [{ id: 202 }]),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(txMock),
      ),
    };

    const queue = new MediaJobQueueService(prismaMock as any, config);
    const processor = new MoveSourceProcessor(
      prismaMock as any,
      config,
      storageRegistry,
      queue,
    );
    const ctx: JobLockContext = {
      jobId: 202,
      workerId: 'worker-move-1',
      fencingToken: 2n,
    };

    return { state, toClaimedRow, queue, processor, ctx };
  }

  it('1) ينقل المصدر ذرّياً من ready/ إلى hold/ مع التسجيل المسبق والتحقق الكامل من SHA-256 وحذف المفتاح القديم', async () => {
    const assetUuid = 'asset-move-1';
    const schoolUuid = 'school-move-1';
    const seeded = await seedReadySource(assetUuid, schoolUuid);

    const { state, toClaimedRow, processor, ctx } = buildMoveFixture({
      assetUuid,
      schoolUuid,
      initialSourceKey: seeded.key,
      initialLocation: 'READY',
      sizeBytes: seeded.sizeBytes,
      sha256Hex: seeded.sha256Hex,
      targetLocation: 'HOLD',
    });

    await processor.processClaimedJob(toClaimedRow(), ctx);

    expect(state.jobStatus).toBe('COMPLETED');
    const manifest = parseVariantsManifest(state.assetVariantsJson);
    const expectedHoldKey = `video-sources/hold/${schoolUuid}/${assetUuid}/f2/original.mp4`;
    expect(manifest.source?.location).toBe('HOLD');
    expect(manifest.source?.storage_key).toBe(expectedHoldKey);

    // المفتاح الجديد موجود والمفتاح القديم حُذف وتأكد اختفاؤه (NOT_FOUND)
    expect((await localProvider.headObject(expectedHoldKey)).kind).toBe(
      'FOUND',
    );
    expect((await localProvider.headObject(seeded.key)).kind).toBe('NOT_FOUND');
  });

  it('2) يرفض النقل ويحافظ على المفتاح الأصلي عند اكتشاف تلف بايت واحد في SHA-256 للملف المنسوخ', async () => {
    const assetUuid = 'asset-move-corrupt';
    const schoolUuid = 'school-move-1';
    const seeded = await seedReadySource(assetUuid, schoolUuid);

    const { state, toClaimedRow, processor, ctx } = buildMoveFixture({
      assetUuid,
      schoolUuid,
      initialSourceKey: seeded.key,
      initialLocation: 'READY',
      sizeBytes: seeded.sizeBytes,
      sha256Hex: seeded.sha256Hex,
      targetLocation: 'HOLD',
    });

    // إفساد بايت واحد في الملف المنسوخ بعد copyObject وقبل التحقق من SHA-256
    const origCopy = localProvider.copyObject.bind(localProvider);
    jest
      .spyOn(localProvider, 'copyObject')
      .mockImplementation(async (src, dst, opts) => {
        const res = await origCopy(src, dst, opts);
        const dstFullPath = storageService.resolvePath(dst);
        const buf = await fsp.readFile(dstFullPath);
        buf[0] = buf[0] ^ 0xff;
        await fsp.writeFile(dstFullPath, buf);
        return res;
      });

    await processor.processClaimedJob(toClaimedRow(), ctx);

    expect(state.jobStatus).toBe('RETRYING');
    expect(state.attemptCount).toBe(1);
    expect(state.lastError).toContain('MOVE_SOURCE_INTEGRITY_FAILED');

    // المفتاح الأصلي في ready/ لم يُحذف ولم تتغير بياناته في DB
    expect((await localProvider.headObject(seeded.key)).kind).toBe('FOUND');
    const manifest = parseVariantsManifest(state.assetVariantsJson);
    expect(manifest.source?.storage_key).toBe(seeded.key);
    expect(manifest.source?.location).toBe('READY');
  });

  it('3) يستأنف بأمان من نقطة الانهيار DB_COMMITTED (بعد تحديث DB وقبل حذف المفتاح القديم) دون إعادة النسخ', async () => {
    const assetUuid = 'asset-move-resume';
    const schoolUuid = 'school-move-1';
    const seeded = await seedReadySource(assetUuid, schoolUuid);
    const holdKey = `video-sources/hold/${schoolUuid}/${assetUuid}/f1/original.mp4`;
    await localProvider.copyObject(seeded.key, holdKey);

    const copySpy = jest.spyOn(localProvider, 'copyObject');

    const { state, toClaimedRow, processor, ctx } = buildMoveFixture({
      assetUuid,
      schoolUuid,
      initialSourceKey: holdKey,
      initialLocation: 'HOLD',
      sizeBytes: seeded.sizeBytes,
      sha256Hex: seeded.sha256Hex,
      targetLocation: 'HOLD',
      initialStepState: {
        source: 'HOLD',
        move_source_phase: 'DB_COMMITTED',
        move_source_old_key: seeded.key,
        move_source_target_key: holdKey,
      },
    });

    await processor.processClaimedJob(toClaimedRow(), ctx);

    expect(copySpy).not.toHaveBeenCalled();
    expect(state.jobStatus).toBe('COMPLETED');
    expect((await localProvider.headObject(holdKey)).kind).toBe('FOUND');
    expect((await localProvider.headObject(seeded.key)).kind).toBe('NOT_FOUND');

    const stepState = parseJobStepState(state.stepStateJson);
    expect(stepState.move_source_old_key).toBeUndefined();
  });
});
