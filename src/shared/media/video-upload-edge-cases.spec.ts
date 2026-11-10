/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/unbound-method */
// src/shared/media/video-upload-edge-cases.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 VIDEO P4-3 — اختبارات حافة الرفع وتنظيف الملفات المؤقتة (U-T1..U-T4 — §10.2)
// ═══════════════════════════════════════════════════════════════
// يغطي:
//   - U-T1 (Duplicate Complete): استدعاء complete مرتين متتاليتين ومتزامنتين (Promise.all)
//     ← يعيد نفس رد 202 وينشئ مهمة TRANSCODE_VIDEO واحدة فقط دون إتلاف ملف video-staging.
//   - U-T2 (Chunk Resend & Interrupted Upload): رفع 3 أجزاء ← قطع الرفع ← probeSession يعيد الموضع الدقيق
//     ← إعادة إرسال الجزء الثالث تعيد 409 OUT_OF_ORDER مع next_expected_byte دون مضاعفة حجم الملف
//     ← استكمال الجزء الرابع ونجاح تطابق SHA-256.
//   - U-T3 (Disk Exhaustion): جلسات متزامنة تملأ الحجز حتى حد الـ 5GB ← الجلسة الإضافية تُرفض بـ 507
//     بصفر صفوف أو ملفات يتيمة.
//   - U-T4 (Session Expiry & Temp Cleanup — W-064): انتهاء صلاحية جلسة غير مكتملة ← cleanupExpiredSessions()
//     تحذف tmp/{sessionUuid}.part وتلغي الجلسة، بينما لا تمس tmp/video-staging/{assetUuid}/source.mp4
//     الخاص بجلسة مكتملة تنتظر العامل.
// ═══════════════════════════════════════════════════════════════

import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { MediaKind, MediaUploadStatus, ProcessingStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaCleanupService } from '../../school/media/media-cleanup.service';
import { MediaUploadService } from '../../school/media/media-upload.service';
import { DiskSpaceGuardService } from './disk-space-guard.service';
import { FfprobeService, VideoInfo } from './ffprobe.service';
import { MediaAccessPolicyService } from './media-access-policy.service';
import { StorageService } from './storage.service';
import { UploadValidationHelper } from './upload-validation.helper';
import { VideoMediaConfig } from './video-media.config';
import { VideoUploadService } from './video-upload.service';

interface FakeAsset {
  id: number;
  uuid: string;
  schoolId: number | null;
  ownerType: string;
  kind: MediaKind;
  contentType: string;
  sizeBytes: bigint;
  storageKey: string | null;
  storageProvider: string;
  processingStatus: ProcessingStatus;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  rowVersion: number;
  isDeleted: boolean;
  deletedAt: Date | null;
}

interface FakeSession {
  id: number;
  uuid: string;
  mediaAssetId: number;
  schoolId: number | null;
  ownerType: string;
  uploaderUserId: number | null;
  platformUserId: number | null;
  kind: MediaKind;
  contentType: string;
  totalSizeBytes: bigint | null;
  chunkSizeBytes: number;
  status: MediaUploadStatus;
  bytesReceived: bigint;
  tempStorageKey: string | null;
  processingStatus: ProcessingStatus | null;
  expiresAt: Date;
  completedAt: Date | null;
  canceledAt: Date | null;
  lastError: string | null;
}

interface FakeJob {
  id: number;
  mediaAssetId: number;
  jobType: string;
  status: string;
  idempotencyKey: string;
  payloadJson: string;
}

/**
 * محاكي قاعدة بيانات في الذاكرة يحاكي بدقة:
 * - قفل الصفوف التزامني (FOR UPDATE mutex) و pg_advisory_xact_lock
 * - القيد الفريد على idempotency_key في media_processing_jobs
 * - استعلامات حجز المساحة في DiskSpaceGuardService
 */
class InMemoryUploadDb {
  assets = new Map<number, FakeAsset>();
  sessions = new Map<number, FakeSession>();
  jobs = new Map<string, FakeJob>();
  private nextAssetId = 1;
  private nextSessionId = 1;
  private nextJobId = 1;
  private mutex: Promise<void> = Promise.resolve();

  /** يضمن تسلسل المعاملات التي تطلب FOR UPDATE أو pg_advisory_xact_lock تماماً كما يفعل PostgreSQL */
  async $transaction<T>(fnOrOps: any): Promise<T> {
    if (Array.isArray(fnOrOps)) {
      return Promise.all(fnOrOps) as any;
    }
    let release!: () => void;
    const prev = this.mutex;
    this.mutex = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fnOrOps(this);
    } finally {
      release();
    }
  }

  async $queryRaw(
    strings: TemplateStringsArray,
    ...values: any[]
  ): Promise<any[]> {
    const sql = strings.join('?');
    if (sql.includes('pg_advisory_xact_lock')) {
      return [{ locked: '' }];
    }
    if (
      sql.includes('SUM(GREATEST') &&
      sql.includes('FROM media_upload_sessions')
    ) {
      const now = new Date();
      let reserved = 0n;
      let videoCount = 0n;
      for (const s of this.sessions.values()) {
        if (
          (s.status === MediaUploadStatus.INITIATED ||
            s.status === MediaUploadStatus.UPLOADING) &&
          s.expiresAt > now
        ) {
          const total = s.totalSizeBytes ?? 0n;
          const rem = total > s.bytesReceived ? total - s.bytesReceived : 0n;
          reserved += rem;
          if (s.kind === MediaKind.VIDEO) videoCount += 1n;
        }
      }
      return [{ reserved, video_count: videoCount }];
    }
    if (sql.includes('FROM media_processing_jobs')) {
      let cnt = 0n;
      for (const j of this.jobs.values()) {
        if (
          j.jobType === 'TRANSCODE_VIDEO' &&
          ['PENDING', 'PROCESSING', 'RETRYING'].includes(j.status)
        ) {
          cnt += 1n;
        }
      }
      return [{ cnt }];
    }
    if (sql.includes('FROM media_upload_sessions')) {
      const sessionId = values[0] as number;
      const s = this.sessions.get(sessionId);
      if (!s) return [];
      return [
        {
          id: s.id,
          uuid: s.uuid,
          media_asset_id: s.mediaAssetId,
          owner_type: s.ownerType,
          kind: s.kind,
          status: s.status,
          total_size_bytes: s.totalSizeBytes,
          bytes_received: s.bytesReceived,
          chunk_size_bytes: s.chunkSizeBytes,
          content_type: s.contentType,
          expires_at: s.expiresAt,
        },
      ];
    }
    return [];
  }

  mediaAsset = {
    create: async ({ data }: any): Promise<FakeAsset> => {
      const id = this.nextAssetId++;
      const asset: FakeAsset = {
        id,
        uuid: data.uuid ?? `asset-uuid-${id}`,
        schoolId: data.schoolId ?? null,
        ownerType: data.ownerType ?? 'SCHOOL',
        kind: data.kind,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes ?? 0n,
        storageKey: data.storageKey ?? null,
        storageProvider: data.storageProvider ?? 'LOCAL',
        processingStatus: data.processingStatus ?? ProcessingStatus.PENDING,
        width: null,
        height: null,
        durationSec: null,
        rowVersion: 0,
        isDeleted: false,
        deletedAt: null,
      };
      this.assets.set(id, asset);
      return asset;
    },
    findUniqueOrThrow: async ({ where }: any): Promise<FakeAsset> => {
      const a = this.assets.get(where.id);
      if (!a) throw new Error('Asset not found');
      return a;
    },
    update: async ({ where, data }: any): Promise<FakeAsset> => {
      const a = this.assets.get(where.id)!;
      if (data.storageKey !== undefined) a.storageKey = data.storageKey;
      if (data.storageProvider !== undefined)
        a.storageProvider = data.storageProvider;
      if (data.processingStatus !== undefined)
        a.processingStatus = data.processingStatus;
      if (data.width !== undefined) a.width = data.width;
      if (data.height !== undefined) a.height = data.height;
      if (data.durationSec !== undefined) a.durationSec = data.durationSec;
      if (data.isDeleted !== undefined) a.isDeleted = data.isDeleted;
      if (data.deletedAt !== undefined) a.deletedAt = data.deletedAt;
      if (data.rowVersion?.increment) a.rowVersion += data.rowVersion.increment;
      return a;
    },
  };

  mediaUploadSession = {
    create: async ({ data }: any): Promise<FakeSession> => {
      const id = this.nextSessionId++;
      const s: FakeSession = {
        id,
        uuid: data.uuid ?? `sess-uuid-${id}`,
        mediaAssetId: data.mediaAssetId,
        schoolId: data.schoolId ?? null,
        ownerType: data.ownerType ?? 'SCHOOL',
        uploaderUserId: data.uploaderUserId ?? null,
        platformUserId: data.platformUserId ?? null,
        kind: data.kind,
        contentType: data.contentType,
        totalSizeBytes: data.totalSizeBytes ?? null,
        chunkSizeBytes: data.chunkSizeBytes,
        status: data.status ?? MediaUploadStatus.INITIATED,
        bytesReceived: 0n,
        tempStorageKey: data.tempStorageKey ?? null,
        processingStatus: null,
        expiresAt: data.expiresAt,
        completedAt: null,
        canceledAt: null,
        lastError: null,
      };
      this.sessions.set(id, s);
      return s;
    },
    findFirst: async ({ where }: any) => {
      for (const s of this.sessions.values()) {
        if (s.uuid === where.uuid && s.ownerType === where.ownerType) {
          if (where.schoolId !== undefined && s.schoolId !== where.schoolId)
            continue;
          const asset = this.assets.get(s.mediaAssetId)!;
          return { ...s, mediaAsset: { id: asset.id, uuid: asset.uuid } };
        }
      }
      return null;
    },
    findMany: async ({ where }: any) => {
      const now: Date = where.expiresAt.lt;
      const notIn: MediaUploadStatus[] = where.status.notIn;
      const result: any[] = [];
      for (const s of this.sessions.values()) {
        if (s.expiresAt < now && !notIn.includes(s.status)) {
          const asset = this.assets.get(s.mediaAssetId)!;
          result.push({
            ...s,
            mediaAsset: {
              id: asset.id,
              uuid: asset.uuid,
              isDeleted: asset.isDeleted,
            },
          });
        }
      }
      return result;
    },
    update: async ({ where, data }: any) => {
      const s = this.sessions.get(where.id)!;
      if (data.bytesReceived !== undefined)
        s.bytesReceived = data.bytesReceived;
      if (data.status !== undefined) s.status = data.status;
      if (data.completedAt !== undefined) s.completedAt = data.completedAt;
      if (data.canceledAt !== undefined) s.canceledAt = data.canceledAt;
      if (data.processingStatus !== undefined)
        s.processingStatus = data.processingStatus;
      return s;
    },
    updateMany: async ({ where, data }: any) => {
      const s = this.sessions.get(where.id);
      if (!s) return { count: 0 };
      if (
        where.bytesReceived !== undefined &&
        s.bytesReceived !== where.bytesReceived
      ) {
        return { count: 0 };
      }
      if (where.status?.in && !where.status.in.includes(s.status)) {
        return { count: 0 };
      }
      if (where.status?.not && s.status === where.status.not) {
        return { count: 0 };
      }
      if (where.status?.notIn && where.status.notIn.includes(s.status)) {
        return { count: 0 };
      }
      if (data.bytesReceived !== undefined)
        s.bytesReceived = data.bytesReceived;
      if (data.status !== undefined) s.status = data.status;
      if (data.canceledAt !== undefined) s.canceledAt = data.canceledAt;
      if (data.lastError !== undefined) s.lastError = data.lastError;
      return { count: 1 };
    },
  };

  mediaProcessingJob = {
    upsert: async ({ where, create }: any) => {
      const existing = this.jobs.get(where.idempotencyKey);
      if (existing) return existing;
      const job: FakeJob = {
        id: this.nextJobId++,
        mediaAssetId: create.mediaAssetId,
        jobType: create.jobType,
        status: create.status,
        idempotencyKey: create.idempotencyKey,
        payloadJson: create.payloadJson,
      };
      this.jobs.set(where.idempotencyKey, job);
      return job;
    },
  };
}

describe('VIDEO P4-3 — حالات حافة الرفع وتنظيف الملفات المؤقتة (U-T1..U-T4)', () => {
  let tmpDir: string;
  let db: InMemoryUploadDb;
  let storage: StorageService;
  let diskGuard: DiskSpaceGuardService;
  let ffprobe: FfprobeService;
  let uploadService: MediaUploadService;
  let cleanupService: MediaCleanupService;

  const sampleVideoInfo: VideoInfo = {
    width: 1280,
    height: 720,
    durationSec: 95.2,
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps: 30,
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    isSilent: false,
    rotation: 0,
  };

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'video-upload-edge-'),
    );
    const prevStorage = process.env.MEDIA_STORAGE_PATH;
    const prevEnabled = process.env.VIDEO_UPLOAD_ENABLED;
    const prevAcc = process.env.R2_ACCOUNT_ID;
    const prevKey = process.env.R2_ACCESS_KEY_ID;
    const prevSec = process.env.R2_SECRET_ACCESS_KEY;
    const prevBucket = process.env.R2_BUCKET_NAME;

    process.env.MEDIA_STORAGE_PATH = tmpDir;
    process.env.VIDEO_UPLOAD_ENABLED = 'true';
    process.env.R2_ACCOUNT_ID = 'acc';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'sec';
    process.env.R2_BUCKET_NAME = 'bucket';

    try {
      db = new InMemoryUploadDb();
      storage = new StorageService();
      const videoConfig = new VideoMediaConfig();
      const validation = new UploadValidationHelper(videoConfig);
      diskGuard = new DiskSpaceGuardService(db as any);
      jest
        .spyOn(diskGuard as any, 'measureFreeBytes')
        .mockResolvedValue(BigInt(10_000_000_000)); // 10 GB متاح افتراضياً

      ffprobe = new FfprobeService(videoConfig);
      jest.spyOn(ffprobe, 'probe').mockResolvedValue({
        valid: true,
        errors: [],
        info: sampleVideoInfo,
      });

      const accessPolicy = new MediaAccessPolicyService(db as any);
      jest
        .spyOn(accessPolicy, 'assertSchoolUploadAllowed')
        .mockResolvedValue(undefined);

      const videoUpload = new VideoUploadService(
        db as any,
        storage,
        videoConfig,
        diskGuard,
        ffprobe,
        validation,
      );
      uploadService = new MediaUploadService(
        db as any,
        storage,
        {} as any,
        videoUpload,
        validation,
        accessPolicy,
      );
      cleanupService = new MediaCleanupService(db as any, storage);
    } finally {
      if (prevStorage === undefined) delete process.env.MEDIA_STORAGE_PATH;
      else process.env.MEDIA_STORAGE_PATH = prevStorage;
      if (prevEnabled === undefined) delete process.env.VIDEO_UPLOAD_ENABLED;
      else process.env.VIDEO_UPLOAD_ENABLED = prevEnabled;
      if (prevAcc === undefined) delete process.env.R2_ACCOUNT_ID;
      else process.env.R2_ACCOUNT_ID = prevAcc;
      if (prevKey === undefined) delete process.env.R2_ACCESS_KEY_ID;
      else process.env.R2_ACCESS_KEY_ID = prevKey;
      if (prevSec === undefined) delete process.env.R2_SECRET_ACCESS_KEY;
      else process.env.R2_SECRET_ACCESS_KEY = prevSec;
      if (prevBucket === undefined) delete process.env.R2_BUCKET_NAME;
      else process.env.R2_BUCKET_NAME = prevBucket;
    }
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  // ── U-T1: Duplicate Complete (متزامن ومتتالي) ──

  it('U-T1 (Duplicate Complete): استدعاء complete مرتين متزامنتين (Promise.all) يعيد نفس رد 202 وينشئ مهمة واحدة فقط دون إتلاف ملف video-staging', async () => {
    const payload = randomBytes(120_000);
    const expectedSha = createHash('sha256').update(payload).digest('hex');

    const init = await uploadService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: payload.length,
      },
      1,
      'school-1',
      { userId: 50, role: 'TEACHER' },
    );

    await uploadService.uploadChunk(
      init.upload_session_uuid,
      1,
      `bytes 0-${payload.length - 1}/${payload.length}`,
      payload,
      50,
    );

    // إرسال طلبين متزامنين لـ complete
    const [res1, res2] = await Promise.all([
      uploadService.completeSession(
        init.upload_session_uuid,
        1,
        'school-1',
        50,
      ),
      uploadService.completeSession(
        init.upload_session_uuid,
        1,
        'school-1',
        50,
      ),
    ]);

    expect(res1.media_asset_uuid).toBe(init.media_asset_uuid);
    expect(res2.media_asset_uuid).toBe(init.media_asset_uuid);
    expect(res1.processing_status).toBe('PROCESSING');
    expect(res2.processing_status).toBe('PROCESSING');

    // استدعاء واحد أنشأ المهمة والآخر رآها مكتملة
    expect([res1, res2].map((r: any) => r.already_completed).sort()).toEqual([
      false,
      true,
    ]);

    // ffprobe شُغّل مرة واحدة فقط، ومهمة واحدة فقط أُنشئت
    expect(ffprobe.probe).toHaveBeenCalledTimes(1);
    expect(db.jobs.size).toBe(1);

    // ملف المصدر في video-staging سليم بـ SHA-256 مطابق، وملف .part لم يعد موجوداً
    const stagingPath = storage.getVideoStagingPath(
      init.media_asset_uuid,
      'mp4',
    );
    const stagedBytes = await fs.promises.readFile(stagingPath);
    expect(createHash('sha256').update(stagedBytes).digest('hex')).toBe(
      expectedSha,
    );
    expect(fs.existsSync(storage.getTempPath(init.upload_session_uuid))).toBe(
      false,
    );
  });

  // ── U-T2: Chunk Resend & Interrupted Upload ──

  it('U-T2 (Chunk Resend & Interrupted Upload): رفع 3 أجزاء ← انقطاع ← probe ← إعادة الجزء 3 تعيد 409 OUT_OF_ORDER دون مضاعفة الحجم ← الجزء 4 يكمل الملف ببصمة SHA-256 مطابقة', async () => {
    const chunkSize = 65_536; // 64 KiB
    const c1 = randomBytes(chunkSize);
    const c2 = randomBytes(chunkSize);
    const c3 = randomBytes(chunkSize);
    const c4 = randomBytes(20_000);
    const fullBuffer = Buffer.concat([c1, c2, c3, c4]);
    const expectedSha = createHash('sha256').update(fullBuffer).digest('hex');

    const init = await uploadService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: fullBuffer.length,
        chunkSizeBytes: chunkSize,
      },
      1,
      'school-1',
      { userId: 50, role: 'TEACHER' },
    );
    const sid = init.upload_session_uuid;

    // رفع الأجزاء 1 و 2 و 3
    await uploadService.uploadChunk(
      sid,
      1,
      `bytes 0-${chunkSize - 1}/${fullBuffer.length}`,
      c1,
      50,
    );
    await uploadService.uploadChunk(
      sid,
      1,
      `bytes ${chunkSize}-${2 * chunkSize - 1}/${fullBuffer.length}`,
      c2,
      50,
    );
    await uploadService.uploadChunk(
      sid,
      1,
      `bytes ${2 * chunkSize}-${3 * chunkSize - 1}/${fullBuffer.length}`,
      c3,
      50,
    );

    // انقطاع الشبكة → العميل يستعلم عن الموضع عبر probeSession
    const probe = await uploadService.probeSession(sid, 1, 50);
    expect(probe.bytes_received).toBe(3 * chunkSize);

    // العميل يعيد إرسال الجزء الثالث بالخطأ → 409 OUT_OF_ORDER مع الموضع الدقيق دون كتابة أي بايت إضافي
    const err = await uploadService
      .uploadChunk(
        sid,
        1,
        `bytes ${2 * chunkSize}-${3 * chunkSize - 1}/${fullBuffer.length}`,
        c3,
        50,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      error: 'OUT_OF_ORDER',
      bytes_received: 3 * chunkSize,
      next_expected_byte: 3 * chunkSize,
    });
    expect(await storage.getTempFileSize(sid)).toBe(3 * chunkSize);

    // العميل يستكمل بالجزء الرابع
    await uploadService.uploadChunk(
      sid,
      1,
      `bytes ${3 * chunkSize}-${fullBuffer.length - 1}/${fullBuffer.length}`,
      c4,
      50,
    );

    const completed = await uploadService.completeSession(
      sid,
      1,
      'school-1',
      50,
    );
    expect(completed.processing_status).toBe('PROCESSING');

    const stagingPath = storage.getVideoStagingPath(
      init.media_asset_uuid,
      'mp4',
    );
    const finalBuf = await fs.promises.readFile(stagingPath);
    expect(finalBuf.length).toBe(fullBuffer.length);
    expect(createHash('sha256').update(finalBuf).digest('hex')).toBe(
      expectedSha,
    );
  });

  // ── U-T3: Disk Exhaustion ──

  it('U-T3 (Disk Exhaustion): امتلاء المساحة عبر جلسات متزامنة يرفض الجلسة الإضافية بـ 507 INSUFFICIENT_STORAGE بصفر صفوف أو ملفات يتيمة', async () => {
    // المساحة الحرة الفعلية 5.25 GB (فوق الحد الأدنى 5 GB بـ 250 MB فقط)
    jest
      .spyOn(diskGuard as any, 'measureFreeBytes')
      .mockResolvedValue(BigInt(5_250_000_000));

    // الجلسة الأولى تحجز 150 MB → يتبقى 5.10 GB ≥ 5 GB (تُقبل)
    const s1 = await uploadService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: 150_000_000,
      },
      1,
      'school-1',
      { userId: 50, role: 'TEACHER' },
    );
    expect(s1.upload_session_uuid).toBeDefined();
    expect(db.sessions.size).toBe(1);
    expect(db.assets.size).toBe(1);

    // الجلسة الثانية تطلب 120 MB → سيتبقى 4.98 GB < 5 GB (تُرفض بـ 507 دون إنشاء أي صف)
    const err: HttpException = await uploadService
      .initSession(
        {
          kind: MediaKind.VIDEO,
          contentType: 'video/mp4',
          totalSizeBytes: 120_000_000,
        },
        1,
        'school-1',
        { userId: 50, role: 'TEACHER' },
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
    expect(err.getResponse()).toMatchObject({ error: 'INSUFFICIENT_STORAGE' });
    // لم يُضف أي صف لـ MediaAsset أو MediaUploadSession
    expect(db.sessions.size).toBe(1);
    expect(db.assets.size).toBe(1);
  });

  // ── U-T4: Session Expiry & Temp Cleanup (W-064) ──

  it('U-T4 (Session Expiry & Temp Cleanup — W-064): cleanupExpiredSessions تحذف .part للجلسة المنتهية ولا تمس ملف video-staging للجلسة المكتملة', async () => {
    const payload = randomBytes(50_000);

    // 1) جلسة مكتملة نُقل ملفها إلى video-staging (حتى لو انتهى وقت expiresAt لاحقاً!)
    const completedInit = await uploadService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: payload.length,
      },
      1,
      'school-1',
      { userId: 50, role: 'TEACHER' },
    );
    await uploadService.uploadChunk(
      completedInit.upload_session_uuid,
      1,
      `bytes 0-${payload.length - 1}/${payload.length}`,
      payload,
      50,
    );
    await uploadService.completeSession(
      completedInit.upload_session_uuid,
      1,
      'school-1',
      50,
    );

    // 2) جلسة ثانية غير مكتملة انتهت صلاحيتها
    const abandonedInit = await uploadService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: 100_000,
      },
      1,
      'school-1',
      { userId: 50, role: 'TEACHER' },
    );
    await uploadService.uploadChunk(
      abandonedInit.upload_session_uuid,
      1,
      'bytes 0-9999/100000',
      randomBytes(10_000),
      50,
    );

    // تقديم الزمن إلى ما بعد انتهاء صلاحية الجلستين
    for (const s of db.sessions.values()) {
      s.expiresAt = new Date(Date.now() - 60_000);
    }

    const abandonedPartPath = storage.getTempPath(
      abandonedInit.upload_session_uuid,
    );
    const completedStagingPath = storage.getVideoStagingPath(
      completedInit.media_asset_uuid,
      'mp4',
    );
    expect(fs.existsSync(abandonedPartPath)).toBe(true);
    expect(fs.existsSync(completedStagingPath)).toBe(true);

    // تشغيل منظف الجلسات المنتهية
    const cleanedCount = await cleanupService.cleanupExpiredSessions();
    expect(cleanedCount).toBe(1);

    // حُذف ملف .part للجلسة المتروكة وأُلغيت الجلسة وحُذف أصلها ناعماً
    expect(fs.existsSync(abandonedPartPath)).toBe(false);
    const abandonedSession = [...db.sessions.values()].find(
      (s) => s.uuid === abandonedInit.upload_session_uuid,
    )!;
    expect(abandonedSession.status).toBe(MediaUploadStatus.CANCELED);
    expect(db.assets.get(abandonedSession.mediaAssetId)!.isDeleted).toBe(true);

    // بينما ملف video-staging للجلسة المكتملة وأصلها لم يُمسّا إطلاقاً!
    expect(fs.existsSync(completedStagingPath)).toBe(true);
    const completedSession = [...db.sessions.values()].find(
      (s) => s.uuid === completedInit.upload_session_uuid,
    )!;
    expect(completedSession.status).toBe(MediaUploadStatus.COMPLETED);
    expect(db.assets.get(completedSession.mediaAssetId)!.isDeleted).toBe(false);
  });
});
