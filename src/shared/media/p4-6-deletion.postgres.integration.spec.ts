/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
// src/shared/media/p4-6-deletion.postgres.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🐘 VIDEO P4-6 — اختبارات التكامل الحقيقية لدورة الحذف السباعي على PostgreSQL الفعلي
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §9.2, §9.3, §10.2)
// D-T1..D-T5، الفيديو المشترك، إعادة الربط أثناء الحذف، السباق، تعطل العامل واستعادته، السياج، W-028
// ═══════════════════════════════════════════════════════════════

import { NotFoundException } from '@nestjs/common';
import {
  AppType,
  MediaKind,
  MediaUploadStatus,
  ProcessingStatus,
} from '@prisma/client';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaCleanupService } from '../../school/media/media-cleanup.service';
import { MediaAccessPolicyService } from './media-access-policy.service';
import { MediaLifecycleService } from './media-lifecycle.service';
import { HeadOutcome, ObjectStorageProvider } from './object-storage.interface';
import { ObjectStorageRegistry } from './object-storage.registry';
import {
  JobLockContext,
  MediaJobQueueService,
} from './queue/media-job-queue.service';
import { StorageService } from './storage.service';
import { VideoMediaConfig } from './video-media.config';
import {
  DELETE_OBJECTS_JOB,
  DeleteObjectsProcessor,
} from './worker/delete-objects.processor';
import { MediaWorkerService } from './worker/media-worker.service';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DAY_MS = 24 * 60 * 60 * 1000;

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p46_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: test database name "${dbName}" violates format.`);
  }
  const lower = dbName.toLowerCase();
  if (
    lower.includes('prod') ||
    lower.includes('staging') ||
    lower.includes('dev')
  ) {
    throw new Error(`SAFETY: "${dbName}" matches a protected database name.`);
  }
}

function createDeferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * مزود R2 وهمي في الذاكرة مع حقن أعطال صريحة (403 / 5xx / Timeout / حذف صامت فاشل).
 * لا يدعم ListObjects إطلاقاً — يثبت أن الدورة تعمل بالمفاتيح المعروفة فقط.
 */
class FakeR2Provider implements ObjectStorageProvider {
  readonly name = 'R2' as const;
  readonly objects = new Set<string>();
  readonly headOverride = new Map<string, HeadOutcome>();
  readonly deleteNoop = new Set<string>();
  readonly deleteThrow = new Map<string, Error>();
  readonly deleteCalls: string[] = [];

  reset(): void {
    this.objects.clear();
    this.headOverride.clear();
    this.deleteNoop.clear();
    this.deleteThrow.clear();
    this.deleteCalls.length = 0;
  }

  async headObject(key: string): Promise<HeadOutcome> {
    const o = this.headOverride.get(key);
    if (o) return o;
    return this.objects.has(key)
      ? { kind: 'FOUND', info: { key, sizeBytes: 1, etag: null } }
      : { kind: 'NOT_FOUND' };
  }

  async deleteObject(key: string): Promise<void> {
    this.deleteCalls.push(key);
    const err = this.deleteThrow.get(key);
    if (err) throw err;
    if (this.deleteNoop.has(key)) return;
    this.objects.delete(key);
  }

  uploadFromFile(): never {
    throw new Error('not used');
  }
  copyObject(): never {
    throw new Error('not used');
  }
  verifyStoredObjectSha256(): never {
    throw new Error('not used');
  }
  async getObjectStream(): Promise<Readable> {
    throw new Error('not used');
  }
}

describe('VIDEO P4-6 — Deletion Lifecycle & Safe R2 Cleanup (Real PostgreSQL)', () => {
  jest.setTimeout(180_000);

  let tempDbName = '';
  let dbCreated = false;
  let prisma: PrismaService;
  let prismaPeer: PrismaService;
  let tmpStorageDir = '';
  let prevStoragePath: string | undefined;

  let storage: StorageService;
  let fakeR2: FakeR2Provider;
  let registry: ObjectStorageRegistry;
  let config: VideoMediaConfig;
  let lifecycle: MediaLifecycleService;
  let lifecyclePeer: MediaLifecycleService;
  let queue: MediaJobQueueService;
  let deleteProcessor: DeleteObjectsProcessor;
  let worker: MediaWorkerService;
  let cleanup: MediaCleanupService;
  let cleanupPeer: MediaCleanupService;

  let schoolId: number;
  let schoolUuid: string;
  let blockAId: number;
  let blockBId: number;
  let templateAId: number;

  // ── مساعدات ──
  const keysFor = (uuid: string) => ({
    thumb: `media/${schoolUuid}/${uuid}/f1/thumb.webp`,
    v360: `media/${schoolUuid}/${uuid}/f1/360p.mp4`,
    v480: `media/${schoolUuid}/${uuid}/f1/480p.mp4`,
    source: `video-sources/ready/${schoolUuid}/${uuid}/f1/original.mp4`,
    orphan: `media/${schoolUuid}/${uuid}/f2/720p.mp4`,
  });

  /** ينشئ أصل فيديو R2 مكتمل بمفاتيح في variants_json + جيل يتيم مسجل في مهمة TRANSCODE منتهية */
  async function createVideoAsset(opts?: {
    softDeletedDaysAgo?: number;
    withStaging?: boolean;
  }) {
    const uuid = crypto.randomUUID();
    const k = keysFor(uuid);
    const variantsJson = JSON.stringify({
      schema_version: 1,
      quality_ladder: [360, 480],
      preferred_variant: '480p',
      thumb: { storage_key: k.thumb },
      variants: {
        '360p': { storage_key: k.v360 },
        '480p': { storage_key: k.v480 },
      },
      source: { storage_key: k.source, location: 'READY' },
    });
    const deletedAt =
      opts?.softDeletedDaysAgo !== undefined
        ? new Date(Date.now() - opts.softDeletedDaysAgo * DAY_MS)
        : null;
    const asset = await prisma.mediaAsset.create({
      data: {
        uuid,
        schoolId,
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'R2',
        storageKey: k.v480,
        contentType: 'video/mp4',
        processingStatus: ProcessingStatus.DONE,
        variantsJson,
        isDeleted: deletedAt !== null,
        deletedAt,
      },
    });
    await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'TRANSCODE_VIDEO',
        status: 'COMPLETED',
        idempotencyKey: `TRANSCODE_VIDEO:${uuid}`,
        finishedAt: new Date(),
        stepStateJson: JSON.stringify({
          generations_registry: {
            '2': {
              fencing_token: '2',
              registered_at: new Date().toISOString(),
              lease_expires_at: new Date().toISOString(),
              keys: {
                [k.orphan]: { write_initiated: true, write_settled: true },
              },
              reconciliation_status: 'RECONCILIATION_CLOSED',
              sweep_pass_count: 1,
            },
          },
        }),
      },
    });
    await prisma.mediaUploadSession.create({
      data: {
        mediaAssetId: asset.id,
        schoolId,
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        chunkSizeBytes: 1_048_576,
        status: MediaUploadStatus.COMPLETED,
        expiresAt: new Date(Date.now() - DAY_MS),
      },
    });
    for (const key of Object.values(k)) fakeR2.objects.add(key);
    if (opts?.withStaging) {
      const dir = storage.getVideoStagingDir(uuid);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'source.mp4'), 'x');
    }
    return { asset, keys: k };
  }

  async function deleteJobFor(assetId: number) {
    return prisma.mediaProcessingJob.findFirst({
      where: { mediaAssetId: assetId, jobType: DELETE_OBJECTS_JOB },
    });
  }

  async function makeJobReady(jobId: number) {
    await prisma.mediaProcessingJob.update({
      where: { id: jobId },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });
  }

  beforeAll(async () => {
    tempDbName = `asas_video_p46_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);
    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    const url = `postgresql://${dbUser}@localhost:5432/${tempDbName}`;

    await execFileAsync('createdb', [
      '-h',
      'localhost',
      '-p',
      '5432',
      tempDbName,
    ]);
    dbCreated = true;
    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: url },
    });

    prisma = new PrismaService({ datasourceUrl: url } as any);
    prismaPeer = new PrismaService({ datasourceUrl: url } as any);
    await prisma.$connect();
    await prismaPeer.$connect();
    const rows: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) throw new Error('ISOLATION FAILURE');

    tmpStorageDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'p46-storage-'));
    prevStoragePath = process.env.MEDIA_STORAGE_PATH;
    process.env.MEDIA_STORAGE_PATH = tmpStorageDir;

    storage = new StorageService();
    fakeR2 = new FakeR2Provider();
    registry = {
      get: (name: string) => {
        if (name === 'R2') return fakeR2;
        throw new Error(`unexpected provider ${name}`);
      },
    } as unknown as ObjectStorageRegistry;
    config = new VideoMediaConfig();
    lifecycle = new MediaLifecycleService(new MediaAccessPolicyService(prisma));
    lifecyclePeer = new MediaLifecycleService(
      new MediaAccessPolicyService(prismaPeer),
    );
    queue = new MediaJobQueueService(prisma, config);
    deleteProcessor = new DeleteObjectsProcessor(
      prisma,
      config,
      storage,
      registry,
      queue,
      lifecycle,
    );
    worker = new MediaWorkerService(
      config,
      queue,
      {} as any,
      {} as any,
      registry,
      deleteProcessor,
    );
    cleanup = new MediaCleanupService(prisma, storage, lifecycle, config);
    cleanupPeer = new MediaCleanupService(
      prismaPeer,
      storage,
      lifecyclePeer,
      config,
    );

    const school = await prisma.school.create({
      data: { name: 'مدرسة P4-6', schoolCode: 99611, appType: AppType.PUBLIC },
    });
    schoolId = school.id;
    schoolUuid = school.uuid;
    const tplA = await prisma.lessonTemplate.create({
      data: { ownerType: 'SCHOOL', schoolId, title: 'درس أ', orderIndex: 1 },
    });
    const tplB = await prisma.lessonTemplate.create({
      data: { ownerType: 'SCHOOL', schoolId, title: 'درس ب', orderIndex: 2 },
    });
    templateAId = tplA.id;
    blockAId = (
      await prisma.lessonContentBlock.create({
        data: { templateId: tplA.id, title: 'فقرة أ', orderIndex: 1 },
      })
    ).id;
    blockBId = (
      await prisma.lessonContentBlock.create({
        data: { templateId: tplB.id, title: 'فقرة ب', orderIndex: 1 },
      })
    ).id;
  });

  afterEach(async () => {
    fakeR2.reset();
    // عزل الاختبارات: لا تُترك مهام قابلة للسحب لاختبار لاحق
    await prisma.mediaProcessingJob.updateMany({
      where: { status: { in: ['PENDING', 'RETRYING', 'PROCESSING'] } },
      data: { status: 'CANCELED', lockedBy: null, leaseUntil: null },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await prismaPeer?.$disconnect().catch(() => undefined);
    if (prevStoragePath === undefined) delete process.env.MEDIA_STORAGE_PATH;
    else process.env.MEDIA_STORAGE_PATH = prevStoragePath;
    if (tmpStorageDir) {
      await fsp.rm(tmpStorageDir, { recursive: true, force: true });
    }
    if (dbCreated && tempDbName) {
      assertSafeTestDb(tempDbName);
      await execFileAsync('dropdb', [
        '-h',
        'localhost',
        '-p',
        '5432',
        '--if-exists',
        tempDbName,
      ]).catch(() => undefined);
    }
  });

  it('D-T1: التسلسل السباعي الكامل — جدولة مثالية (مهمة واحدة) ← حذف كل المفاتيح المعروفة (بما فيها الجيل اليتيم) ← 404 ← حذف الجلسات والمهام وصف الأصل', async () => {
    const { asset, keys } = await createVideoAsset({
      softDeletedDaysAgo: 31,
      withStaging: true,
    });

    expect(await cleanup.scheduleDeleteObjectsJobs()).toBe(1);
    expect(await cleanup.scheduleDeleteObjectsJobs()).toBe(0); // idempotent
    expect(
      await prisma.mediaProcessingJob.count({
        where: { mediaAssetId: asset.id, jobType: DELETE_OBJECTS_JOB },
      }),
    ).toBe(1);
    // W-059: صف الأصل ما زال موجوداً بعد الجدولة
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);

    const purgeLogSpy = jest.spyOn((deleteProcessor as any).logger, 'log');
    const res = await worker.processNextJobOnce('worker-dt1');
    expect(res).toMatchObject({ claimed: true, jobType: DELETE_OBJECTS_JOB });

    const purgeLogRaw = purgeLogSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('MEDIA_ASSET_PURGED'));
    expect(purgeLogRaw).toBeDefined();
    const purgeLog = JSON.parse(purgeLogRaw!);
    expect(purgeLog).toMatchObject({
      event: 'MEDIA_ASSET_PURGED',
      assetUuid: asset.uuid,
      kind: 'VIDEO',
      ownerType: 'SCHOOL',
      schoolId,
      storageProvider: 'R2',
      keysVerifiedDeleted: 5,
    });
    expect(typeof purgeLog.deletedAt).toBe('string');
    expect(purgeLog.jobsSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobType: 'TRANSCODE_VIDEO',
          status: 'COMPLETED',
        }),
        expect.objectContaining({
          jobType: 'DELETE_OBJECTS',
          status: 'COMPLETED',
          attemptCount: 1,
        }),
      ]),
    );
    purgeLogSpy.mockRestore();

    for (const key of Object.values(keys)) {
      expect(fakeR2.objects.has(key)).toBe(false);
    }
    expect(fakeR2.deleteCalls).toEqual(
      expect.arrayContaining(Object.values(keys)),
    );
    expect(fs.existsSync(storage.getVideoStagingDir(asset.uuid))).toBe(false);
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(0);
    expect(
      await prisma.mediaProcessingJob.count({
        where: { mediaAssetId: asset.id },
      }),
    ).toBe(0);
    expect(
      await prisma.mediaUploadSession.count({
        where: { mediaAssetId: asset.id },
      }),
    ).toBe(0);
  });

  it('D-T1b: لا جدولة قبل انتهاء مهلة الأمان (30 يوماً)', async () => {
    const { asset } = await createVideoAsset({ softDeletedDaysAgo: 5 });
    await cleanup.scheduleDeleteObjectsJobs();
    expect(await deleteJobFor(asset.id)).toBeNull();
  });

  it.each([
    [
      'D-T2 (403 Forbidden)',
      { kind: 'FORBIDDEN' } as HeadOutcome,
      'R2_DELETE_FORBIDDEN',
    ],
    [
      'D-T3a (503)',
      {
        kind: 'ERROR',
        code: 'ServiceUnavailable',
        retryable: true,
        httpStatus: 503,
      } as HeadOutcome,
      'R2_DELETE_TRANSIENT_ERROR',
    ],
    [
      'D-T3b (Timeout)',
      { kind: 'ERROR', code: 'ETIMEDOUT', retryable: true } as HeadOutcome,
      'R2_DELETE_TRANSIENT_ERROR',
    ],
  ])(
    '%s من HeadObject يبقي صف MediaAsset ويعيد جدولة المهمة RETRYING',
    async (_label, outcome, reasonCode) => {
      const { asset, keys } = await createVideoAsset({
        softDeletedDaysAgo: 40,
      });
      await cleanup.scheduleDeleteObjectsJobs();
      fakeR2.headOverride.set(keys.v480, outcome);

      await worker.processNextJobOnce('worker-dt2');

      const job = await deleteJobFor(asset.id);
      expect(job?.status).toBe('RETRYING');
      expect(job?.attemptCount).toBe(1);
      expect(job?.lastError).toContain(reasonCode);
      expect(job!.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(
        1,
      );
    },
  );

  it('D-T3c: بعد زوال العطل المؤقت تنجح إعادة المحاولة وتُكمل الحذف (Idempotent)', async () => {
    const { asset, keys } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    fakeR2.headOverride.set(keys.thumb, {
      kind: 'ERROR',
      code: 'InternalError',
      retryable: true,
      httpStatus: 500,
    });
    await worker.processNextJobOnce('worker-dt3c');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);

    fakeR2.headOverride.clear();
    const job = await deleteJobFor(asset.id);
    await makeJobReady(job!.id);
    await worker.processNextJobOnce('worker-dt3c');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(0);
  });

  it('D-T4: حذف صامت فاشل (الكائن ما زال موجوداً 200) أو خطأ من DeleteObject ← لا حذف لصف DB', async () => {
    const { asset, keys } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    fakeR2.deleteNoop.add(keys.source);
    fakeR2.deleteThrow.set(keys.thumb, new Error('ECONNRESET'));
    // thumb يبقى موجوداً لأن الحذف رمى خطأً
    await worker.processNextJobOnce('worker-dt4');

    const job = await deleteJobFor(asset.id);
    expect(job?.status).toBe('RETRYING');
    expect(job?.lastError).toContain('R2_DELETE_NOT_VERIFIED_STILL_EXISTS');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
  });

  it('D-T4b: بلوغ الحد الأقصى للمحاولات ← FAILED مع بقاء صف الأصل (لا حذف غير مؤكد أبداً)', async () => {
    const { asset, keys } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    const job = await deleteJobFor(asset.id);
    await prisma.mediaProcessingJob.update({
      where: { id: job!.id },
      data: { maxAttempts: 1 },
    });
    fakeR2.headOverride.set(keys.v360, { kind: 'FORBIDDEN' });
    await worker.processNextJobOnce('worker-dt4b');
    const after = await deleteJobFor(asset.id);
    expect(after?.status).toBe('FAILED');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
    // لا تُعاد جدولة مهمة FAILED تلقائياً (تحتاج تدخل المشغّل)
    expect(await cleanup.scheduleDeleteObjectsJobs()).toBe(0);
  });

  it('SHARED: فيديو مشترك بين درسين — حذف مرجع واحد لا يحذف الأصل ولا يجدول DELETE_OBJECTS', async () => {
    const { asset, keys } = await createVideoAsset();
    const itemA = await prisma.lessonBlockItem.create({
      data: {
        blockId: blockAId,
        itemType: 'VIDEO',
        orderIndex: 1,
        mediaAssetId: asset.id,
      },
    });
    await prisma.lessonBlockItem.create({
      data: {
        blockId: blockBId,
        itemType: 'VIDEO',
        orderIndex: 1,
        mediaAssetId: asset.id,
      },
    });

    const res = await prisma.$transaction(async (tx) => {
      await tx.lessonBlockItem.update({
        where: { id: itemA.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      return lifecycle.reconcileUnlinkedAssetsUnderLock(tx, [asset.id]);
    });
    expect(res.softDeletedAssetIds).toEqual([]);
    expect(res.remainingCounts[asset.id]).toBe(1);

    // حتى لو وُسم الأصل يدوياً بالحذف (حالة شاذة)، الجدولة ترفض وجود مرجع نشط
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { isDeleted: true, deletedAt: new Date(Date.now() - 40 * DAY_MS) },
    });
    expect(await cleanup.scheduleDeleteObjectsJobs()).toBe(0);
    expect(await deleteJobFor(asset.id)).toBeNull();
    expect(fakeR2.objects.has(keys.v480)).toBe(true);
  });

  it('RELINK-1: محاولة ربط أصل محذوف ناعماً ينتظر DELETE_OBJECTS تُرفض بـ 404 تحت القفل', async () => {
    const { asset } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();

    await expect(
      prisma.$transaction((tx) =>
        lifecycle.resolveAndLockAssetForLink(tx, {
          assetUuid: asset.uuid,
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('RELINK-2: ظهور مرجع نشط قبل تنفيذ المهمة ← CANCELED دون لمس أي كائن ودون حذف الصف', async () => {
    const { asset, keys } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    await prisma.lessonBlockItem.create({
      data: {
        blockId: blockAId,
        itemType: 'VIDEO',
        orderIndex: 9,
        mediaAssetId: asset.id,
      },
    });

    await worker.processNextJobOnce('worker-relink2');

    const job = await deleteJobFor(asset.id);
    expect(job?.status).toBe('CANCELED');
    expect(job?.lastError).toContain('DELETE_ABORTED_ACTIVE_REFERENCES');
    expect(fakeR2.deleteCalls).toEqual([]);
    for (const key of Object.values(keys))
      expect(fakeR2.objects.has(key)).toBe(true);
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
  });

  it('RACE-DEL: ربط متزامن يمسك القفل أثناء تنظيف الأصل غير المرتبط ← التنظيف ينتظر ثم يرى المرجع فلا يحذف', async () => {
    const { asset } = await createVideoAsset();
    await prisma.$executeRaw`UPDATE media_assets SET created_at = timezone('UTC', now()) - interval '3 days', updated_at = timezone('UTC', now()) - interval '3 days' WHERE id = ${asset.id}`;

    const lockHeld = createDeferred();
    const releaseLink = createDeferred();
    const linkTx = prismaPeer.$transaction(
      async (tx) => {
        await lifecyclePeer.resolveAndLockAssetForLink(tx, {
          assetUuid: asset.uuid,
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId,
        });
        lockHeld.resolve();
        await releaseLink.promise;
        await tx.lessonBlockItem.create({
          data: {
            blockId: blockAId,
            itemType: 'VIDEO',
            orderIndex: 20,
            mediaAssetId: asset.id,
          },
        });
      },
      { timeout: 30_000 },
    );

    await lockHeld.promise;
    const cleanupPromise = cleanup.cleanupUnlinkedAssets();
    await new Promise((r) => setTimeout(r, 300));
    releaseLink.resolve();
    await linkTx;
    await cleanupPromise;

    const fresh = await prisma.mediaAsset.findUnique({
      where: { id: asset.id },
    });
    expect(fresh?.isDeleted).toBe(false);
  });

  it('CRASH-1: انهيار العامل بعد سحب المهمة ← استعادة القفل المنتهي دون زيادة المحاولات ← عامل آخر يُكمل الحذف', async () => {
    const { asset } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    const claimed = await queue.claimNextJob('worker-crashed', 30);
    expect(claimed?.job_type).toBe(DELETE_OBJECTS_JOB);

    // "SIGKILL": لا معالجة. ننهي القفل.
    await prisma.$executeRaw`UPDATE media_processing_jobs SET lease_until = now() - interval '1 second' WHERE id = ${claimed!.id}`;
    const rec = await queue.recoverStaleLeases();
    expect(rec.recoveredToRetrying).toBe(1);
    const recovered = await deleteJobFor(asset.id);
    expect(recovered?.status).toBe('RETRYING');
    expect(recovered?.attemptCount).toBe(0);

    await makeJobReady(recovered!.id);
    await worker.processNextJobOnce('worker-survivor');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(0);
  });

  it('CRASH-2: انهيار بعد حذف الكائنات (الخطوة 5) وقبل حذف الصف ← الاستئناف idempotent (404 = تم) ويحذف الصف', async () => {
    const { asset, keys } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    const claimed = await queue.claimNextJob('worker-crashed-2', 30);
    // محاكاة: الكائنات حُذفت فعلاً ثم انهار العامل
    for (const key of Object.values(keys)) fakeR2.objects.delete(key);
    await prisma.$executeRaw`UPDATE media_processing_jobs SET lease_until = now() - interval '1 second' WHERE id = ${claimed!.id}`;
    await queue.recoverStaleLeases();
    await makeJobReady(claimed!.id);

    await worker.processNextJobOnce('worker-survivor-2');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(0);
  });

  it('FENCE: عامل قديم فقد قفله لا يكتب شيئاً (LeaseLostError) والعامل الجديد يُكمل', async () => {
    const { asset, keys } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    await cleanup.scheduleDeleteObjectsJobs();
    const jobA = await queue.claimNextJob('worker-A', 30);
    const ctxA: JobLockContext = {
      jobId: jobA!.id,
      workerId: 'worker-A',
      fencingToken: BigInt(jobA!.fencing_token),
    };
    await prisma.$executeRaw`UPDATE media_processing_jobs SET lease_until = now() - interval '1 second' WHERE id = ${jobA!.id}`;
    await queue.recoverStaleLeases();
    await makeJobReady(jobA!.id);
    const jobB = await queue.claimNextJob('worker-B', 30);
    expect(BigInt(jobB!.fencing_token)).toBeGreaterThan(ctxA.fencingToken);

    await deleteProcessor.processClaimedJob(jobA!, ctxA);
    expect(fakeR2.deleteCalls).toEqual([]);
    for (const key of Object.values(keys))
      expect(fakeR2.objects.has(key)).toBe(true);
    const owned = await deleteJobFor(asset.id);
    expect(owned?.lockedBy).toBe('worker-B');

    await deleteProcessor.processClaimedJob(jobB!, {
      jobId: jobB!.id,
      workerId: 'worker-B',
      fencingToken: BigInt(jobB!.fencing_token),
    });
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(0);
  });

  it('OTHER-JOB: مهمة معالجة غير منتهية تمنع الجدولة، وتؤجل DELETE_OBJECTS دون زيادة المحاولات', async () => {
    const { asset } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    const moveJob = await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'MOVE_SOURCE',
        status: 'PROCESSING',
        idempotencyKey: `MOVE_SOURCE:${asset.uuid}:t`,
        lockedBy: 'other-worker',
        leaseUntil: new Date(Date.now() + 600_000),
      },
    });
    expect(await cleanup.scheduleDeleteObjectsJobs()).toBe(0);

    // إن وُجدت مهمة الحذف مسبقاً (سباق)، تتأجل دون استهلاك محاولة
    await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: DELETE_OBJECTS_JOB,
        status: 'PENDING',
        idempotencyKey: `${DELETE_OBJECTS_JOB}:${asset.uuid}`,
      },
    });
    await worker.processNextJobOnce('worker-other');
    const job = await deleteJobFor(asset.id);
    expect(job?.status).toBe('RETRYING');
    expect(job?.attemptCount).toBe(0);
    expect(job?.lastError).toContain('DELETE_DEFERRED_OTHER_ACTIVE_JOBS');
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);
    await prisma.mediaProcessingJob.update({
      where: { id: moveJob.id },
      data: { status: 'COMPLETED', lockedBy: null, leaseUntil: null },
    });
  });

  it('D-T5: cleanupUnlinkedAssets يوسم فقط الفيديو المنتهي غير المرتبط، ويحمي (حديث / مهمة نشطة / جلسة نشطة / مرتبط)', async () => {
    const age = async (id: number, hours: number) =>
      prisma.$executeRaw`UPDATE media_assets SET created_at = timezone('UTC', now()) - (${String(hours)} || ' hours')::interval, updated_at = timezone('UTC', now()) - (${String(hours)} || ' hours')::interval WHERE id = ${id}`;

    const expired = (await createVideoAsset()).asset;
    await age(expired.id, 30);

    const fresh = (await createVideoAsset()).asset;
    await age(fresh.id, 2);

    const withJob = (await createVideoAsset()).asset;
    await age(withJob.id, 30);
    await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: withJob.id,
        jobType: 'MOVE_SOURCE',
        status: 'PENDING',
        idempotencyKey: `MOVE_SOURCE:${withJob.uuid}:d5`,
        nextRetryAt: new Date(Date.now() + 3_600_000),
      },
    });

    const withSession = (await createVideoAsset()).asset;
    await age(withSession.id, 30);
    await prisma.mediaUploadSession.create({
      data: {
        mediaAssetId: withSession.id,
        schoolId,
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        chunkSizeBytes: 1_048_576,
        status: MediaUploadStatus.UPLOADING,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const linked = (await createVideoAsset()).asset;
    await age(linked.id, 30);
    await prisma.lessonBlockItem.create({
      data: {
        blockId: blockAId,
        itemType: 'VIDEO',
        orderIndex: 30,
        mediaAssetId: linked.id,
      },
    });

    const linkedAsCover = (await createVideoAsset()).asset;
    await age(linkedAsCover.id, 30);
    await prisma.lessonTemplate.update({
      where: { id: templateAId },
      data: { coverMediaAssetId: linkedAsCover.id },
    });

    const logSpy = jest.spyOn((cleanup as any).logger, 'log');
    // نطاق المعالجة يشمل أصولاً من اختبارات سابقة؛ نتحقق من كل أصل بعينه
    await cleanup.cleanupUnlinkedAssets();

    const state = async (id: number) =>
      (await prisma.mediaAsset.findUnique({ where: { id } }))?.isDeleted;
    expect(await state(expired.id)).toBe(true);
    expect(await state(fresh.id)).toBe(false);
    expect(await state(withJob.id)).toBe(false);
    expect(await state(withSession.id)).toBe(false);
    expect(await state(linked.id)).toBe(false);
    expect(await state(linkedAsCover.id)).toBe(false);

    const audit = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes(expired.uuid));
    expect(audit).toBeDefined();
    const parsed = JSON.parse(audit!);
    expect(parsed).toMatchObject({
      event: 'MEDIA_ASSET_AUTO_CLEANUP',
      reason: 'UNLINKED_ASSET_TTL_EXPIRED',
      assetUuid: expired.uuid,
      kind: 'VIDEO',
      storageProvider: 'R2',
      ownerType: 'SCHOOL',
      schoolId,
    });
    expect(parsed.ageHours).toBeGreaterThanOrEqual(29);
    logSpy.mockRestore();

    await prisma.lessonTemplate.update({
      where: { id: templateAId },
      data: { coverMediaAssetId: null },
    });
  });

  it('W-028: حذف ملفات أصل LOCAL مملوك للمنصة (platform/{uuid}) وصفه بعد المهلة، وحماية صورة مدرسة ما زالت مرجعاً كشعار مدرسة (عدّ محافظ للحقول غير الدرسية)', async () => {
    const platformImg = await prisma.mediaAsset.create({
      data: {
        ownerType: 'PLATFORM',
        kind: MediaKind.IMAGE,
        storageProvider: 'LOCAL',
        contentType: 'image/webp',
        processingStatus: ProcessingStatus.DONE,
        isDeleted: true,
        deletedAt: new Date(Date.now() - 40 * DAY_MS),
      },
    });
    const pDir = storage.getAssetDir('platform', platformImg.uuid);
    await fsp.mkdir(pDir, { recursive: true });
    await fsp.writeFile(path.join(pDir, 'original.webp'), 'img');

    const schoolImg = await prisma.mediaAsset.create({
      data: {
        schoolId,
        ownerType: 'SCHOOL',
        kind: MediaKind.IMAGE,
        storageProvider: 'LOCAL',
        contentType: 'image/webp',
        processingStatus: ProcessingStatus.DONE,
        isDeleted: true,
        deletedAt: new Date(Date.now() - 40 * DAY_MS),
      },
    });
    const sDir = storage.getAssetDir(schoolUuid, schoolImg.uuid);
    await fsp.mkdir(sDir, { recursive: true });
    await fsp.writeFile(path.join(sDir, 'original.webp'), 'img');
    const refCount = await prisma.$transaction((tx) =>
      lifecycle.countAllActiveReferences(tx, schoolImg.id),
    );
    expect(refCount).toBe(0);
    // نُنشئ مرجعاً حقيقياً عبر شعار المدرسة (أحد الحقول الـ 18 غير الدرسية)
    await prisma.school.update({
      where: { id: schoolId },
      data: { logoMediaAssetId: schoolImg.id },
    });

    await cleanup.cleanupDeletedAssets();

    expect(
      await prisma.mediaAsset.count({ where: { id: platformImg.id } }),
    ).toBe(0);
    expect(fs.existsSync(pDir)).toBe(false);
    expect(await prisma.mediaAsset.count({ where: { id: schoolImg.id } })).toBe(
      1,
    );
    expect(fs.existsSync(sDir)).toBe(true);

    await prisma.school.update({
      where: { id: schoolId },
      data: { logoMediaAssetId: null },
    });
  });

  it('LOCAL-PATH: أصول الفيديو لا تُحذف أبداً عبر المسار المحلي حتى لو كانت storageProvider = LOCAL', async () => {
    const localVideo = await prisma.mediaAsset.create({
      data: {
        schoolId,
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'LOCAL',
        contentType: 'video/mp4',
        isDeleted: true,
        deletedAt: new Date(Date.now() - 40 * DAY_MS),
      },
    });
    await cleanup.cleanupDeletedAssets();
    expect(
      await prisma.mediaAsset.count({ where: { id: localVideo.id } }),
    ).toBe(1);
    // ويُوجَّه بدلاً من ذلك إلى DELETE_OBJECTS
    await cleanup.scheduleDeleteObjectsJobs();
    expect((await deleteJobFor(localVideo.id))?.status).toBe('PENDING');
  });

  it('CONCURRENT-SCHEDULE: جدولة متزامنة من نسختين API تنشئ مهمة DELETE_OBJECTS واحدة فقط', async () => {
    const { asset } = await createVideoAsset({ softDeletedDaysAgo: 40 });
    const [a, b] = await Promise.all([
      cleanup.scheduleDeleteObjectsJobs(),
      cleanupPeer.scheduleDeleteObjectsJobs(),
    ]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.mediaProcessingJob.count({
        where: { mediaAssetId: asset.id, jobType: DELETE_OBJECTS_JOB },
      }),
    ).toBe(1);
  });

  it('WORKER-DISABLED-WARN (chat306): تسجيل تحذير مهيكل عند وجود مهام DELETE_OBJECTS معلقة بينما VIDEO_UPLOAD_ENABLED=false', async () => {
    await createVideoAsset({ softDeletedDaysAgo: 40 });
    expect(config.isUploadEnabled).toBe(false);

    const warnSpy = jest.spyOn((cleanup as any).logger, 'warn');
    await cleanup.scheduleDeleteObjectsJobs();

    const warnRaw = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) =>
        m.includes('MEDIA_DELETE_JOBS_QUEUED_WHILE_WORKER_DISABLED'),
      );
    expect(warnRaw).toBeDefined();
    const parsed = JSON.parse(warnRaw!);
    expect(parsed).toMatchObject({
      event: 'MEDIA_DELETE_JOBS_QUEUED_WHILE_WORKER_DISABLED',
      videoUploadEnabled: false,
    });
    expect(parsed.pendingDeleteJobs).toBeGreaterThanOrEqual(1);
    warnSpy.mockRestore();
  });
});
