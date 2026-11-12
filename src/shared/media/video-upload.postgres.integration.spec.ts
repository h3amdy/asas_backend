/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
// src/shared/media/video-upload.postgres.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🐘 VIDEO P4-3 — اختبارات تكاملية حقيقية على PostgreSQL الفعلي
// ═══════════════════════════════════════════════════════════════
// ينشئ قاعدة بيانات PostgreSQL مؤقتة معزولة (asas_video_p43_pg_test_*)
// ويطبق جميع المهاجرات عبر `prisma migrate deploy`، ثم يختبر بمعاملات
// واتصالات PostgreSQL حقيقية ونظام ملفات فعلي والتحقق من SHA-256:
//   1. PG-IT-1: طلبان متزامنان بالإزاحة نفسها (School + Platform + عبر نسختين مستقلتين).
//   2. PG-IT-2: طلبان متتابعان بإزاحتين صحيحتين يصلان بالتزامن.
//   3. PG-IT-3: إعادة إرسال جزء سبق قبوله (409 OUT_OF_ORDER بلا مضاعفة حجم).
//   4. PG-IT-4: انقطاع/قتل العملية بعد كتابة القرص وقبل تحديث DB ثم Recovery عبر probe و uploadChunk.
//   5. PG-IT-5 (U-T1): استدعاء complete مرتين بالتزامن وإنشاء مهمة واحدة فقط + فشل ffprobe الذرّي.
//   6. PG-IT-6 (U-T3): جلسات رفع متزامنة تتنافس على المساحة المتاحة تحت pg_advisory_xact_lock.
//   7. PG-IT-7 (U-T4): انتهاء صلاحية جلسة وتنظيف .part دون المساس بـ video-staging وعدم وجود أيتام.
// ═══════════════════════════════════════════════════════════════

import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import {
  AppType,
  MediaKind,
  MediaUploadStatus,
  PlatformRole,
  ProcessingStatus,
  UserType,
} from '@prisma/client';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { PlatformMediaUploadService } from '../../platform/media/platform-media-upload.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaCleanupService } from '../../school/media/media-cleanup.service';
import { MediaUploadService } from '../../school/media/media-upload.service';
import { DiskSpaceGuardService } from './disk-space-guard.service';
import { FfprobeResult, FfprobeService, VideoInfo } from './ffprobe.service';
import { MediaAccessPolicyService } from './media-access-policy.service';
import { StorageService } from './storage.service';
import { UploadValidationHelper } from './upload-validation.helper';
import { VideoMediaConfig } from './video-media.config';
import { VideoUploadService } from './video-upload.service';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fileSha256Hex(filePath: string): Promise<string> {
  const buf = await fs.promises.readFile(filePath);
  return sha256Hex(buf);
}

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p43_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(
      `SAFETY: test database name "${dbName}" violates naming format.`,
    );
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

function makeEnabledVideoConfig(): VideoMediaConfig {
  const prev: Record<string, string | undefined> = {};
  const vars: Record<string, string> = {
    VIDEO_UPLOAD_ENABLED: 'true',
    R2_ACCOUNT_ID: 'acc-pg-test',
    R2_ACCESS_KEY_ID: 'key-pg-test',
    R2_SECRET_ACCESS_KEY: 'secret-pg-test',
    R2_BUCKET_NAME: 'asas-media-pg-test',
  };
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return new VideoMediaConfig();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const VALID_PROBE_INFO: VideoInfo = {
  width: 1280,
  height: 720,
  durationSec: 45.2,
  videoCodec: 'h264',
  audioCodec: 'aac',
  fps: 30,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  isSilent: false,
  rotation: 0,
};

describe('VIDEO P4-3 — PostgreSQL Integration Tests (Real DB + Real FS + SHA-256)', () => {
  let prisma: PrismaService;
  let prismaPeer: PrismaService;
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;
  let tmpStorageDir = '';
  let prevStoragePath: string | undefined;

  // بيانات البذر الأساسية في PostgreSQL
  let schoolId = 0;
  let schoolUuid = '';
  let teacherUserId = 0;
  let platformTeacherId = 0;

  let videoConfig: VideoMediaConfig;
  let storage: StorageService;
  let ffprobe: FfprobeService;
  let probeValid = true;
  let freeDiskBytes = BigInt(50_000_000_000); // 50GB افتراضياً

  beforeAll(async () => {
    tempDbName = `asas_video_p43_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);
    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}`;

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
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    prisma = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaPeer = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prisma.$connect();
    await prismaPeer.$connect();

    const rows: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(
        `ISOLATION FAILURE: connected to "${rows[0]?.db}" instead of "${tempDbName}"`,
      );
    }

    // إعداد مجلد تخزين حقيقي معزول
    tmpStorageDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'p43-pg-storage-'),
    );
    prevStoragePath = process.env.MEDIA_STORAGE_PATH;
    process.env.MEDIA_STORAGE_PATH = tmpStorageDir;

    videoConfig = makeEnabledVideoConfig();
    storage = new StorageService();
    ffprobe = new FfprobeService(videoConfig);
    jest
      .spyOn(ffprobe, 'probe')
      .mockImplementation(async (): Promise<FfprobeResult> => {
        if (probeValid) {
          return { valid: true, errors: [], info: VALID_PROBE_INFO };
        }
        return {
          valid: false,
          errors: ['UNSUPPORTED_VIDEO_CODEC: ترميز الفيديو غير مدعوم'],
          info: null,
        };
      });

    // بذر مدرسة ومعلم مسند فعلياً ومعلم منصة مسند في PostgreSQL الفعلي
    const school = await prisma.school.create({
      data: {
        name: 'مدرسة اختبار التكامل',
        schoolCode: 99101,
        appType: AppType.PUBLIC,
      },
    });
    schoolId = school.id;
    schoolUuid = school.uuid;

    const gradeDict = await prisma.gradeDictionary.create({
      data: {
        code: 'G-PG-1',
        defaultName: 'الصف الأول',
      },
    });

    const subjectDict = await prisma.subjectDictionary.create({
      data: {
        gradeDictionaryId: gradeDict.id,
        code: 'SUB-PG-1',
        defaultName: 'الرياضيات',
      },
    });

    const schoolGrade = await prisma.schoolGrade.create({
      data: {
        schoolId: school.id,
        dictionaryId: gradeDict.id,
        displayName: 'الصف الأول',
        sortOrder: 1,
      },
    });

    const section = await prisma.section.create({
      data: {
        gradeId: schoolGrade.id,
        name: 'أ',
        orderIndex: 1,
      },
    });

    const subject = await prisma.subject.create({
      data: {
        schoolId: school.id,
        gradeId: schoolGrade.id,
        dictionaryId: subjectDict.id,
        displayName: 'الرياضيات',
      },
    });

    const subjectSection = await prisma.subjectSection.create({
      data: {
        subjectId: subject.id,
        sectionId: section.id,
      },
    });

    const teacherUser = await prisma.user.create({
      data: {
        code: 9200001,
        schoolId: school.id,
        userType: UserType.TEACHER,
        name: 'معلم مسند',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    teacherUserId = teacherUser.id;

    await prisma.teacher.create({
      data: {
        userId: teacherUser.id,
      },
    });

    await prisma.subjectSectionTeacher.create({
      data: {
        subjectSectionId: subjectSection.id,
        teacherId: teacherUser.id,
      },
    });

    const platformTeacher = await prisma.platformUser.create({
      data: {
        username: 'plat_teacher_pg',
        passwordHash: 'hash',
        name: 'معلم منصة مسند',
        role: PlatformRole.PLATFORM_TEACHER,
        isActive: true,
      },
    });
    platformTeacherId = platformTeacher.id;

    await prisma.platformUserSubject.create({
      data: {
        platformUserId: platformTeacher.id,
        subjectDictionaryId: subjectDict.id,
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (prevStoragePath === undefined) delete process.env.MEDIA_STORAGE_PATH;
    else process.env.MEDIA_STORAGE_PATH = prevStoragePath;

    if (tmpStorageDir) {
      await fs.promises
        .rm(tmpStorageDir, { recursive: true, force: true })
        .catch(() => undefined);
    }

    try {
      await prismaPeer?.$disconnect();
    } catch {
      // ignore
    }
    try {
      await prisma?.$disconnect();
    } catch {
      // ignore
    }

    if (dbCreated) {
      try {
        await execFileAsync('psql', [
          '-h',
          'localhost',
          '-p',
          '5432',
          '-d',
          'postgres',
          '-c',
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${tempDbName}';`,
        ]);
        await execFileAsync('dropdb', [
          '-h',
          'localhost',
          '-p',
          '5432',
          '--if-exists',
          tempDbName,
        ]);
      } catch {
        // ignore
      }
    }
  }, 60_000);

  beforeEach(() => {
    probeValid = true;
    freeDiskBytes = BigInt(50_000_000_000);
  });

  /**
   * يبني نسخة كاملة من خدمات الرفع متصلة بقاعدة PostgreSQL الفعلية.
   * يقبل مثيل PrismaService مخصصاً (`prisma` أو `prismaPeer`) بحيث تعمل كل عقدة
   * عبر تجمع اتصالات PostgreSQL مستقل تماماً وبلا أي اشتراك في `withSessionLock` المحلي.
   */
  function buildServicesInstance(dbClient: PrismaService = prisma) {
    const validation = new UploadValidationHelper(videoConfig);
    const accessPolicy = new MediaAccessPolicyService(dbClient);
    const diskGuard = new DiskSpaceGuardService(dbClient);
    jest
      .spyOn(diskGuard as any, 'measureFreeBytes')
      .mockImplementation(async () => freeDiskBytes);

    const videoUpload = new VideoUploadService(
      dbClient,
      storage,
      videoConfig,
      diskGuard,
      ffprobe,
      validation,
    );
    const processing = {
      processAsset: jest.fn().mockResolvedValue(undefined),
    } as any;

    const schoolService = new MediaUploadService(
      dbClient,
      storage,
      processing,
      videoUpload,
      validation,
      accessPolicy,
    );
    const platformService = new PlatformMediaUploadService(
      dbClient,
      storage,
      processing,
      videoUpload,
      validation,
      accessPolicy,
    );
    const cleanupService = new MediaCleanupService(dbClient, storage);

    return {
      prisma: dbClient,
      validation,
      diskGuard,
      videoUpload,
      schoolService,
      platformService,
      cleanupService,
    };
  }

  // ── 1) PG-IT-1: طلبان متزامنان بالإزاحة نفسها (School + Platform + عبر نسختين ومثيلي Prisma مستقلين) ──

  it('PG-IT-1: طلبان متزامنان بالإزاحة نفسها عبر مثيلين مستقلين من Prisma واتصالين فعليين بـ PostgreSQL — يمر طلب واحد فقط ويُرفض الآخر بـ 409 OUT_OF_ORDER', async () => {
    // نستخدم عقدتين مستقلتين تماماً: كل عقدة تملك مثيل PrismaService مستقل واتصال PostgreSQL مستقل و UploadValidationHelper مستقل!
    const nodeA = buildServicesInstance(prisma);
    const nodeB = buildServicesInstance(prismaPeer);
    expect(nodeA.prisma).not.toBe(nodeB.prisma);
    expect(nodeA.validation).not.toBe(nodeB.validation);

    // إثبات أن prisma و prismaPeer يستخدمان عمليتي خادم PostgreSQL منفصلتين (pg_backend_pid مختلفان)
    let unblockPidCheck!: () => void;
    const holdLock = new Promise<void>((r) => {
      unblockPidCheck = r;
    });
    const [pidA, pidB] = await Promise.all([
      nodeA.prisma.$transaction(async (tx) => {
        const r = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        unblockPidCheck();
        return r[0].pid;
      }),
      nodeB.prisma.$transaction(async (tx) => {
        await holdLock;
        const r = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        return r[0].pid;
      }),
    ]);
    expect(pidA).not.toBe(pidB);

    const chunkLen = 16_384;
    const totalLen = chunkLen * 3;
    const chunk0A = crypto.randomBytes(chunkLen);
    const chunk0B = crypto.randomBytes(chunkLen);

    // أ) في المدرسة (School)
    const initSchool = await nodeA.schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: totalLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const sUuid = initSchool.upload_session_uuid;

    const [resA, resB] = await Promise.allSettled([
      nodeA.schoolService.uploadChunk(
        sUuid,
        schoolId,
        `bytes 0-${chunkLen - 1}/${totalLen}`,
        chunk0A,
        teacherUserId,
      ),
      nodeB.schoolService.uploadChunk(
        sUuid,
        schoolId,
        `bytes 0-${chunkLen - 1}/${totalLen}`,
        chunk0B,
        teacherUserId,
      ),
    ]);

    const fulfilled = [resA, resB].filter(
      (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
    );
    const rejected = [resA, resB].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0].value).toEqual({
      bytes_received: chunkLen,
      next_expected_byte: chunkLen,
    });
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.getResponse()).toMatchObject({
      error: 'OUT_OF_ORDER',
      bytes_received: chunkLen,
      next_expected_byte: chunkLen,
    });

    // التحقق الفيزيائي من حجم الملف على القرص وبصمة SHA-256
    const diskSize = await storage.getTempFileSize(sUuid);
    expect(diskSize).toBe(chunkLen);
    const diskHash = await fileSha256Hex(storage.getTempPath(sUuid));
    const expectedWinnerHash =
      resA.status === 'fulfilled' ? sha256Hex(chunk0A) : sha256Hex(chunk0B);
    expect(diskHash).toBe(expectedWinnerHash);

    // ب) في المنصة (Platform)
    const initPlat = await nodeA.platformService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: totalLen,
        chunkSizeBytes: chunkLen,
      },
      { platformUserId: platformTeacherId, role: 'PLATFORM_TEACHER' },
    );
    const pUuid = initPlat.upload_session_uuid;

    const [pResA, pResB] = await Promise.allSettled([
      nodeA.platformService.uploadChunk(
        pUuid,
        `bytes 0-${chunkLen - 1}/${totalLen}`,
        chunk0A,
        { platformUserId: platformTeacherId, role: 'PLATFORM_TEACHER' },
      ),
      nodeB.platformService.uploadChunk(
        pUuid,
        `bytes 0-${chunkLen - 1}/${totalLen}`,
        chunk0B,
        { platformUserId: platformTeacherId, role: 'PLATFORM_TEACHER' },
      ),
    ]);

    expect([pResA, pResB].filter((r) => r.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect([pResA, pResB].filter((r) => r.status === 'rejected')).toHaveLength(
      1,
    );
    expect(await storage.getTempFileSize(pUuid)).toBe(chunkLen);

    // تنظيف الجلستين
    await nodeA.schoolService.cancelSession(sUuid, schoolId, teacherUserId);
    await nodeA.platformService.cancelSession(pUuid, {
      platformUserId: platformTeacherId,
      role: 'PLATFORM_TEACHER',
    });
  });

  // ── 2 & 3) PG-IT-2 + PG-IT-3: طلبان متتابعان بالتزامن + إعادة إرسال جزء مقبول سابقاً + SHA-256 ──

  it('PG-IT-2 & PG-IT-3: طلبان متتابعان يصلان بالتزامن يتسلسلان بأمان، وإعادة إرسال جزء سابق تُرفض بـ 409 مع تطابق SHA-256 النهائي', async () => {
    const { schoolService } = buildServicesInstance();
    const chunkLen = 16_384;
    const totalLen = chunkLen * 3;
    const c0 = crypto.randomBytes(chunkLen);
    const c1 = crypto.randomBytes(chunkLen);
    const c2 = crypto.randomBytes(chunkLen);
    const expectedFullSha256 = sha256Hex(Buffer.concat([c0, c1, c2]));

    const init = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: totalLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const sUuid = init.upload_session_uuid;

    // رفع الجزء الأول (0)
    await schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${totalLen}`,
      c0,
      teacherUserId,
    );

    // PG-IT-2: إرسال الجزء الثاني (c1) والجزء الثالث (c2) بالتزامن في نفس اللحظة
    const [r1, r2] = await Promise.all([
      schoolService.uploadChunk(
        sUuid,
        schoolId,
        `bytes ${chunkLen}-${chunkLen * 2 - 1}/${totalLen}`,
        c1,
        teacherUserId,
      ),
      schoolService.uploadChunk(
        sUuid,
        schoolId,
        `bytes ${chunkLen * 2}-${totalLen - 1}/${totalLen}`,
        c2,
        teacherUserId,
      ),
    ]);

    expect(r1).toEqual({
      bytes_received: chunkLen * 2,
      next_expected_byte: chunkLen * 2,
    });
    expect(r2).toEqual({
      bytes_received: totalLen,
      next_expected_byte: totalLen,
    });

    // PG-IT-3: إعادة إرسال الجزء الثاني (c1) بعد قبوله مسبقاً → 409 OUT_OF_ORDER
    const resendErr = await schoolService
      .uploadChunk(
        sUuid,
        schoolId,
        `bytes ${chunkLen}-${chunkLen * 2 - 1}/${totalLen}`,
        c1,
        teacherUserId,
      )
      .catch((e) => e);
    expect(resendErr).toBeInstanceOf(ConflictException);
    expect(resendErr.getResponse()).toMatchObject({
      error: 'OUT_OF_ORDER',
      bytes_received: totalLen,
      next_expected_byte: totalLen,
    });

    // التحقق من عدم تغير حجم الملف أو بصمته SHA-256
    expect(await storage.getTempFileSize(sUuid)).toBe(totalLen);
    expect(await fileSha256Hex(storage.getTempPath(sUuid))).toBe(
      expectedFullSha256,
    );

    // إكمال الجلسة والتحقق من بصمة الملف المنقول إلى video-staging
    const completed = await schoolService.completeSession(
      sUuid,
      schoolId,
      schoolUuid,
      teacherUserId,
    );
    const stagingPath = storage.getVideoStagingPath(
      completed.media_asset_uuid,
      'mp4',
    );
    expect(await fileSha256Hex(stagingPath)).toBe(expectedFullSha256);
  });

  // ── 4) PG-IT-4: قتل/انقطاع العملية بعد كتابة القرص وقبل تحديث DB ثم Recovery ──

  it('PG-IT-4: يعالج انقطاع العملية أو فشل DB بعد كتابة القرص وقبل تحديث السجل، ويصالح حجم الملف ويستكمل الرفع بتطابق SHA-256', async () => {
    const { schoolService, validation } = buildServicesInstance();
    const chunkLen = 16_384;
    const totalLen = chunkLen * 3;
    const c0 = crypto.randomBytes(chunkLen);
    const c1 = crypto.randomBytes(chunkLen);
    const c2CorruptedUncommitted = crypto.randomBytes(chunkLen);
    const c2Real = crypto.randomBytes(chunkLen);
    const expectedFullSha256 = sha256Hex(Buffer.concat([c0, c1, c2Real]));

    const init = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: totalLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const sUuid = init.upload_session_uuid;
    const tempPath = storage.getTempPath(sUuid);

    // رفع الجزأين الأول والثاني بنجاح (bytes_received = 32768 في PostgreSQL)
    await schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${totalLen}`,
      c0,
      teacherUserId,
    );
    await schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes ${chunkLen}-${chunkLen * 2 - 1}/${totalLen}`,
      c1,
      teacherUserId,
    );

    // (أ) محاكاة فشل قاعدة البيانات/انقطاع في منتصف المعاملة بعد الكتابة على القرص مباشرةً
    validation.onAfterDiskWriteBeforeDbUpdate = () => {
      throw new Error('SIMULATED_PROCESS_ABORT_BEFORE_DB_COMMIT');
    };
    await expect(
      schoolService.uploadChunk(
        sUuid,
        schoolId,
        `bytes ${chunkLen * 2}-${totalLen - 1}/${totalLen}`,
        c2CorruptedUncommitted,
        teacherUserId,
      ),
    ).rejects.toThrow('SIMULATED_PROCESS_ABORT_BEFORE_DB_COMMIT');
    validation.onAfterDiskWriteBeforeDbUpdate = undefined;

    // التراجع الفوري (rollbackChunkWrite) أعاد حجم الملف إلى 32768 بايت
    expect(await storage.getTempFileSize(sUuid)).toBe(chunkLen * 2);

    // (ب) محاكاة قتل العملية بـ SIGKILL قبل تشغيل catch (بقاء ذيل غير ملتزم على القرص بحجم 49152 بينما DB = 32768)
    await fs.promises.appendFile(tempPath, c2CorruptedUncommitted);
    expect(await storage.getTempFileSize(tempPath ? sUuid : sUuid)).toBe(
      totalLen,
    );

    // عند استدعاء probeSession: يكتشف reconcileTempFile الذيل غير الملتزم ويقصّه إلى 32768 بايت
    const probe = await schoolService.probeSession(
      sUuid,
      schoolId,
      teacherUserId,
    );
    expect(probe.bytes_received).toBe(chunkLen * 2);
    expect(await storage.getTempFileSize(sUuid)).toBe(chunkLen * 2);
    expect(await fileSha256Hex(tempPath)).toBe(
      sha256Hex(Buffer.concat([c0, c1])),
    );

    // (ج) استكمال رفع الجزء الثالث الصحيح (c2Real) وإكمال الجلسة بنجاح
    await schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes ${chunkLen * 2}-${totalLen - 1}/${totalLen}`,
      c2Real,
      teacherUserId,
    );
    const completed = await schoolService.completeSession(
      sUuid,
      schoolId,
      schoolUuid,
      teacherUserId,
    );

    const stagingPath = storage.getVideoStagingPath(
      completed.media_asset_uuid,
      'mp4',
    );
    expect(await fileSha256Hex(stagingPath)).toBe(expectedFullSha256);

    // (د) التحقق من رفض الجلسة إذا تعرض ملف القرص لتلف/نقص أقل من العداد الملتزم (diskBytes < bytesReceived)
    const initCorrupt = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: chunkLen * 2,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const corruptUuid = initCorrupt.upload_session_uuid;
    await schoolService.uploadChunk(
      corruptUuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${chunkLen * 2}`,
      c0,
      teacherUserId,
    );
    // إتلاف الملف الفعلي بجعله أصغر من bytes_received (مثلاً 100 بايت بدلاً من 16384)
    await fs.promises.truncate(storage.getTempPath(corruptUuid), 100);

    const corruptErr = await schoolService
      .uploadChunk(
        corruptUuid,
        schoolId,
        `bytes ${chunkLen}-${chunkLen * 2 - 1}/${chunkLen * 2}`,
        c1,
        teacherUserId,
      )
      .catch((e) => e);
    expect(corruptErr).toBeInstanceOf(ConflictException);
    expect(corruptErr.getResponse()).toMatchObject({
      error: 'TEMP_FILE_CORRUPTED',
      committed_bytes: chunkLen,
      actual_file_bytes: 100,
    });

    await schoolService.cancelSession(corruptUuid, schoolId, teacherUserId);
  });

  // ── 5) PG-IT-5 (U-T1): استدعاء complete مرتين بالتزامن وإنشاء مهمة واحدة فقط + فشل ffprobe الذرّي ──

  it('PG-IT-5 (U-T1): استدعاء complete مرتين بالتزامن على PostgreSQL الفعلي ينشئ مهمة TRANSCODE_VIDEO واحدة فقط ويحافظ على SHA-256', async () => {
    const nodeA = buildServicesInstance(prisma);
    const nodeB = buildServicesInstance(prismaPeer);
    expect(nodeA.prisma).not.toBe(nodeB.prisma);
    const chunkLen = 16_384;
    const payload = crypto.randomBytes(chunkLen);
    const expectedSha256 = sha256Hex(payload);

    const init = await nodeA.schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: chunkLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const sUuid = init.upload_session_uuid;

    await nodeA.schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${chunkLen}`,
      payload,
      teacherUserId,
    );

    // استدعاءان متزامنان لـ completeSession عبر عقدتين مستقلتين (يختبر قفل FOR UPDATE الفعلي في PostgreSQL)
    const [comp1, comp2] = await Promise.all([
      nodeA.schoolService.completeSession(
        sUuid,
        schoolId,
        schoolUuid,
        teacherUserId,
      ),
      nodeB.schoolService.completeSession(
        sUuid,
        schoolId,
        schoolUuid,
        teacherUserId,
      ),
    ]);

    expect(comp1.media_asset_uuid).toBe(init.media_asset_uuid);
    expect(comp2.media_asset_uuid).toBe(init.media_asset_uuid);
    expect([comp1, comp2].some((c: any) => c.already_completed === false)).toBe(
      true,
    );
    expect([comp1, comp2].some((c: any) => c.already_completed === true)).toBe(
      true,
    );

    // مهمة واحدة فقط في جدول media_processing_jobs في PostgreSQL
    const jobs = await prisma.mediaProcessingJob.findMany({
      where: { idempotencyKey: `TRANSCODE_VIDEO:${init.media_asset_uuid}` },
    });
    expect(jobs).toHaveLength(1);

    // التحقق من وجود الملف في video-staging وتطابق SHA-256
    const stagingPath = storage.getVideoStagingPath(
      init.media_asset_uuid,
      'mp4',
    );
    expect(await fileSha256Hex(stagingPath)).toBe(expectedSha256);

    // اختبار رفض ffprobe (422): انتقال الجلسة إلى CANCELED والأصل إلى isDeleted داخل قفل المعاملة وحذف .part
    probeValid = false;
    const badInit = await nodeA.schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: chunkLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    await nodeA.schoolService.uploadChunk(
      badInit.upload_session_uuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${chunkLen}`,
      payload,
      teacherUserId,
    );

    const badErr: HttpException = await nodeA.schoolService
      .completeSession(
        badInit.upload_session_uuid,
        schoolId,
        schoolUuid,
        teacherUserId,
      )
      .catch((e) => e);
    expect(badErr).toBeInstanceOf(HttpException);
    expect(badErr.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);

    const canceledSession = await prisma.mediaUploadSession.findUniqueOrThrow({
      where: { uuid: badInit.upload_session_uuid },
      include: { mediaAsset: true },
    });
    expect(canceledSession.status).toBe(MediaUploadStatus.CANCELED);
    expect(canceledSession.mediaAsset.isDeleted).toBe(true);
    expect(
      fs.existsSync(storage.getTempPath(badInit.upload_session_uuid)),
    ).toBe(false);
  });

  // ── 6) PG-IT-6 (U-T3): جلسات رفع متزامنة تتنافس على المساحة المتاحة تحت pg_advisory_xact_lock ──

  it('PG-IT-6 (U-T3): يفرض pg_advisory_xact_lock في PostgreSQL سقف المساحة المتاحة ويرفض الجلسات الزائدة بـ 507 دون سجلات أو ملفات يتيمة', async () => {
    const { schoolService } = buildServicesInstance();

    // تنظيف أي جلسات نشطة ومهام تحويل معلقة قبل قياس الحجز الدقيق
    await prisma.mediaUploadSession.updateMany({
      where: {
        status: {
          in: [MediaUploadStatus.INITIATED, MediaUploadStatus.UPLOADING],
        },
      },
      data: { status: MediaUploadStatus.CANCELED, canceledAt: new Date() },
    });
    await prisma.mediaProcessingJob.updateMany({
      where: { status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] } },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });

    // المساحة المتاحة 5.5GB، الأرضية الإلزامية 5.0GB → المتاح للحجز = 500MB
    // كل جلسة تطلب 150MB → يجب قبول 3 جلسات (450MB) ورفض 3 جلسات بـ 507 INSUFFICIENT_STORAGE
    freeDiskBytes = BigInt(5_500_000_000);
    const reqSize = 150_000_000;

    const beforeAssets = await prisma.mediaAsset.count();
    const beforeSessions = await prisma.mediaUploadSession.count();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        schoolService.initSession(
          {
            kind: MediaKind.VIDEO,
            contentType: 'video/mp4',
            totalSizeBytes: reqSize,
          },
          schoolId,
          schoolUuid,
          { userId: teacherUserId, role: 'TEACHER' },
        ),
      ),
    );

    const accepted = outcomes.filter(
      (o): o is PromiseFulfilledResult<any> => o.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );

    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(HttpException);
      expect((r.reason as HttpException).getStatus()).toBe(
        HttpStatus.INSUFFICIENT_STORAGE,
      );
      expect((r.reason as HttpException).getResponse()).toMatchObject({
        error: 'INSUFFICIENT_STORAGE',
      });
    }

    // التحقق من عدم وجود أي صفوف يتيمة في PostgreSQL للطلبات المرفوضة
    const afterAssets = await prisma.mediaAsset.count();
    const afterSessions = await prisma.mediaUploadSession.count();
    expect(afterAssets - beforeAssets).toBe(3);
    expect(afterSessions - beforeSessions).toBe(3);

    // إلغاء الجلسات الثلاث المقبولة لتحرير الحجز
    for (const acc of accepted) {
      await schoolService.cancelSession(
        acc.value.upload_session_uuid,
        schoolId,
        teacherUserId,
      );
    }
  });

  // ── 7) PG-IT-7 (U-T4): انتهاء جلسة وتنظيف .part دون المساس بـ video-staging ──

  it('PG-IT-7 (U-T4): cleanupExpiredSessions يحذف ملف .part للجلسة المنتهية ولا يمس ملف video-staging للجلسة المكتملة', async () => {
    const { schoolService, cleanupService } = buildServicesInstance();
    const chunkLen = 16_384;
    const completedData = crypto.randomBytes(chunkLen);
    const expiredData = crypto.randomBytes(chunkLen);

    // 1) جلسة مكتملة تنتظر العامل في video-staging
    const compInit = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: chunkLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    await schoolService.uploadChunk(
      compInit.upload_session_uuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${chunkLen}`,
      completedData,
      teacherUserId,
    );
    const compResult = await schoolService.completeSession(
      compInit.upload_session_uuid,
      schoolId,
      schoolUuid,
      teacherUserId,
    );
    const stagingPath = storage.getVideoStagingPath(
      compResult.media_asset_uuid,
      'mp4',
    );

    // 2) جلسة غير مكتملة منتهية الصلاحية
    const expInit = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: chunkLen * 2,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    await schoolService.uploadChunk(
      expInit.upload_session_uuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${chunkLen * 2}`,
      expiredData,
      teacherUserId,
    );
    const expPartPath = storage.getTempPath(expInit.upload_session_uuid);
    expect(fs.existsSync(expPartPath)).toBe(true);

    // تقديم expiresAt إلى الماضي لكلا الجلستين في PostgreSQL
    const pastDate = new Date(Date.now() - 3600_000);
    await prisma.mediaUploadSession.updateMany({
      where: {
        uuid: {
          in: [compInit.upload_session_uuid, expInit.upload_session_uuid],
        },
      },
      data: { expiresAt: pastDate },
    });

    // تشغيل التنظيف على PostgreSQL الفعلي
    const cleanedCount = await cleanupService.cleanupExpiredSessions();
    expect(cleanedCount).toBe(1);

    // التحقق من حذف .part وإلغاء الجلسة المنتهية وحذف أصلها ناعماً
    expect(fs.existsSync(expPartPath)).toBe(false);
    const expRow = await prisma.mediaUploadSession.findUniqueOrThrow({
      where: { uuid: expInit.upload_session_uuid },
      include: { mediaAsset: true },
    });
    expect(expRow.status).toBe(MediaUploadStatus.CANCELED);
    expect(expRow.mediaAsset.isDeleted).toBe(true);

    // التحقق من بقاء ملف video-staging للجلسة المكتملة سليماً ومطابقاً لبصمة SHA-256
    expect(fs.existsSync(stagingPath)).toBe(true);
    expect(await fileSha256Hex(stagingPath)).toBe(sha256Hex(completedData));
    const compRow = await prisma.mediaUploadSession.findUniqueOrThrow({
      where: { uuid: compInit.upload_session_uuid },
      include: { mediaAsset: true },
    });
    expect(compRow.status).toBe(MediaUploadStatus.COMPLETED);
    expect(compRow.mediaAsset.isDeleted).toBe(false);
    expect(compRow.mediaAsset.processingStatus).toBe(
      ProcessingStatus.PROCESSING,
    );
  });

  // ── 8) PG-IT-8: حسم حالة Ambiguous COMMIT (نجاح COMMIT في PostgreSQL مع ضياع تأكيده + تعذر الاتصال أثناء catch) ──

  it('PG-IT-8: يحافظ على الجزء المكتوب عند نجاح COMMIT في PostgreSQL وضياع تأكيده لدى التطبيق، ويتابع رفع الجزء التالي دون إعادة إرسال أو إتلاف (مع تطابق SHA-256)', async () => {
    const { schoolService, validation } = buildServicesInstance(prisma);
    const chunkLen = 16_384;
    const totalLen = chunkLen * 3;
    const c0 = crypto.randomBytes(chunkLen);
    const c1 = crypto.randomBytes(chunkLen);
    const c2 = crypto.randomBytes(chunkLen);
    const expectedFirstTwoHash = sha256Hex(Buffer.concat([c0, c1]));
    const expectedFullSha256 = sha256Hex(Buffer.concat([c0, c1, c2]));

    const init = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: totalLen,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const sUuid = init.upload_session_uuid;
    const tempPath = storage.getTempPath(sUuid);

    // 1) رفع الجزء الأول c0 بنجاح (B = 16384)
    await schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${totalLen}`,
      c0,
      teacherUserId,
    );
    expect(await storage.getTempFileSize(sUuid)).toBe(chunkLen);

    // 2) (أ) محاكاة نجاح COMMIT فعلياً في PostgreSQL (bytes_received = B + L = 32768)
    // ثم انقطاع الشبكة/ضياع تأكيد COMMIT قبل عودة prisma.$transaction إلى Node.js!
    const origTx = prisma.$transaction.bind(prisma);
    const txSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce((async (fn: any, options?: any) => {
        // تنفذ المعاملة الحقيقية وتلتزم COMMIT فعلياً في PostgreSQL
        await origTx(fn, options);
        // ثم نرمي خطأ فقدان تأكيد COMMIT بعد التزام PostgreSQL الفعلي
        throw new Error('SIMULATED_LOST_COMMIT_ACK_AFTER_PG_COMMIT');
      }) as any);

    await expect(
      schoolService.uploadChunk(
        sUuid,
        schoolId,
        `bytes ${chunkLen}-${chunkLen * 2 - 1}/${totalLen}`,
        c1,
        teacherUserId,
      ),
    ).rejects.toThrow('SIMULATED_LOST_COMMIT_ACK_AFTER_PG_COMMIT');
    txSpy.mockRestore();

    // التحقق من الحالة النهائية بعد مسار catch:
    // - في PostgreSQL: bytes_received = B + L (32768) لأن COMMIT نجح فعلاً
    const dbRowAfterAckLoss = await prisma.mediaUploadSession.findUniqueOrThrow(
      {
        where: { uuid: sUuid },
        select: { bytesReceived: true, status: true },
      },
    );
    expect(Number(dbRowAfterAckLoss.bytesReceived)).toBe(chunkLen * 2);

    // - على القرص: لم يُقص الملف إلى B (16384)، بل احتفظ بالجزء المكتوب (32768)
    expect(await storage.getTempFileSize(sUuid)).toBe(chunkLen * 2);

    // - بصمة SHA-256 للملف تطابق الجزأين الأول والثاني (c0 + c1)
    expect(await fileSha256Hex(tempPath)).toBe(expectedFirstTwoHash);

    // - عند استعلام العميل عبر probeSession أو متابعة الجزء الثالث (c2) مباشرةً دون إعادة إرسال c1:
    const probeAfterAckLoss = await schoolService.probeSession(
      sUuid,
      schoolId,
      teacherUserId,
    );
    expect(probeAfterAckLoss.bytes_received).toBe(chunkLen * 2);
    expect(probeAfterAckLoss.status).toBe(MediaUploadStatus.UPLOADING);

    // 3) متابعة رفع الجزء الثالث (c2) مباشرةً من الإزاحة B + L (32768) دون إعادة إرسال الجزء الثاني (c1)
    const r2 = await schoolService.uploadChunk(
      sUuid,
      schoolId,
      `bytes ${chunkLen * 2}-${totalLen - 1}/${totalLen}`,
      c2,
      teacherUserId,
    );
    expect(r2).toEqual({
      bytes_received: totalLen,
      next_expected_byte: totalLen,
    });

    // إكمال الجلسة والتحقق من تطابق SHA-256 الكامل في video-staging
    const completed = await schoolService.completeSession(
      sUuid,
      schoolId,
      schoolUuid,
      teacherUserId,
    );
    const stagingPath = storage.getVideoStagingPath(
      completed.media_asset_uuid,
      'mp4',
    );
    expect(await fileSha256Hex(stagingPath)).toBe(expectedFullSha256);

    // 4) (ب) محاكاة فشل المعاملة وتعذر الاتصال بـ PostgreSQL أثناء catch (نتيجة غامضة تماماً لحظة الخطأ):
    // يجب عدم قص الملف أثناء انقطاع DB، وترك المصالحة للاستدعاء التالي عندما يعود الاتصال.
    const initAmbiguous = await schoolService.initSession(
      {
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: chunkLen * 2,
        chunkSizeBytes: chunkLen,
      },
      schoolId,
      schoolUuid,
      { userId: teacherUserId, role: 'TEACHER' },
    );
    const ambUuid = initAmbiguous.upload_session_uuid;
    await schoolService.uploadChunk(
      ambUuid,
      schoolId,
      `bytes 0-${chunkLen - 1}/${chunkLen * 2}`,
      c0,
      teacherUserId,
    );

    const c1Uncommitted = crypto.randomBytes(chunkLen);
    let queryRawSpy: jest.SpyInstance | undefined;
    validation.onAfterDiskWriteBeforeDbUpdate = () => {
      // بعد الكتابة على القرص مباشرةً، يتعطل الاتصال بـ PostgreSQL فلا ينجح التحديث ولا الاستعلام في catch
      queryRawSpy = jest
        .spyOn(prisma, '$queryRaw')
        .mockRejectedValueOnce(new Error('DB_STILL_UNREACHABLE_IN_CATCH'));
      throw new Error('SIMULATED_CONNECTION_DROP_DURING_TX');
    };

    await expect(
      schoolService.uploadChunk(
        ambUuid,
        schoolId,
        `bytes ${chunkLen}-${chunkLen * 2 - 1}/${chunkLen * 2}`,
        c1Uncommitted,
        teacherUserId,
      ),
    ).rejects.toThrow('SIMULATED_CONNECTION_DROP_DURING_TX');
    validation.onAfterDiskWriteBeforeDbUpdate = undefined;
    queryRawSpy?.mockRestore();

    // لأن النتيجة كانت غامضة (تعذر الاتصال بـ DB في catch)، لم يُقص الملف فوراً وبقي بحجم B + L (32768)
    expect(await storage.getTempFileSize(ambUuid)).toBe(chunkLen * 2);

    // وعند عودة اتصال DB ورفع الجزء الثاني الصحيح (c1)، يقوم reconcileTempFile تحت FOR UPDATE بقص الذيل غير الملتزم وكتابة c1
    const rAmb = await schoolService.uploadChunk(
      ambUuid,
      schoolId,
      `bytes ${chunkLen}-${chunkLen * 2 - 1}/${chunkLen * 2}`,
      c1,
      teacherUserId,
    );
    expect(rAmb).toEqual({
      bytes_received: chunkLen * 2,
      next_expected_byte: chunkLen * 2,
    });
    expect(await fileSha256Hex(storage.getTempPath(ambUuid))).toBe(
      expectedFirstTwoHash,
    );

    await schoolService.cancelSession(ambUuid, schoolId, teacherUserId);
  });
});
