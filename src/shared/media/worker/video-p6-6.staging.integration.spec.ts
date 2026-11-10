/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
// src/shared/media/worker/video-p6-6.staging.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🛡️ VIDEO P6 (Stage 3) — اختبارات عزل المستأجرين والاشتراكات والتوزيع المشترك (P6-6.0 .. P6-6.4)
// مرجع: docs/features/video/11-VIDEO-P6-INTEGRATION-TEST-PLAN.md (v1.5 — Approved in chat331.md)
//        docs/Sessions/11_3_11_2026/chat335.md (Stage 3 Execution Authorization)
// ═══════════════════════════════════════════════════════════════
//
// الضوابط الحاكمة المعتمدة (chat331.md & chat335.md):
// 1. ملف اختبار مستقل (video-p6-6.staging.integration.spec.ts) دون أي تعديل للكود الإنتاجي أو الترحيلات.
// 2. يعمل على قاعدة الاختبار المحلية asas_dev مع التحقق الصارم من current_database() == 'asas_dev'،
//    ويحافظ 100% على البيانات السابقة في asas_dev وينظف حصرياً السجلات التي أنشأها هذا التشغيل.
// 3. يختبر نقاط API والحراس الفعلية عبر تطبيق NestJS HTTP حقيقي (SchoolJwtAuthGuard + SchoolJwtStrategy +
//    SchoolContextGuard + ParentStudentContextGuard + RolesGuard + ValidationPipe).
// 4. يستخدم حاوية الساندبوكس asas-media-poc تحت البادئة المعزولة p6-live-<runId>/ مع بوابة Pre-Flight
//    وتنظيف كامل للمفاتيح في نهاية التشغيل (HeadObject == 404).
// ═══════════════════════════════════════════════════════════════

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  DistributionStatus,
  MediaKind,
  PlatformRole,
  ProcessingStatus,
} from '@prisma/client';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { PlatformLessonsService } from '../../../platform/lessons/platform-lessons.service';
import { PlatformMediaUploadService } from '../../../platform/media/platform-media-upload.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SCHOOL_AUTH_JWT } from '../../../school/auth/constants';
import { SchoolJwtAuthGuard } from '../../../school/auth/guards/school-jwt-auth.guard';
import { SchoolJwtStrategy } from '../../../school/auth/strategies/school-jwt.strategy';
import { ParentStudentContextGuard } from '../../../school/common/guards/parent-student-context.guard';
import { RolesGuard } from '../../../school/common/guards/roles.guard';
import { SchoolContextGuard } from '../../../school/common/guards/school-context.guard';
import { SubjectsService } from '../../../school/manager/subjects/subjects.service';
import { MediaUploadService } from '../../../school/media/media-upload.service';
import { MediaController } from '../../../school/media/media.controller';
import { MediaService } from '../../../school/media/media.service';
import { PlatformContentController } from '../../../school/shared/platform-content/platform-content.controller';
import { PlatformContentService } from '../../../school/shared/platform-content/platform-content.service';
import { StudentSubscriptionController } from '../../../school/student/subscription/student-subscription.controller';
import { StudentSubscriptionService } from '../../../school/student/subscription/student-subscription.service';
import { TeacherLessonsController } from '../../../school/teacher/lessons/teacher-lessons.controller';
import { TeacherLessonsService } from '../../../school/teacher/lessons/teacher-lessons.service';
import { DiskSpaceGuardService } from '../disk-space-guard.service';
import { FfprobeService } from '../ffprobe.service';
import { LocalObjectStorageProvider } from '../local-object-storage.provider';
import { MediaAccessPolicyService } from '../media-access-policy.service';
import { MediaLifecycleService } from '../media-lifecycle.service';
import {
  CopyObjectOptions,
  CopyObjectResult,
  HeadOutcome,
  LocalFileDigest,
  TransferOptions,
  UploadFromFileOptions,
  UploadResult,
  VerifyResult,
} from '../object-storage.interface';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { MediaJobQueueService } from '../queue/media-job-queue.service';
import { R2StorageProvider } from '../r2-storage.provider';
import { StorageService } from '../storage.service';
import { UploadValidationHelper } from '../upload-validation.helper';
import {
  AMBIENT_PROD_R2_ENV_VARS,
  assertSafeR2SandboxEnvironment,
  R2Credentials,
  REQUIRED_R2_SANDBOX_ENV_VARS,
  VideoMediaConfig,
} from '../video-media.config';
import { VideoUploadService } from '../video-upload.service';
import { DeleteObjectsProcessor } from './delete-objects.processor';
import { MediaWorkerService } from './media-worker.service';
import { MoveSourceProcessor } from './move-source.processor';
import {
  parseVariantsManifest,
  VideoTranscodeProcessor,
} from './video-transcode.processor';

jest.setTimeout(360_000);

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SANDBOX_ENV_FILE = path.resolve(PROJECT_ROOT, '.env.r2-sandbox');
const DOTENV_FILE = path.resolve(PROJECT_ROOT, '.env');
const SCRATCH_BIN_DIR =
  '/Users/hamdy/.gemini/antigravity/brain/82d302f4-7d82-441f-948a-b6f07f9c6254/scratch/bin';

function formatCompactUtcTimestamp(d = new Date()): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function resolveRealBinary(binName: 'ffmpeg' | 'ffprobe'): string {
  const envKey =
    binName === 'ffmpeg' ? 'MEDIA_FFMPEG_BIN' : 'MEDIA_FFPROBE_BIN';
  const fromEnv = (process.env[envKey] ?? '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const scratchCandidate = path.join(SCRATCH_BIN_DIR, binName);
  if (fs.existsSync(scratchCandidate)) {
    return scratchCandidate;
  }
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const candidate = path.join(dir, binName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return binName;
}

function loadDotenvFileIfPresent(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const baseEnvVars = loadDotenvFileIfPresent(DOTENV_FILE);
const sandboxFileVars = loadDotenvFileIfPresent(SANDBOX_ENV_FILE);
const effectiveSandboxEnv: Record<string, string | undefined> = {
  ...baseEnvVars,
  ...sandboxFileVars,
  ...process.env,
};

const hasSandboxEnvConfigured = REQUIRED_R2_SANDBOX_ENV_VARS.every(
  (k) => (effectiveSandboxEnv[k] ?? '').trim() !== '',
);

/**
 * مزود R2 اختباري يستخدم R2StorageProvider الحقيقي و S3Client الحقيقي 100%،
 * مع فرض بادئة التشغيل المعزولة p6-live-<runId>/ على جميع المفاتيح وتعقب كل مفتاح أُنشئ.
 */
class NamespacedP6R2Provider extends R2StorageProvider {
  readonly createdRemoteKeys = new Set<string>();
  private rawS3Client: S3Client | null = null;

  constructor(
    config: VideoMediaConfig,
    private readonly sandboxCreds: R2Credentials & { endpoint: string },
    readonly runPrefix: string,
  ) {
    super(config);
  }

  toScopedKey(key: string): string {
    const clean = key.replace(/^\/+/, '');
    if (clean.startsWith(`${this.runPrefix}/`)) {
      return clean;
    }
    return `${this.runPrefix}/${clean}`;
  }

  assertUnderRunPrefix(scopedKey: string): void {
    if (!scopedKey.startsWith(`${this.runPrefix}/`)) {
      throw new Error(
        `SANDBOX_PREFIX_VIOLATION: المفتاح "${scopedKey}" خارج بادئة التشغيل "${this.runPrefix}/"`,
      );
    }
  }

  getRawClient(): S3Client {
    if (!this.rawS3Client) {
      this.rawS3Client = this.createClient(this.sandboxCreds);
    }
    return this.rawS3Client;
  }

  protected override createClient(creds: R2Credentials): S3Client {
    const client = super.createClient(creds);
    this.rawS3Client = client;
    return client;
  }

  override async uploadFromFile(
    localPath: string,
    key: string,
    options: UploadFromFileOptions,
  ): Promise<UploadResult> {
    const scoped = this.toScopedKey(key);
    this.assertUnderRunPrefix(scoped);
    this.createdRemoteKeys.add(scoped);
    return super.uploadFromFile(localPath, scoped, options);
  }

  override async copyObject(
    sourceKey: string,
    destinationKey: string,
    options: CopyObjectOptions = {},
  ): Promise<CopyObjectResult> {
    const scopedSrc = this.toScopedKey(sourceKey);
    const scopedDst = this.toScopedKey(destinationKey);
    this.assertUnderRunPrefix(scopedSrc);
    this.assertUnderRunPrefix(scopedDst);
    this.createdRemoteKeys.add(scopedDst);
    return super.copyObject(scopedSrc, scopedDst, options);
  }

  override async verifyStoredObjectSha256(
    key: string,
    expected: LocalFileDigest,
    options: TransferOptions = {},
  ): Promise<VerifyResult> {
    const scoped = this.toScopedKey(key);
    this.assertUnderRunPrefix(scoped);
    return super.verifyStoredObjectSha256(scoped, expected, options);
  }

  override async headObject(key: string): Promise<HeadOutcome> {
    const scoped = this.toScopedKey(key);
    this.assertUnderRunPrefix(scoped);
    return super.headObject(scoped);
  }

  override async getObjectStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<Readable> {
    const scoped = this.toScopedKey(key);
    this.assertUnderRunPrefix(scoped);
    return super.getObjectStream(scoped, range);
  }

  override async deleteObject(key: string): Promise<void> {
    const scoped = this.toScopedKey(key);
    this.assertUnderRunPrefix(scoped);
    return super.deleteObject(scoped);
  }

  override async getPresignedGetUrl(
    key: string,
    expiresInSec?: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    const scoped = this.toScopedKey(key);
    this.assertUnderRunPrefix(scoped);
    return super.getPresignedGetUrl(scoped, expiresInSec);
  }

  override onModuleDestroy(): void {
    super.onModuleDestroy();
    this.rawS3Client?.destroy();
    this.rawS3Client = null;
  }
}

const describeIfSandbox = hasSandboxEnvConfigured ? describe : describe.skip;

describeIfSandbox(
  'VIDEO P6 (Stage 3) — Multi-Tenant & Subscription Isolation Live Integration (P6-6.0 .. P6-6.4)',
  () => {
    const runTimestamp = formatCompactUtcTimestamp();
    const runShortRand = randomBytes(3).toString('hex');
    const runId = `${runTimestamp}-${runShortRand}`;
    const runPrefix = `p6-live-${runId}`;

    let tempLocalDir = '';
    let fixtureMp4Path = '';
    let jwtSecret = '';
    let baseUrl = '';

    let app: INestApplication;
    let prisma: PrismaService;
    let prismaRaw: PrismaService;
    let jwtService: JwtService;
    let videoConfig: VideoMediaConfig;
    let r2Provider: NamespacedP6R2Provider;
    let localProvider: LocalObjectStorageProvider;
    let storageRegistry: ObjectStorageRegistry;
    let storageService: StorageService;
    let diskSpaceGuard: DiskSpaceGuardService;
    let ffprobeService: FfprobeService;
    let accessPolicy: MediaAccessPolicyService;
    let mediaLifecycle: MediaLifecycleService;
    let queueService: MediaJobQueueService;
    let moveProcessor: MoveSourceProcessor;
    let transcodeProcessor: VideoTranscodeProcessor;
    let deleteProcessor: DeleteObjectsProcessor;
    let workerService: MediaWorkerService;
    let videoUploadService: VideoUploadService;
    let schoolUploadService: MediaUploadService;
    let platformUploadService: PlatformMediaUploadService;
    let subjectsService: SubjectsService;
    let platformLessonsService: PlatformLessonsService;

    // ── المعرفات الثابتة الموجودة مسبقاً في asas_dev (للقراءة فقط — لا تُعدّل ولا تُحذف أبداً) ──
    let schoolA: { id: number; uuid: string; schoolCode: number; name: string };
    let schoolB: { id: number; uuid: string; schoolCode: number; name: string };
    let teacherAUser: { id: number; uuid: string; name: string };
    let studentAUser: { id: number; uuid: string; name: string };
    let parentAUser: { id: number; uuid: string; phone: string; name: string };
    let teacherBUser: { id: number; uuid: string; name: string };
    let studentBUser: { id: number; uuid: string; name: string };
    let platformAdmin: { id: number; uuid: string; email: string };
    let subjectDict: {
      id: number;
      uuid: string;
      code: string;
      defaultName: string;
    };

    // ── السجلات المؤقتة المنشأة بواسطة هذا التشغيل فقط (تُنظّف بالكامل في afterAll) ──
    const createdCleanupRegistry = {
      authSessionIds: new Set<number>(),
      accessPeriodIds: new Set<number>(),
      parentStudentIds: new Set<number>(),
      studentUserIds: new Set<number>(),
      contentDistributionIds: new Set<number>(),
      lessonBlockItemIds: new Set<number>(),
      lessonContentBlockIds: new Set<number>(),
      lessonTemplateIds: new Set<number>(),
      unitIds: new Set<number>(),
      subjectSectionTeacherIds: new Set<number>(),
      subjectSectionIds: new Set<number>(),
      subjectIds: new Set<number>(),
      mediaAssetIds: new Set<number>(),
    };

    // ── بيانات جلسات الاختبار الحالية ──
    let studentA2User: { id: number; uuid: string; name: string };
    let jwtTeacherA = '';
    let jwtStudentA = '';
    let jwtStudentA2 = '';
    let jwtParentA = '';
    let jwtTeacherB = '';
    let jwtStudentB = '';

    let subjectA: { id: number; uuid: string };
    let subjectB: { id: number; uuid: string };
    let lessonTemplateA: { id: number; uuid: string };
    let blockA: { id: number; uuid: string };
    let lessonTemplateB: { id: number; uuid: string };
    let blockB: { id: number; uuid: string };

    let schoolVideoA: {
      id: number;
      uuid: string;
      storageKey: string;
    };

    const p66Metrics: Record<string, any> = {
      runId,
      runPrefix: `${runPrefix}/`,
      startedAtUtc: new Date().toISOString(),
      environment: {},
      preflight: {},
      tests: {},
      cleanup: {},
    };

    async function drainWorkerUntilIdle(maxTicks = 25): Promise<number> {
      let ticks = 0;
      for (let i = 0; i < maxTicks; i++) {
        ticks++;
        await workerService.processNextJobOnce();
        const activeCount = await prisma.mediaProcessingJob.count({
          where: {
            mediaAssetId: {
              in: Array.from(createdCleanupRegistry.mediaAssetIds),
            },
            status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] },
          },
        });
        if (activeCount === 0) break;
      }
      return ticks;
    }

    async function httpRequest(
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      routePath: string,
      options: {
        token?: string;
        schoolUuid?: string;
        headers?: Record<string, string>;
        body?: unknown;
      } = {},
    ): Promise<{
      status: number;
      body: any;
      rawText: string;
    }> {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(options.headers ?? {}),
      };
      if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
      }
      if (options.schoolUuid) {
        headers['x-school-uuid'] = options.schoolUuid;
      }
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(`${baseUrl}${routePath}`, {
        method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const rawText = await res.text();
      let parsed: any = rawText;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = rawText;
      }
      return {
        status: res.status,
        body: parsed,
        rawText,
      };
    }

    async function createSignedSchoolJwt(params: {
      userId: number;
      userUuid: string;
      userType: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
      schoolId: number;
      schoolUuid: string;
    }): Promise<string> {
      const session = await prisma.authSession.create({
        data: {
          userId: params.userId,
          schoolId: params.schoolId,
          refreshTokenHash: `p66-rt-${runId}-${params.userId}-${randomBytes(6).toString('hex')}`,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      });
      createdCleanupRegistry.authSessionIds.add(session.id);

      return jwtService.sign(
        {
          sub: params.userUuid,
          ut: params.userType,
          sc: params.schoolUuid,
          sid: session.uuid,
        },
        {
          secret: jwtSecret,
          issuer: SCHOOL_AUTH_JWT.issuer,
          audience: SCHOOL_AUTH_JWT.audience,
          expiresIn: '1h',
        },
      );
    }

    async function uploadAndTranscodeSchoolVideo(
      schoolId: number,
      schoolUuid: string,
      teacherUserId: number,
      filePath: string,
    ): Promise<{
      id: number;
      uuid: string;
      storageKey: string;
      ticks: number;
    }> {
      const fileBuf = await fsp.readFile(filePath);

      const initRes = await schoolUploadService.initSession(
        {
          kind: MediaKind.VIDEO,
          filename: 'p6-6-school-a-lesson.mp4',
          totalSizeBytes: fileBuf.length,
          contentType: 'video/mp4',
        } as any,
        schoolId,
        schoolUuid,
        { userId: teacherUserId, role: 'TEACHER' },
      );

      const chunkSize = initRes.chunk_size_bytes || 1_048_576;
      for (let offset = 0; offset < fileBuf.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, fileBuf.length) - 1;
        const chunk = fileBuf.subarray(offset, end + 1);
        await schoolUploadService.uploadChunk(
          initRes.upload_session_uuid,
          schoolId,
          `bytes ${offset}-${end}/${fileBuf.length}`,
          chunk,
          teacherUserId,
        );
      }

      const completeRes = await schoolUploadService.completeSession(
        initRes.upload_session_uuid,
        schoolId,
        schoolUuid,
        teacherUserId,
      );
      const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
        where: { uuid: completeRes.media_asset_uuid },
      });
      createdCleanupRegistry.mediaAssetIds.add(assetRow.id);

      const ticks = await drainWorkerUntilIdle(25);

      const readyAsset = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: assetRow.id },
      });
      expect(readyAsset.processingStatus).toBe(ProcessingStatus.DONE);
      expect(readyAsset.storageKey).toBeTruthy();

      return {
        id: readyAsset.id,
        uuid: readyAsset.uuid,
        storageKey: readyAsset.storageKey!,
        ticks,
      };
    }

    async function uploadAndTranscodePlatformVideo(
      platformUserId: number,
      filePath: string,
    ): Promise<{
      id: number;
      uuid: string;
      storageKey: string;
      ticks: number;
    }> {
      const fileBuf = await fsp.readFile(filePath);
      const platformActor = {
        platformUserId,
        role: PlatformRole.PLATFORM_ADMIN,
      };

      const initRes = await platformUploadService.initSession(
        {
          kind: MediaKind.VIDEO,
          filename: 'p6-6-platform-shared.mp4',
          totalSizeBytes: fileBuf.length,
          contentType: 'video/mp4',
        } as any,
        platformActor,
      );

      const chunkSize = initRes.chunk_size_bytes || 1_048_576;
      for (let offset = 0; offset < fileBuf.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, fileBuf.length) - 1;
        const chunk = fileBuf.subarray(offset, end + 1);
        await platformUploadService.uploadChunk(
          initRes.upload_session_uuid,
          `bytes ${offset}-${end}/${fileBuf.length}`,
          chunk,
          platformActor,
        );
      }

      const completeRes = await platformUploadService.completeSession(
        initRes.upload_session_uuid,
        platformActor,
      );
      const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
        where: { uuid: completeRes.media_asset_uuid },
      });
      createdCleanupRegistry.mediaAssetIds.add(assetRow.id);

      const ticks = await drainWorkerUntilIdle(25);

      const readyAsset = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: assetRow.id },
      });
      expect(readyAsset.processingStatus).toBe(ProcessingStatus.DONE);
      expect(readyAsset.storageKey).toBeTruthy();

      return {
        id: readyAsset.id,
        uuid: readyAsset.uuid,
        storageKey: readyAsset.storageKey!,
        ticks,
      };
    }

    beforeAll(async () => {
      // 1. فحص أمان متغيرات بيئة R2 الساندبوكس
      for (const prodKey of AMBIENT_PROD_R2_ENV_VARS) {
        delete process.env[prodKey];
        delete effectiveSandboxEnv[prodKey];
      }
      const sandboxCreds = assertSafeR2SandboxEnvironment(effectiveSandboxEnv);

      const ffmpegBin = resolveRealBinary('ffmpeg');
      const ffprobeBin = resolveRealBinary('ffprobe');
      process.env.MEDIA_FFMPEG_BIN = ffmpegBin;
      process.env.MEDIA_FFPROBE_BIN = ffprobeBin;

      tempLocalDir = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'asas-p6-6-local-'),
      );
      process.env.MEDIA_STORAGE_PATH = tempLocalDir;
      process.env.MEDIA_TMP_MIN_FREE_BYTES = '100000000';
      process.env.MEDIA_VIDEO_TRANSCODE_SCRATCH_BYTES = '50000000';
      process.env.MEDIA_WORKER_MIN_FREE_BYTES = '100000000';
      process.env.MEDIA_WORKER_LIVE_MIN_FREE_BYTES = '50000000';
      process.env.MEDIA_TEMP_DIR = path.join(tempLocalDir, 'media-tmp');
      process.env.UPLOAD_DIR = path.join(tempLocalDir, 'uploads');
      await fsp.mkdir(path.join(tempLocalDir, 'tmp'), { recursive: true });
      await fsp.mkdir(process.env.MEDIA_TEMP_DIR, { recursive: true });
      await fsp.mkdir(process.env.UPLOAD_DIR, { recursive: true });

      jwtSecret =
        (effectiveSandboxEnv.JWT_SECRET ?? '').trim() ||
        'p6-6-staging-integration-jwt-secret';
      process.env.JWT_SECRET = jwtSecret;

      // 2. الاتصال بقاعدة البيانات المحلية asas_dev والتحقق الصارم من هويتها
      const dbUrl =
        (effectiveSandboxEnv.DATABASE_URL ?? '').trim() ||
        `postgresql://${process.env.PGUSER || process.env.USER || 'postgres'}@localhost:5432/asas_dev`;
      const lowerUrl = dbUrl.toLowerCase();
      if (lowerUrl.includes('prod') || lowerUrl.includes('staging')) {
        throw new Error(
          `SAFETY VIOLATION: DATABASE_URL points to protected environment: ${dbUrl}`,
        );
      }

      prisma = new PrismaService({ datasourceUrl: dbUrl } as any);
      await prisma.onModuleInit();
      prismaRaw = new PrismaService({ datasourceUrl: dbUrl } as any);
      await prismaRaw.$connect();

      const dbRows: Array<{ db: string }> = await prisma.$queryRawUnsafe(
        'SELECT current_database() AS db',
      );
      const currentDb = dbRows[0]?.db ?? '';
      if (currentDb !== 'asas_dev') {
        throw new Error(
          `SAFETY VIOLATION: expected current_database() === 'asas_dev', got "${currentDb}"`,
        );
      }

      // 3. التحقق من وجود بيانات الأساس في asas_dev (دون أي تعديل عليها)
      schoolA = await prisma.school.findUniqueOrThrow({
        where: { schoolCode: 99001 },
        select: { id: true, uuid: true, schoolCode: true, name: true },
      });
      schoolB = await prisma.school.findUniqueOrThrow({
        where: { schoolCode: 99002 },
        select: { id: true, uuid: true, schoolCode: true, name: true },
      });

      const subSettingsA =
        await prisma.schoolSubscriptionSettings.findUniqueOrThrow({
          where: { schoolId: schoolA.id },
        });
      expect(subSettingsA.isActivated).toBe(true);

      teacherAUser = await prisma.user.findFirstOrThrow({
        where: {
          schoolId: schoolA.id,
          userType: 'TEACHER',
          isDeleted: false,
          isActive: true,
        },
        orderBy: { id: 'asc' },
        select: { id: true, uuid: true, name: true },
      });
      studentAUser = await prisma.user.findFirstOrThrow({
        where: {
          id: 4,
          schoolId: schoolA.id,
          userType: 'STUDENT',
          isDeleted: false,
          isActive: true,
        },
        select: { id: true, uuid: true, name: true },
      });
      const rawParentA = await prisma.user.findFirstOrThrow({
        where: {
          schoolId: schoolA.id,
          userType: 'PARENT',
          phone: '777000001',
          isDeleted: false,
          isActive: true,
        },
        select: { id: true, uuid: true, phone: true, name: true },
      });
      parentAUser = {
        id: rawParentA.id,
        uuid: rawParentA.uuid,
        phone: rawParentA.phone ?? '777000001',
        name: rawParentA.name,
      };

      teacherBUser = await prisma.user.findFirstOrThrow({
        where: {
          schoolId: schoolB.id,
          userType: 'TEACHER',
          isDeleted: false,
          isActive: true,
        },
        orderBy: { id: 'asc' },
        select: { id: true, uuid: true, name: true },
      });
      studentBUser = await prisma.user.findFirstOrThrow({
        where: {
          schoolId: schoolB.id,
          userType: 'STUDENT',
          isDeleted: false,
          isActive: true,
        },
        orderBy: { id: 'asc' },
        select: { id: true, uuid: true, name: true },
      });
      platformAdmin = await prisma.platformUser.findFirstOrThrow({
        where: { role: 'PLATFORM_ADMIN', isDeleted: false, isActive: true },
        orderBy: { id: 'asc' },
        select: { id: true, uuid: true, email: true },
      });
      const rawDict = await prisma.subjectDictionary.findFirstOrThrow({
        where: { code: 'B01-IS', isDeleted: false },
        select: { id: true, uuid: true, code: true, defaultName: true },
      });
      subjectDict = {
        id: rawDict.id,
        uuid: rawDict.uuid,
        code: rawDict.code ?? 'B01-IS',
        defaultName: rawDict.defaultName,
      };

      // 4. تجهيز خدمات التخزين والمعالجة والـ Worker
      videoConfig = new VideoMediaConfig();
      jest.spyOn(videoConfig, 'isUploadEnabled', 'get').mockReturnValue(true);
      jest.spyOn(videoConfig, 'getR2Credentials').mockReturnValue({
        accountId: sandboxCreds.accountId,
        accessKeyId: sandboxCreds.accessKeyId,
        secretAccessKey: sandboxCreds.secretAccessKey,
        bucketName: sandboxCreds.bucketName,
      });

      r2Provider = new NamespacedP6R2Provider(
        videoConfig,
        sandboxCreds,
        runPrefix,
      );
      storageService = new StorageService();
      localProvider = new LocalObjectStorageProvider(storageService);
      storageRegistry = new ObjectStorageRegistry(localProvider, r2Provider);
      accessPolicy = new MediaAccessPolicyService(prisma);
      mediaLifecycle = new MediaLifecycleService(accessPolicy);
      ffprobeService = new FfprobeService(videoConfig);
      const uploadValidation = new UploadValidationHelper(videoConfig);
      diskSpaceGuard = new DiskSpaceGuardService(prismaRaw);
      videoUploadService = new VideoUploadService(
        prisma,
        storageService,
        videoConfig,
        diskSpaceGuard,
        ffprobeService,
        uploadValidation,
      );
      const dummyProcessing = {
        processAsset: jest.fn().mockResolvedValue(undefined),
      } as any;

      schoolUploadService = new MediaUploadService(
        prisma,
        storageService,
        dummyProcessing,
        videoUploadService,
        uploadValidation,
        accessPolicy,
      );
      platformUploadService = new PlatformMediaUploadService(
        prisma,
        storageService,
        dummyProcessing,
        videoUploadService,
        uploadValidation,
        accessPolicy,
      );

      queueService = new MediaJobQueueService(prisma, videoConfig);
      transcodeProcessor = new VideoTranscodeProcessor(
        prisma,
        videoConfig,
        storageService,
        storageRegistry,
        ffprobeService,
        queueService,
      );
      moveProcessor = new MoveSourceProcessor(
        prisma,
        videoConfig,
        storageRegistry,
        queueService,
      );
      deleteProcessor = new DeleteObjectsProcessor(
        prisma,
        videoConfig,
        storageService,
        storageRegistry,
        queueService,
        mediaLifecycle,
      );
      workerService = new MediaWorkerService(
        videoConfig,
        queueService,
        transcodeProcessor,
        moveProcessor,
        storageRegistry,
        deleteProcessor,
      );
      subjectsService = new SubjectsService(prisma);
      platformLessonsService = new PlatformLessonsService(
        prisma,
        mediaLifecycle,
        accessPolicy,
      );

      // 5. تشغيل تطبيق NestJS HTTP حقيقي مع الحراس الفعلية
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'school-jwt' }),
          ThrottlerModule.forRoot([
            { name: 'short', ttl: 60000, limit: 200 },
            { name: 'long', ttl: 3600000, limit: 1000 },
          ]),
        ],
        controllers: [
          MediaController,
          TeacherLessonsController,
          PlatformContentController,
          StudentSubscriptionController,
        ],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: StorageService, useValue: storageService },
          { provide: VideoMediaConfig, useValue: videoConfig },
          { provide: R2StorageProvider, useValue: r2Provider },
          { provide: MediaAccessPolicyService, useValue: accessPolicy },
          { provide: MediaLifecycleService, useValue: mediaLifecycle },
          MediaService,
          TeacherLessonsService,
          PlatformContentService,
          {
            provide: StudentSubscriptionService,
            useFactory: () =>
              new StudentSubscriptionService(prisma, {} as any, {} as any),
          },
          SchoolJwtStrategy,
          SchoolJwtAuthGuard,
          SchoolContextGuard,
          ParentStudentContextGuard,
          RolesGuard,
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      await app.listen(0, '127.0.0.1');
      baseUrl = await app.getUrl();
      jwtService = new JwtService({ secret: jwtSecret });

      // 6. توليد ملف فيديو MP4 حقيقي صالح (720p، 2 ثانية، H.264 + AAC)
      fixtureMp4Path = path.join(tempLocalDir, 'fixture-p6-6-720p.mp4');
      await execFileAsync(ffmpegBin, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=1280x720:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        fixtureMp4Path,
      ]);

      p66Metrics.environment = {
        currentDatabase: currentDb,
        baseUrl,
        r2Bucket: sandboxCreds.bucketName,
        r2Endpoint: sandboxCreds.endpoint,
        runPrefix: `${runPrefix}/`,
        schools: { schoolA, schoolB },
        existingUsers: {
          teacherAUser,
          studentAUser,
          parentAUser,
          teacherBUser,
          studentBUser,
          platformAdmin,
        },
      };
    });

    afterAll(async () => {
      const cleanupSummary: Record<string, any> = {
        r2DeletedKeys: [],
        r2Verified404Count: 0,
        dbDeletedCounts: {},
      };

      try {
        // 1. حذف أي مفاتيح متبقية على R2 تحت البادئة المعزولة p6-live-<runId>/ والتحقق من 404
        const allTrackedKeys = Array.from(r2Provider?.createdRemoteKeys ?? []);
        for (const scopedKey of allTrackedKeys) {
          r2Provider.assertUnderRunPrefix(scopedKey);
          await r2Provider.deleteObject(scopedKey).catch(() => undefined);
          cleanupSummary.r2DeletedKeys.push(scopedKey);
        }

        for (const scopedKey of allTrackedKeys) {
          const headRes = await r2Provider.headObject(scopedKey);
          if (headRes.kind === 'NOT_FOUND') {
            cleanupSummary.r2Verified404Count++;
          }
        }

        // 2. حذف السجلات المؤقتة التي أنشأها هذا التشغيل فقط بترتيب العلاقات العكسية
        if (prisma) {
          if (createdCleanupRegistry.contentDistributionIds.size > 0) {
            const res = await prisma.contentDistribution.deleteMany({
              where: {
                id: {
                  in: Array.from(createdCleanupRegistry.contentDistributionIds),
                },
              },
            });
            cleanupSummary.dbDeletedCounts.contentDistributions = res.count;
          }

          if (createdCleanupRegistry.lessonTemplateIds.size > 0) {
            const tplIds = Array.from(createdCleanupRegistry.lessonTemplateIds);
            const itemsDel = await prisma.lessonBlockItem.deleteMany({
              where: {
                OR: [
                  {
                    id: {
                      in: Array.from(createdCleanupRegistry.lessonBlockItemIds),
                    },
                  },
                  { block: { templateId: { in: tplIds } } },
                ],
              },
            });
            cleanupSummary.dbDeletedCounts.lessonBlockItems = itemsDel.count;

            const blocksDel = await prisma.lessonContentBlock.deleteMany({
              where: {
                OR: [
                  {
                    id: {
                      in: Array.from(
                        createdCleanupRegistry.lessonContentBlockIds,
                      ),
                    },
                  },
                  { templateId: { in: tplIds } },
                ],
              },
            });
            cleanupSummary.dbDeletedCounts.lessonContentBlocks =
              blocksDel.count;

            // فك ارتباط sourceTemplateId قبل حذف القوالب
            await prisma.lessonTemplate.updateMany({
              where: { id: { in: tplIds } },
              data: { sourceTemplateId: null },
            });
            const tplDel = await prisma.lessonTemplate.deleteMany({
              where: { id: { in: tplIds } },
            });
            cleanupSummary.dbDeletedCounts.lessonTemplates = tplDel.count;
          }

          if (createdCleanupRegistry.unitIds.size > 0) {
            // حذف أي وحدات أنشأها forkLesson تلقائياً تحت المواد المؤقتة أيضاً
            const subjectIds = Array.from(createdCleanupRegistry.subjectIds);
            const unitsDel = await prisma.unit.deleteMany({
              where: {
                OR: [
                  { id: { in: Array.from(createdCleanupRegistry.unitIds) } },
                  ...(subjectIds.length > 0
                    ? [{ subjectId: { in: subjectIds } }]
                    : []),
                ],
              },
            });
            cleanupSummary.dbDeletedCounts.units = unitsDel.count;
          }

          if (createdCleanupRegistry.subjectSectionTeacherIds.size > 0) {
            const sstDel = await prisma.subjectSectionTeacher.deleteMany({
              where: {
                id: {
                  in: Array.from(
                    createdCleanupRegistry.subjectSectionTeacherIds,
                  ),
                },
              },
            });
            cleanupSummary.dbDeletedCounts.subjectSectionTeachers =
              sstDel.count;
          }

          if (createdCleanupRegistry.subjectSectionIds.size > 0) {
            const ssDel = await prisma.subjectSection.deleteMany({
              where: {
                id: {
                  in: Array.from(createdCleanupRegistry.subjectSectionIds),
                },
              },
            });
            cleanupSummary.dbDeletedCounts.subjectSections = ssDel.count;
          }

          if (createdCleanupRegistry.subjectIds.size > 0) {
            const subDel = await prisma.subject.deleteMany({
              where: {
                id: { in: Array.from(createdCleanupRegistry.subjectIds) },
              },
            });
            cleanupSummary.dbDeletedCounts.subjects = subDel.count;
          }

          if (createdCleanupRegistry.mediaAssetIds.size > 0) {
            const assetIds = Array.from(createdCleanupRegistry.mediaAssetIds);
            await prisma.mediaProcessingJob.deleteMany({
              where: { mediaAssetId: { in: assetIds } },
            });
            await prisma.mediaUploadSession.deleteMany({
              where: { mediaAssetId: { in: assetIds } },
            });
            const assetsDel = await prisma.mediaAsset.deleteMany({
              where: { id: { in: assetIds } },
            });
            cleanupSummary.dbDeletedCounts.mediaAssets = assetsDel.count;
          }

          if (createdCleanupRegistry.parentStudentIds.size > 0) {
            const psDel = await prisma.parentStudent.deleteMany({
              where: {
                id: { in: Array.from(createdCleanupRegistry.parentStudentIds) },
              },
            });
            cleanupSummary.dbDeletedCounts.parentStudents = psDel.count;
          }

          if (createdCleanupRegistry.accessPeriodIds.size > 0) {
            const apDel = await prisma.studentAccessPeriod.deleteMany({
              where: {
                id: { in: Array.from(createdCleanupRegistry.accessPeriodIds) },
              },
            });
            cleanupSummary.dbDeletedCounts.studentAccessPeriods = apDel.count;
          }

          if (createdCleanupRegistry.authSessionIds.size > 0) {
            const asDel = await prisma.authSession.deleteMany({
              where: {
                id: { in: Array.from(createdCleanupRegistry.authSessionIds) },
              },
            });
            cleanupSummary.dbDeletedCounts.authSessions = asDel.count;
          }

          if (createdCleanupRegistry.studentUserIds.size > 0) {
            const stuIds = Array.from(createdCleanupRegistry.studentUserIds);
            await prisma.student.deleteMany({
              where: { userId: { in: stuIds } },
            });
            const uDel = await prisma.user.deleteMany({
              where: { id: { in: stuIds } },
            });
            cleanupSummary.dbDeletedCounts.tempStudentUsers = uDel.count;
          }
        }
      } finally {
        p66Metrics.cleanup = cleanupSummary;
        p66Metrics.completedAtUtc = new Date().toISOString();
        await fsp
          .writeFile(
            '/tmp/p6-6-metrics.json',
            JSON.stringify(p66Metrics, null, 2),
            'utf8',
          )
          .catch(() => undefined);

        await app?.close().catch(() => undefined);
        await prismaRaw?.$disconnect().catch(() => undefined);
        await prisma?.$disconnect().catch(() => undefined);
        if (tempLocalDir && fs.existsSync(tempLocalDir)) {
          await fsp
            .rm(tempLocalDir, { recursive: true, force: true })
            .catch(() => undefined);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // P6-6.0 — Pre-Flight Gate & Test Fixtures Setup in asas_dev
    // ═══════════════════════════════════════════════════════════════
    it('P6-6.0 (Pre-Flight Gate & Setup): يتحقق من بوابة R2 وقاعدة asas_dev ويجهز السجلات المؤقتة المعزولة وفيديو المدرسة 99001', async () => {
      const t0 = Date.now();

      // 1. فحص Pre-Flight لبادئة R2 وإثبات رفض أي مفتاح خارج البادئة
      expect(runPrefix).toMatch(/^p6-live-\d{8}T\d{6}Z-[a-f0-9]{6}$/);
      expect(() =>
        r2Provider.assertUnderRunPrefix('school/1/videos/unscoped/360p.mp4'),
      ).toThrow(/SANDBOX_PREFIX_VIOLATION/);

      const rawClient = r2Provider.getRawClient();
      const headBucketRes = await rawClient.send(
        new HeadBucketCommand({ Bucket: 'asas-media-poc' }),
      );
      expect(headBucketRes.$metadata.httpStatusCode).toBe(200);

      // 2. تجهيز السجلات المؤقتة في asas_dev:
      //    - فترة اشتراك نشطة للطالب الموجود student-a (id=4)
      //    - حساب طالب ثانٍ student-a2 في المدرسة 99001 مع فترة اشتراك منتهية
      //    - ربط ولي الأمر 777000001 (id=5) بكلا الابنين (student-a و student-a2)
      const now = new Date();
      const activePeriodA = await prisma.studentAccessPeriod.create({
        data: {
          schoolId: schoolA.id,
          studentUserId: studentAUser.id,
          periodType: 'TRIAL' as any,
          startedAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000),
          expiresAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
        },
      });
      createdCleanupRegistry.accessPeriodIds.add(activePeriodA.id);

      const createdStudentA2 = await prisma.user.create({
        data: {
          schoolId: schoolA.id,
          userType: 'STUDENT',
          name: `student-a2 (${runId})`,
          passwordHash: 'p6-6-temp-hash',
          isActive: true,
        },
      });
      createdCleanupRegistry.studentUserIds.add(createdStudentA2.id);
      await prisma.student.create({
        data: { userId: createdStudentA2.id },
      });
      studentA2User = {
        id: createdStudentA2.id,
        uuid: createdStudentA2.uuid,
        name: createdStudentA2.name,
      };

      const expiredPeriodA2 = await prisma.studentAccessPeriod.create({
        data: {
          schoolId: schoolA.id,
          studentUserId: studentA2User.id,
          periodType: 'TRIAL' as any,
          startedAt: new Date(now.getTime() - 14 * 24 * 3600 * 1000),
          expiresAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000), // منتهٍ قبل يومين
        },
      });
      createdCleanupRegistry.accessPeriodIds.add(expiredPeriodA2.id);

      const linkChildA = await prisma.parentStudent.create({
        data: {
          parentId: parentAUser.id,
          studentId: studentAUser.id,
        },
      });
      createdCleanupRegistry.parentStudentIds.add(linkChildA.id);

      const linkChildA2 = await prisma.parentStudent.create({
        data: {
          parentId: parentAUser.id,
          studentId: studentA2User.id,
        },
      });
      createdCleanupRegistry.parentStudentIds.add(linkChildA2.id);

      // 3. إصدار توكنات JWT حقيقية موقعة مع جلسات AuthSession حقيقية في asas_dev
      jwtTeacherA = await createSignedSchoolJwt({
        userId: teacherAUser.id,
        userUuid: teacherAUser.uuid,
        userType: 'TEACHER',
        schoolId: schoolA.id,
        schoolUuid: schoolA.uuid,
      });
      jwtStudentA = await createSignedSchoolJwt({
        userId: studentAUser.id,
        userUuid: studentAUser.uuid,
        userType: 'STUDENT',
        schoolId: schoolA.id,
        schoolUuid: schoolA.uuid,
      });
      jwtStudentA2 = await createSignedSchoolJwt({
        userId: studentA2User.id,
        userUuid: studentA2User.uuid,
        userType: 'STUDENT',
        schoolId: schoolA.id,
        schoolUuid: schoolA.uuid,
      });
      jwtParentA = await createSignedSchoolJwt({
        userId: parentAUser.id,
        userUuid: parentAUser.uuid,
        userType: 'PARENT',
        schoolId: schoolA.id,
        schoolUuid: schoolA.uuid,
      });
      jwtTeacherB = await createSignedSchoolJwt({
        userId: teacherBUser.id,
        userUuid: teacherBUser.uuid,
        userType: 'TEACHER',
        schoolId: schoolB.id,
        schoolUuid: schoolB.uuid,
      });
      jwtStudentB = await createSignedSchoolJwt({
        userId: studentBUser.id,
        userUuid: studentBUser.uuid,
        userType: 'STUDENT',
        schoolId: schoolB.id,
        schoolUuid: schoolB.uuid,
      });

      // 4. تجهيز مادة + شعبة + إسناد معلم + وحدة + درس + فقرة في كلتا المدرستين 99001 و 99002
      const gradeA = await prisma.schoolGrade.findFirstOrThrow({
        where: { schoolId: schoolA.id, isDeleted: false },
        orderBy: { id: 'asc' },
      });
      const sectionA = await prisma.section.findFirstOrThrow({
        where: { gradeId: gradeA.id, isDeleted: false },
        orderBy: { id: 'asc' },
      });
      const gradeB = await prisma.schoolGrade.findFirstOrThrow({
        where: { schoolId: schoolB.id, isDeleted: false },
        orderBy: { id: 'asc' },
      });
      const sectionB = await prisma.section.findFirstOrThrow({
        where: { gradeId: gradeB.id, isDeleted: false },
        orderBy: { id: 'asc' },
      });

      const createdSubA = await prisma.subject.create({
        data: {
          schoolId: schoolA.id,
          gradeId: gradeA.id,
          dictionaryId: subjectDict.id,
          displayName: `التربية الإسلامية P6-6 (${runId})`,
        },
      });
      createdCleanupRegistry.subjectIds.add(createdSubA.id);
      subjectA = { id: createdSubA.id, uuid: createdSubA.uuid };

      const ssA = await prisma.subjectSection.create({
        data: { subjectId: subjectA.id, sectionId: sectionA.id },
      });
      createdCleanupRegistry.subjectSectionIds.add(ssA.id);
      const sstA = await prisma.subjectSectionTeacher.create({
        data: { subjectSectionId: ssA.id, teacherId: teacherAUser.id },
      });
      createdCleanupRegistry.subjectSectionTeacherIds.add(sstA.id);

      const unitA = await prisma.unit.create({
        data: {
          schoolId: schoolA.id,
          subjectId: subjectA.id,
          title: `وحدة اختبار P6-6 أ (${runId})`,
          orderIndex: 1,
        },
      });
      createdCleanupRegistry.unitIds.add(unitA.id);

      const tplA = await prisma.lessonTemplate.create({
        data: {
          ownerType: 'SCHOOL',
          schoolId: schoolA.id,
          subjectId: subjectA.id,
          unitId: unitA.id,
          title: `درس المدرسة 99001 (${runId})`,
          orderIndex: 1,
          status: 'DRAFT',
          createdByUserId: teacherAUser.id,
        },
      });
      createdCleanupRegistry.lessonTemplateIds.add(tplA.id);
      lessonTemplateA = { id: tplA.id, uuid: tplA.uuid };

      const blkA = await prisma.lessonContentBlock.create({
        data: {
          templateId: tplA.id,
          title: 'الفقرة الأولى - مدرسة أ',
          orderIndex: 1,
        },
      });
      createdCleanupRegistry.lessonContentBlockIds.add(blkA.id);
      blockA = { id: blkA.id, uuid: blkA.uuid };

      // المدرسة 99002
      const createdSubB = await prisma.subject.create({
        data: {
          schoolId: schoolB.id,
          gradeId: gradeB.id,
          dictionaryId: subjectDict.id,
          displayName: `التربية الإسلامية P6-6 ب (${runId})`,
        },
      });
      createdCleanupRegistry.subjectIds.add(createdSubB.id);
      subjectB = { id: createdSubB.id, uuid: createdSubB.uuid };

      const ssB = await prisma.subjectSection.create({
        data: { subjectId: subjectB.id, sectionId: sectionB.id },
      });
      createdCleanupRegistry.subjectSectionIds.add(ssB.id);
      const sstB = await prisma.subjectSectionTeacher.create({
        data: { subjectSectionId: ssB.id, teacherId: teacherBUser.id },
      });
      createdCleanupRegistry.subjectSectionTeacherIds.add(sstB.id);

      const unitB = await prisma.unit.create({
        data: {
          schoolId: schoolB.id,
          subjectId: subjectB.id,
          title: `وحدة اختبار P6-6 ب (${runId})`,
          orderIndex: 1,
        },
      });
      createdCleanupRegistry.unitIds.add(unitB.id);

      const tplB = await prisma.lessonTemplate.create({
        data: {
          ownerType: 'SCHOOL',
          schoolId: schoolB.id,
          subjectId: subjectB.id,
          unitId: unitB.id,
          title: `درس المدرسة 99002 (${runId})`,
          orderIndex: 1,
          status: 'DRAFT',
          createdByUserId: teacherBUser.id,
        },
      });
      createdCleanupRegistry.lessonTemplateIds.add(tplB.id);
      lessonTemplateB = { id: tplB.id, uuid: tplB.uuid };

      const blkB = await prisma.lessonContentBlock.create({
        data: {
          templateId: tplB.id,
          title: 'الفقرة الأولى - مدرسة ب',
          orderIndex: 1,
        },
      });
      createdCleanupRegistry.lessonContentBlockIds.add(blkB.id);
      blockB = { id: blkB.id, uuid: blkB.uuid };

      // 5. رفع وتحويل فيديو حقيقي للمدرسة 99001 على R2 وربطه عبر نقطة API الحقيقية لمعلم 99001
      schoolVideoA = await uploadAndTranscodeSchoolVideo(
        schoolA.id,
        schoolA.uuid,
        teacherAUser.id,
        fixtureMp4Path,
      );

      const linkInSchoolARes = await httpRequest(
        'POST',
        `/school/teacher/lessons/${lessonTemplateA.uuid}/blocks/${blockA.uuid}/items`,
        {
          token: jwtTeacherA,
          schoolUuid: schoolA.uuid,
          body: {
            itemType: 'VIDEO',
            orderIndex: 1,
            mediaAssetUuid: schoolVideoA.uuid,
            caption: 'فيديو خاص بالمدرسة 99001',
          },
        },
      );
      expect(linkInSchoolARes.status).toBe(201);
      expect(linkInSchoolARes.body.mediaAssetUuid).toBe(schoolVideoA.uuid);

      p66Metrics.preflight = {
        status: 'PASS',
        durationMs: Date.now() - t0,
        r2HeadBucketStatus: headBucketRes.$metadata.httpStatusCode,
        schoolVideoA,
        linkInSchoolAStatus: linkInSchoolARes.status,
        linkInSchoolABody: linkInSchoolARes.body,
        tempFixtures: {
          studentA2User,
          activePeriodAId: activePeriodA.id,
          expiredPeriodA2Id: expiredPeriodA2.id,
          linkChildAId: linkChildA.id,
          linkChildA2Id: linkChildA2.id,
        },
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // P6-6.1 — Cross-Tenant Isolation (S4 & W-061 via Real HTTP API & Guards)
    // ═══════════════════════════════════════════════════════════════
    it('P6-6.1 (Cross-Tenant Isolation): يرفض جميع محاولات القراءة والربط من معلم وطالب المدرسة 99002 على فيديو المدرسة 99001 عبر نقاط API والحراس الفعلية', async () => {
      const t0 = Date.now();

      // 1. محاولات القراءة بتوكن معلم المدرسة 99002 (teacherB)
      const teacherBStatusRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/status`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      const teacherBDownloadUrlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      const teacherBMetaRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/meta`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      const teacherBDirectDownloadRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );

      expect(teacherBStatusRes.status).toBe(404);
      expect(teacherBStatusRes.body.error).toBe('ASSET_NOT_FOUND');
      expect(teacherBDownloadUrlRes.status).toBe(404);
      expect(teacherBDownloadUrlRes.body.error).toBe('ASSET_NOT_FOUND');
      expect(teacherBMetaRes.status).toBe(404);
      expect(teacherBMetaRes.body.error).toBe('ASSET_NOT_FOUND');
      // S4-T2: يعيد 404 ASSET_NOT_FOUND قبل 409 USE_DOWNLOAD_URL حتى لا يكشف وجود أصل R2 في مدرسة أخرى
      expect(teacherBDirectDownloadRes.status).toBe(404);
      expect(teacherBDirectDownloadRes.body.error).toBe('ASSET_NOT_FOUND');

      // 2. محاولات القراءة بتوكن طالب المدرسة 99002 (studentB)
      const studentBStatusRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/status`,
        { token: jwtStudentB, schoolUuid: schoolB.uuid },
      );
      const studentBDownloadUrlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=360p`,
        { token: jwtStudentB, schoolUuid: schoolB.uuid },
      );
      const studentBDirectDownloadRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}`,
        { token: jwtStudentB, schoolUuid: schoolB.uuid },
      );

      expect(studentBStatusRes.status).toBe(404);
      expect(studentBStatusRes.body.error).toBe('ASSET_NOT_FOUND');
      expect(studentBDownloadUrlRes.status).toBe(404);
      expect(studentBDownloadUrlRes.body.error).toBe('ASSET_NOT_FOUND');
      expect(studentBDirectDownloadRes.status).toBe(404);
      expect(studentBDirectDownloadRes.body.error).toBe('ASSET_NOT_FOUND');

      // 3. محاولة تزوير رأس المدرسة (x-school-uuid = 99001 مع توكن معلم 99002) -> SchoolContextGuard يرفض بـ 403 SCHOOL_SCOPE_MISMATCH
      const headerTamperRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        { token: jwtTeacherB, schoolUuid: schoolA.uuid },
      );
      expect(headerTamperRes.status).toBe(403);
      expect(JSON.stringify(headerTamperRes.body)).toContain(
        'SCHOOL_SCOPE_MISMATCH',
      );

      // 4. محاولة ربط فيديو المدرسة 99001 بفقرة درس في المدرسة 99002 عبر POST /school/teacher/lessons/:lessonUuidB/blocks/:blockUuidB/items
      const crossTenantLinkRes = await httpRequest(
        'POST',
        `/school/teacher/lessons/${lessonTemplateB.uuid}/blocks/${blockB.uuid}/items`,
        {
          token: jwtTeacherB,
          schoolUuid: schoolB.uuid,
          body: {
            itemType: 'VIDEO',
            orderIndex: 1,
            mediaAssetUuid: schoolVideoA.uuid,
            caption: 'محاولة ربط عابرة للمستأجرين',
          },
        },
      );
      expect(crossTenantLinkRes.status).toBe(404);
      expect(crossTenantLinkRes.body.error).toBe('ASSET_NOT_FOUND');

      // التحقق في قاعدة البيانات من عدم إنشاء أي عنصر فقرة في المدرسة 99002 يشير إلى فيديو المدرسة 99001
      const leakedItemsInB = await prisma.lessonBlockItem.count({
        where: {
          blockId: blockB.id,
          mediaAssetId: schoolVideoA.id,
        },
      });
      expect(leakedItemsInB).toBe(0);

      // 5. حارس W-061 لحقول غير الدروس: محاولة تعيين فيديو المدرسة 99001 كغلاف مادة -> 400 VIDEO_NOT_ALLOWED_HERE
      let nonLessonGuardError: any = null;
      try {
        await subjectsService.updateSubject(schoolA.id, subjectA.id, {
          coverMediaAssetUuid: schoolVideoA.uuid,
        } as any);
      } catch (err: any) {
        nonLessonGuardError = {
          status: err.getStatus?.() ?? 400,
          response: err.getResponse?.() ?? err.message,
        };
      }
      expect(nonLessonGuardError).toBeTruthy();
      expect(nonLessonGuardError.status).toBe(400);
      expect(nonLessonGuardError.response).toMatchObject({
        error: 'VIDEO_NOT_ALLOWED_HERE',
      });

      p66Metrics.tests['P6-6.1'] = {
        status: 'PASS',
        durationMs: Date.now() - t0,
        httpResponses: {
          teacherBStatus: {
            status: teacherBStatusRes.status,
            body: teacherBStatusRes.body,
          },
          teacherBDownloadUrl: {
            status: teacherBDownloadUrlRes.status,
            body: teacherBDownloadUrlRes.body,
          },
          teacherBMeta: {
            status: teacherBMetaRes.status,
            body: teacherBMetaRes.body,
          },
          teacherBDirectDownload: {
            status: teacherBDirectDownloadRes.status,
            body: teacherBDirectDownloadRes.body,
          },
          studentBStatus: {
            status: studentBStatusRes.status,
            body: studentBStatusRes.body,
          },
          studentBDownloadUrl: {
            status: studentBDownloadUrlRes.status,
            body: studentBDownloadUrlRes.body,
          },
          studentBDirectDownload: {
            status: studentBDirectDownloadRes.status,
            body: studentBDirectDownloadRes.body,
          },
          headerTamperSchoolScopeMismatch: {
            status: headerTamperRes.status,
            body: headerTamperRes.body,
          },
          crossTenantLinkPostItems: {
            status: crossTenantLinkRes.status,
            body: crossTenantLinkRes.body,
          },
          w061NonLessonCoverGuard: nonLessonGuardError,
        },
        leakedItemsInSchoolBCount: leakedItemsInB,
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // P6-6.2 — Expired Subscription (D-R2-06 Backend HTTP API & Renewal Flow)
    // ═══════════════════════════════════════════════════════════════
    it('P6-6.2 (Expired Subscription — Backend API): يحجب student-a2 المنتهي اشتراكه بـ 403 SUBSCRIPTION_INACTIVE / SUBSCRIPTION_REQUIRED ولا يسمح بالتنزيل إلا بعد تجديد الاشتراك', async () => {
      const t0 = Date.now();

      // 1. التحقق من حالة الاشتراك عبر GET /school/student/subscription/my-status لكل من student-a و student-a2
      const statusStudentARes = await httpRequest(
        'GET',
        '/school/student/subscription/my-status',
        { token: jwtStudentA, schoolUuid: schoolA.uuid },
      );
      const statusStudentA2Res = await httpRequest(
        'GET',
        '/school/student/subscription/my-status',
        { token: jwtStudentA2, schoolUuid: schoolA.uuid },
      );

      expect(statusStudentARes.status).toBe(200);
      expect(statusStudentARes.body.subscriptionsEnabled).toBe(true);
      expect(['TRIAL', 'PAID']).toContain(statusStudentARes.body.accessType);
      expect(
        new Date(statusStudentARes.body.expiresAt).getTime(),
      ).toBeGreaterThan(new Date(statusStudentARes.body.serverTime).getTime());

      expect(statusStudentA2Res.status).toBe(200);
      expect(statusStudentA2Res.body.subscriptionsEnabled).toBe(true);
      expect(
        new Date(statusStudentA2Res.body.expiresAt).getTime(),
      ).toBeLessThan(new Date(statusStudentA2Res.body.serverTime).getTime());

      // 2. طالب باشتراك نشط (student-a) -> يحصل على 200 OK مع رابط R2 موقّع يعمل بـ 206 Partial Content
      const activeDlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        { token: jwtStudentA, schoolUuid: schoolA.uuid },
      );
      expect(activeDlRes.status).toBe(200);
      expect(activeDlRes.body.variant).toBe('480p');
      expect(activeDlRes.body.url).toContain('X-Amz-Signature');

      const r2RangeRes = await fetch(activeDlRes.body.url, {
        headers: { Range: 'bytes=0-511' },
      });
      const r2RangeBuf = Buffer.from(await r2RangeRes.arrayBuffer());
      expect(r2RangeRes.status).toBe(206);
      expect(r2RangeBuf.length).toBe(512);

      // 3. طالب باشتراك منتهٍ (student-a2) -> يُحجب بـ 403 على جميع نقاط تسليم الوسائط التعليمية
      const expiredDownloadUrlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        { token: jwtStudentA2, schoolUuid: schoolA.uuid },
      );
      const expiredMetaRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/meta`,
        { token: jwtStudentA2, schoolUuid: schoolA.uuid },
      );
      const expiredDirectDownloadRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}`,
        { token: jwtStudentA2, schoolUuid: schoolA.uuid },
      );

      expect(expiredDownloadUrlRes.status).toBe(403);
      expect(expiredDownloadUrlRes.body).toEqual({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'SUBSCRIPTION_INACTIVE',
      });
      expect(expiredMetaRes.status).toBe(403);
      expect(expiredMetaRes.body).toEqual({
        error: 'SUBSCRIPTION_REQUIRED',
        message: 'SUBSCRIPTION_REQUIRED',
      });
      expect(expiredDirectDownloadRes.status).toBe(403);
      expect(expiredDirectDownloadRes.body).toEqual({
        error: 'SUBSCRIPTION_REQUIRED',
        message: 'SUBSCRIPTION_REQUIRED',
      });

      // 4. تجديد اشتراك student-a2 -> يُسمح فوراً باستئناف التنزيل (200 OK + 206 Partial Content من بايت الإزاحة)
      const now = new Date();
      const renewedPeriod = await prisma.studentAccessPeriod.create({
        data: {
          schoolId: schoolA.id,
          studentUserId: studentA2User.id,
          periodType: 'TRIAL' as any,
          startedAt: now,
          expiresAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
        },
      });
      createdCleanupRegistry.accessPeriodIds.add(renewedPeriod.id);

      const renewedDownloadUrlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        { token: jwtStudentA2, schoolUuid: schoolA.uuid },
      );
      expect(renewedDownloadUrlRes.status).toBe(200);
      expect(renewedDownloadUrlRes.body.variant).toBe('480p');

      // محاكاة استئناف ملف .part من البايت 512 بعد التجديد
      const r2ResumeRes = await fetch(renewedDownloadUrlRes.body.url, {
        headers: { Range: 'bytes=512-1023' },
      });
      const r2ResumeBuf = Buffer.from(await r2ResumeRes.arrayBuffer());
      expect(r2ResumeRes.status).toBe(206);
      expect(r2ResumeBuf.length).toBe(512);

      // إعادة student-a2 إلى حالة انتهاء الاشتراك استعداداً لاختبار P6-6.3
      await prisma.studentAccessPeriod.delete({
        where: { id: renewedPeriod.id },
      });
      createdCleanupRegistry.accessPeriodIds.delete(renewedPeriod.id);

      p66Metrics.tests['P6-6.2'] = {
        status: 'PARTIAL (Backend API = PASS; Real Device = PENDING_DEVICE)',
        durationMs: Date.now() - t0,
        httpResponses: {
          studentAMyStatus: {
            status: statusStudentARes.status,
            body: statusStudentARes.body,
          },
          studentA2MyStatusExpired: {
            status: statusStudentA2Res.status,
            body: statusStudentA2Res.body,
          },
          studentADownloadUrl: {
            status: activeDlRes.status,
            variant: activeDlRes.body.variant,
            sizeBytes: activeDlRes.body.size_bytes,
            r2RangeStatus: r2RangeRes.status,
            r2RangeBytes: r2RangeBuf.length,
          },
          studentA2DownloadUrlExpired: {
            status: expiredDownloadUrlRes.status,
            body: expiredDownloadUrlRes.body,
          },
          studentA2MetaExpired: {
            status: expiredMetaRes.status,
            body: expiredMetaRes.body,
          },
          studentA2DirectDownloadExpired: {
            status: expiredDirectDownloadRes.status,
            body: expiredDirectDownloadRes.body,
          },
          studentA2DownloadUrlAfterRenewal: {
            status: renewedDownloadUrlRes.status,
            variant: renewedDownloadUrlRes.body.variant,
            r2ResumeRangeStatus: r2ResumeRes.status,
            r2ResumeRangeBytes: r2ResumeBuf.length,
          },
        },
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // P6-6.3 — Parent Child Isolation (Online Backend HTTP API & Guards)
    // ═══════════════════════════════════════════════════════════════
    it('P6-6.3 (Parent Child Isolation — Backend API): يعزل استحقاق الأبناء لولي الأمر 777000001 بدقة بين student-a (200 OK) و student-a2 (403) ويرفض غياب أو تعارض السياق', async () => {
      const t0 = Date.now();

      // 1. طلب بدون رأس x-student-context لولي أمر متعدد الأبناء -> 403 STUDENT_CONTEXT_REQUIRED
      const parentNoContextRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        { token: jwtParentA, schoolUuid: schoolA.uuid },
      );
      expect(parentNoContextRes.status).toBe(403);
      expect(parentNoContextRes.body).toEqual({
        error: 'STUDENT_CONTEXT_REQUIRED',
        message: 'STUDENT_CONTEXT_REQUIRED',
      });

      // 2. اختيار الابن الأول (student-a ذو الاشتراك النشط) عبر x-student-context -> 200 OK
      const parentChildAStatusRes = await httpRequest(
        'GET',
        '/school/student/subscription/my-status',
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: { 'x-student-context': studentAUser.uuid },
        },
      );
      expect(parentChildAStatusRes.status).toBe(200);
      expect(['TRIAL', 'PAID']).toContain(
        parentChildAStatusRes.body.accessType,
      );

      const parentChildADlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: { 'x-student-context': studentAUser.uuid },
        },
      );
      expect(parentChildADlRes.status).toBe(200);
      expect(parentChildADlRes.body.variant).toBe('480p');
      expect(parentChildADlRes.body.url).toContain('X-Amz-Signature');

      // 3. التبديل إلى الابن الثاني (student-a2 ذو الاشتراك المنتهي) عبر x-student-context -> 403 SUBSCRIPTION_INACTIVE
      const parentChildA2StatusRes = await httpRequest(
        'GET',
        '/school/student/subscription/my-status',
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: { 'x-student-context': studentA2User.uuid },
        },
      );
      expect(parentChildA2StatusRes.status).toBe(200);
      expect(
        new Date(parentChildA2StatusRes.body.expiresAt).getTime(),
      ).toBeLessThan(
        new Date(parentChildA2StatusRes.body.serverTime).getTime(),
      );

      const parentChildA2DlRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: { 'x-student-context': studentA2User.uuid },
        },
      );
      expect(parentChildA2DlRes.status).toBe(403);
      expect(parentChildA2DlRes.body).toEqual({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'SUBSCRIPTION_INACTIVE',
      });

      const parentChildA2MetaRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/meta`,
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: { 'x-student-context': studentA2User.uuid },
        },
      );
      expect(parentChildA2MetaRes.status).toBe(403);
      expect(parentChildA2MetaRes.body).toEqual({
        error: 'SUBSCRIPTION_REQUIRED',
        message: 'SUBSCRIPTION_REQUIRED',
      });

      // 4. محاولة تمرير UUID طالب غير مرتبط بولي الأمر (studentB) -> 403 دون أي تسريب
      const parentForeignChildRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: { 'x-student-context': studentBUser.uuid },
        },
      );
      expect(parentForeignChildRes.status).toBe(403);
      expect(parentForeignChildRes.body).toEqual({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'SUBSCRIPTION_INACTIVE',
      });

      // 5. محاولة تمرير رأسين متعارضين (x-student-context = student-a و x-student-uuid = student-a2) -> 403
      const parentConflictingHeadersRes = await httpRequest(
        'GET',
        `/school/media/${schoolVideoA.uuid}/download-url?variant=480p`,
        {
          token: jwtParentA,
          schoolUuid: schoolA.uuid,
          headers: {
            'x-student-context': studentAUser.uuid,
            'x-student-uuid': studentA2User.uuid,
          },
        },
      );
      expect(parentConflictingHeadersRes.status).toBe(403);

      p66Metrics.tests['P6-6.3'] = {
        status: 'PARTIAL (Backend API = PASS; Real Device = PENDING_DEVICE)',
        durationMs: Date.now() - t0,
        httpResponses: {
          parentWithoutHeader: {
            status: parentNoContextRes.status,
            body: parentNoContextRes.body,
          },
          parentWithChildAMyStatus: {
            status: parentChildAStatusRes.status,
            body: parentChildAStatusRes.body,
          },
          parentWithChildADownloadUrl: {
            status: parentChildADlRes.status,
            variant: parentChildADlRes.body.variant,
            sizeBytes: parentChildADlRes.body.size_bytes,
          },
          parentWithChildA2MyStatus: {
            status: parentChildA2StatusRes.status,
            body: parentChildA2StatusRes.body,
          },
          parentWithChildA2DownloadUrl: {
            status: parentChildA2DlRes.status,
            body: parentChildA2DlRes.body,
          },
          parentWithChildA2Meta: {
            status: parentChildA2MetaRes.status,
            body: parentChildA2MetaRes.body,
          },
          parentWithUnlinkedChild: {
            status: parentForeignChildRes.status,
            body: parentForeignChildRes.body,
          },
          parentWithConflictingHeaders: {
            status: parentConflictingHeadersRes.status,
            body: parentConflictingHeadersRes.body,
          },
        },
      };
    });

    // ═══════════════════════════════════════════════════════════════
    // P6-6.4 — Distribution / Shared MediaAsset (Policy A across Schools 99001 & 99002)
    // ═══════════════════════════════════════════════════════════════
    it('P6-6.4 (Distribution / Shared MediaAsset): يوزع درس منصة بفيديو إلى المدرستين 99001 و 99002 ويثبت مشاركة MediaAsset.id نفسه و0 كائنات R2 إضافية واستمرار وصول 99002 بعد حذف نسخة 99001', async () => {
      const t0 = Date.now();

      // 1. رفع وتحويل فيديو منصة رسمي على حاوية R2 تحت البادئة المعزولة
      const r2KeysBeforePlatformUpload = r2Provider.createdRemoteKeys.size;
      const platformVideo = await uploadAndTranscodePlatformVideo(
        platformAdmin.id,
        fixtureMp4Path,
      );
      const r2KeysAfterPlatformUpload = r2Provider.createdRemoteKeys.size;
      const platformVideoR2KeysCount =
        r2KeysAfterPlatformUpload - r2KeysBeforePlatformUpload;
      expect(platformVideoR2KeysCount).toBe(5); // source + 360p, 480p, 720p, thumb.jpg

      // 2. إنشاء وحدة وقالب درس منصة وربط فيديو المنصة به
      const platformUnit = await prisma.unit.create({
        data: {
          subjectDictionaryId: subjectDict.id,
          title: `وحدة منصة مشتركة P6-6 (${runId})`,
          orderIndex: 1,
        },
      });
      createdCleanupRegistry.unitIds.add(platformUnit.id);

      const platformTpl = await prisma.lessonTemplate.create({
        data: {
          ownerType: 'PLATFORM',
          schoolId: null,
          subjectDictionaryId: subjectDict.id,
          unitId: platformUnit.id,
          title: `درس منصة مشترك P6-6 (${runId})`,
          orderIndex: 1,
          status: 'PUBLISHED',
          templateVersion: 1,
        },
      });
      createdCleanupRegistry.lessonTemplateIds.add(platformTpl.id);

      const platformBlock = await prisma.lessonContentBlock.create({
        data: {
          templateId: platformTpl.id,
          title: 'فقرة المنصة الرسمية',
          orderIndex: 1,
        },
      });
      createdCleanupRegistry.lessonContentBlockIds.add(platformBlock.id);

      const createdPlatformItem = await platformLessonsService.createBlockItem(
        platformAdmin.uuid,
        platformTpl.uuid,
        platformBlock.uuid,
        {
          itemType: 'VIDEO',
          orderIndex: 1,
          mediaAssetUuid: platformVideo.uuid,
          caption: 'فيديو المنصة المشترك',
        },
      );
      expect(createdPlatformItem.mediaAssetUuid).toBe(platformVideo.uuid);

      // قبل التوزيع: لا المدرسة 99001 ولا المدرسة 99002 تستطيع الوصول إلى فيديو المنصة (S4-T5)
      const preDistSchoolARes = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/status`,
        { token: jwtTeacherA, schoolUuid: schoolA.uuid },
      );
      const preDistSchoolBRes = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/status`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      expect(preDistSchoolARes.status).toBe(404);
      expect(preDistSchoolBRes.status).toBe(404);

      // 3. توزيع درس المنصة رسمياً إلى كلتا المدرستين 99001 و 99002
      const distA = await prisma.contentDistribution.create({
        data: {
          schoolId: schoolA.id,
          sourceLessonTemplateId: platformTpl.id,
          distributedByPlatformUserId: platformAdmin.id,
          status: DistributionStatus.ACTIVE,
        },
      });
      createdCleanupRegistry.contentDistributionIds.add(distA.id);

      const distB = await prisma.contentDistribution.create({
        data: {
          schoolId: schoolB.id,
          sourceLessonTemplateId: platformTpl.id,
          distributedByPlatformUserId: platformAdmin.id,
          status: DistributionStatus.ACTIVE,
        },
      });
      createdCleanupRegistry.contentDistributionIds.add(distB.id);

      // 4. استنساخ (Fork) درس المنصة في كلتا المدرستين عبر نقطة API الحقيقية POST /school/teacher/platform-lessons/:uuid/fork
      const forkSchoolARes = await httpRequest(
        'POST',
        `/school/teacher/platform-lessons/${platformTpl.uuid}/fork`,
        { token: jwtTeacherA, schoolUuid: schoolA.uuid },
      );
      const forkSchoolBRes = await httpRequest(
        'POST',
        `/school/teacher/platform-lessons/${platformTpl.uuid}/fork`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );

      expect(forkSchoolARes.status).toBe(201);
      expect(forkSchoolBRes.status).toBe(201);

      const clonedTplAUuid = forkSchoolARes.body.schoolLesson.uuid as string;
      const clonedTplBUuid = forkSchoolBRes.body.schoolLesson.uuid as string;

      const clonedTplA = await prisma.lessonTemplate.findUniqueOrThrow({
        where: { uuid: clonedTplAUuid },
      });
      const clonedTplB = await prisma.lessonTemplate.findUniqueOrThrow({
        where: { uuid: clonedTplBUuid },
      });
      createdCleanupRegistry.lessonTemplateIds.add(clonedTplA.id);
      createdCleanupRegistry.lessonTemplateIds.add(clonedTplB.id);

      // 5. التحقق من أن 0 كائنات R2 إضافية أُنشئت عند التوزيع والاستنساخ للمدرستين
      const r2KeysAfterForks = r2Provider.createdRemoteKeys.size;
      expect(r2KeysAfterForks).toBe(r2KeysAfterPlatformUpload);

      // 6. التحقق الفعلي من المراجع في قاعدة البيانات: درس المنصة والنسختان المدرسيتان تشير جميعاً إلى MediaAsset.id نفسه
      const activeBlockItemsBeforeDelete =
        await prisma.lessonBlockItem.findMany({
          where: {
            mediaAssetId: platformVideo.id,
            isDeleted: false,
          },
          include: {
            block: {
              select: {
                id: true,
                uuid: true,
                template: {
                  select: {
                    id: true,
                    uuid: true,
                    ownerType: true,
                    schoolId: true,
                    sourceTemplateId: true,
                  },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
        });

      expect(activeBlockItemsBeforeDelete).toHaveLength(3);
      for (const item of activeBlockItemsBeforeDelete) {
        expect(item.mediaAssetId).toBe(platformVideo.id);
      }

      // 7. التحقق من وصول كلتا المدرستين 99001 و 99002 إلى الفيديو المشترك عبر download-url
      const dlInABeforeRevoke = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/download-url?variant=480p`,
        { token: jwtTeacherA, schoolUuid: schoolA.uuid },
      );
      const dlInBBeforeRevoke = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/download-url?variant=480p`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      expect(dlInABeforeRevoke.status).toBe(200);
      expect(dlInBBeforeRevoke.status).toBe(200);

      // 8. إلغاء توزيع المدرسة 99001 (REVOKED) + حذف نسخة المدرسة 99001 عبر DELETE /school/teacher/lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid
      await prisma.contentDistribution.update({
        where: { id: distA.id },
        data: { status: DistributionStatus.REVOKED },
      });

      const schoolAClonedItem = activeBlockItemsBeforeDelete.find(
        (i) => i.block.template.schoolId === schoolA.id,
      )!;
      const deleteSchoolAItemRes = await httpRequest(
        'DELETE',
        `/school/teacher/lessons/${clonedTplA.uuid}/blocks/${schoolAClonedItem.block.uuid}/items/${schoolAClonedItem.uuid}`,
        { token: jwtTeacherA, schoolUuid: schoolA.uuid },
      );
      expect(deleteSchoolAItemRes.status).toBe(200);

      // التحقق: الأصل المشترك لم يُحذف منطقياً، ولا تزال له 2 مراجع نشطة (المنصة + المدرسة 99002)
      const assetAfterSchoolADelete = await prisma.mediaAsset.findUniqueOrThrow(
        {
          where: { id: platformVideo.id },
        },
      );
      expect(assetAfterSchoolADelete.isDeleted).toBe(false);

      const remainingActiveRefsAfterA = await prisma.lessonBlockItem.count({
        where: { mediaAssetId: platformVideo.id, isDeleted: false },
      });
      expect(remainingActiveRefsAfterA).toBe(2);

      // المدرسة 99001 لم يعد لديها توزيع نشط ولا نسخة نشطة -> تُرفض بـ 404 ASSET_NOT_FOUND
      const dlInAAfterDelete = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/download-url?variant=480p`,
        { token: jwtTeacherA, schoolUuid: schoolA.uuid },
      );
      expect(dlInAAfterDelete.status).toBe(404);
      expect(dlInAAfterDelete.body.error).toBe('ASSET_NOT_FOUND');

      // المدرسة 99002 تستمر في الوصول إلى الفيديو المشترك بنجاح (200 OK + 206 Partial Content من R2)
      const dlInBAfterSchoolADelete = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/download-url?variant=480p`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      expect(dlInBAfterSchoolADelete.status).toBe(200);

      // 9. اختبار Policy A الأعمق: حتى لو أُلغي التوزيع الرسمي للمدرسة 99002 وحُذف عنصر المنصة الأصلي،
      //    يبقى الأصل حياً (isDeleted=false، remainingActiveRefs=1) وتستمر المدرسة 99002 بالوصول طالما لديها مرجع مستنسخ نشط!
      await prisma.contentDistribution.update({
        where: { id: distB.id },
        data: { status: DistributionStatus.REVOKED },
      });
      await platformLessonsService.deleteBlockItem(
        platformAdmin.uuid,
        platformTpl.uuid,
        platformBlock.uuid,
        createdPlatformItem.uuid,
      );

      const assetWithOnlySchoolBClone =
        await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: platformVideo.id },
        });
      expect(assetWithOnlySchoolBClone.isDeleted).toBe(false);

      const activeRefsOnlySchoolB = await prisma.lessonBlockItem.count({
        where: { mediaAssetId: platformVideo.id, isDeleted: false },
      });
      expect(activeRefsOnlySchoolB).toBe(1);

      const dlInBPolicyARes = await httpRequest(
        'GET',
        `/school/media/${platformVideo.uuid}/download-url?variant=480p`,
        { token: jwtTeacherB, schoolUuid: schoolB.uuid },
      );
      expect(dlInBPolicyARes.status).toBe(200);

      const r2SharedRangeRes = await fetch(dlInBPolicyARes.body.url, {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(r2SharedRangeRes.status).toBe(206);

      // التحقق من بقاء مفاتيح R2 الخمسة للفيديو المشترك سليمة على الحاوية
      const manifest = parseVariantsManifest(
        assetWithOnlySchoolBClone.variantsJson,
      );
      const sharedVariantKeys = [
        assetWithOnlySchoolBClone.storageKey!,
        ...Object.values(manifest.variants).map((v: any) => v.storage_key),
        manifest.thumb?.storage_key,
        manifest.source?.storage_key,
      ].filter(Boolean) as string[];
      for (const k of new Set(sharedVariantKeys)) {
        const head = await r2Provider.headObject(k);
        expect(head.kind).toBe('FOUND');
      }

      p66Metrics.tests['P6-6.4'] = {
        status: 'PASS',
        durationMs: Date.now() - t0,
        sharedMediaAssetId: platformVideo.id,
        sharedMediaAssetUuid: platformVideo.uuid,
        r2KeysCreatedForPlatformVideo: platformVideoR2KeysCount,
        extraR2KeysOnDistributeAndFork:
          r2KeysAfterForks - r2KeysAfterPlatformUpload,
        dbReferencesBeforeDelete: activeBlockItemsBeforeDelete.map((i) => ({
          blockItemId: i.id,
          blockItemUuid: i.uuid,
          mediaAssetId: i.mediaAssetId,
          templateId: i.block.template.id,
          templateUuid: i.block.template.uuid,
          ownerType: i.block.template.ownerType,
          schoolId: i.block.template.schoolId,
          sourceTemplateId: i.block.template.sourceTemplateId,
        })),
        afterSchoolARevokeAndDelete: {
          mediaAssetIsDeleted: assetAfterSchoolADelete.isDeleted,
          activeLessonBlockItemCount: remainingActiveRefsAfterA,
          schoolADownloadUrlStatus: dlInAAfterDelete.status,
          schoolADownloadUrlBody: dlInAAfterDelete.body,
          schoolBDownloadUrlStatus: dlInBAfterSchoolADelete.status,
        },
        afterPlatformUnlinkAndSchoolBRevokePolicyA: {
          mediaAssetIsDeleted: assetWithOnlySchoolBClone.isDeleted,
          activeLessonBlockItemCount: activeRefsOnlySchoolB,
          schoolBDownloadUrlStatus: dlInBPolicyARes.status,
          r2RangeStatus: r2SharedRangeRes.status,
          verifiedR2KeysExistCount: sharedVariantKeys.length,
        },
      };
    });
  },
);
