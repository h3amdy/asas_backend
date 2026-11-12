/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
// src/shared/media/worker/video-ffmpeg.staging.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-7B — التحقق الفعلي من FFmpeg والمعالجة الشاملة (E2E) على Staging + R2 Sandbox
// مرجع: docs/features/video/11-VIDEO-P4-7B-EXECUTION-PLAN.md (v1.1)
//        docs/Sessions/11_3_11_2026/chat312.md (Approved — P4-7B)
// ═══════════════════════════════════════════════════════════════
//
// الضوابط التنفيذية الحاكمة (chat312.md):
// 1. حارس العزل (Fail-Closed): يفشل قبل أي اتصال شبكي إذا وُجد أي متغير إنتاجي R2_*.
// 2. جميع المفاتيح المنشأة على حاوية asas-media-poc تقع حصراً تحت البادئة: p4-7b/<run-id>/.
// 3. لا يُستخدم أي محاكٍ (mock/fake) لـ ffmpeg أو ffprobe — التحقق يتم بالثنائيات الحقيقية.
// 4. اختبار FFMPEG-B6 (E2E-3) يلتقط workerPid و ffmpegPid الفعليين، يرسل SIGKILL إلى workerPid فقط،
//    ويثبت على مستوى نظام التشغيل توقف كلتا العمليتين (ESRCH) قبل بدء الجيل الثاني f2.
// 5. اختبار FFMPEG-B8 يتبع قواعد الحذف الإنتاجية الكاملة (P4-6) ويتحقق من 404 لكل مفتاح في التشغيل.
// 6. لا تُطبع أي مفاتيح سرية أو روابط موقعة في السجلات أو التقارير.
// ═══════════════════════════════════════════════════════════════

import { S3Client } from '@aws-sdk/client-s3';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppType,
  DistributionStatus,
  MediaKind,
  MediaUploadStatus,
  PlatformRole,
  ProcessingStatus,
  UserType,
} from '@prisma/client';
import { execFile, spawn } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { PlatformMediaUploadService } from '../../../platform/media/platform-media-upload.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MediaCleanupService } from '../../../school/media/media-cleanup.service';
import { MediaUploadService } from '../../../school/media/media-upload.service';
import { MediaController } from '../../../school/media/media.controller';
import { MediaService } from '../../../school/media/media.service';
import { StudentSyncService } from '../../../school/student/sync/student-sync.service';
import { DiskSpaceGuardService } from '../disk-space-guard.service';
import { FfprobeService } from '../ffprobe.service';
import { computeFileDigest } from '../file-digest.util';
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
import {
  LeaseLostError,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';
import { R2StorageProvider } from '../r2-storage.provider';
import { classifyStorageError } from '../storage-errors';
import { StorageService } from '../storage.service';
import { UploadValidationHelper } from '../upload-validation.helper';
import {
  AMBIENT_PROD_R2_ENV_VARS,
  assertSafeR2SandboxEnvironment,
  R2Credentials,
  REQUIRED_R2_SANDBOX_ENV_VARS,
  VideoMediaConfig,
  VideoMediaConfigError,
} from '../video-media.config';
import { VideoUploadService } from '../video-upload.service';
import { DeleteObjectsProcessor } from './delete-objects.processor';
import { MediaWorkerService } from './media-worker.service';
import { MoveSourceProcessor } from './move-source.processor';
import {
  DeterministicTranscodeError,
  parseVariantsManifest,
  VideoTranscodeProcessor,
} from './video-transcode.processor';

jest.setTimeout(360_000);

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SANDBOX_ENV_FILE = path.resolve(PROJECT_ROOT, '.env.r2-sandbox');
const SCRATCH_BIN_DIR =
  '/Users/hamdy/.gemini/antigravity/brain/82d302f4-7d82-441f-948a-b6f07f9c6254/scratch/bin';

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

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p47b_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
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

const fileVars = loadDotenvFileIfPresent(SANDBOX_ENV_FILE);
const effectiveSandboxEnv: Record<string, string | undefined> = {
  ...fileVars,
  ...process.env,
};

const hasSandboxEnvConfigured = REQUIRED_R2_SANDBOX_ENV_VARS.every(
  (k) => (effectiveSandboxEnv[k] ?? '').trim() !== '',
);

/**
 * مزود R2 اختباري يستخدم R2StorageProvider الحقيقي و S3Client الحقيقي 100%،
 * مع فرض بادئة التشغيل p4-7b/<run-id>/ على جميع المفاتيح وتعقب كل مفتاح أُنشئ.
 */
class NamespacedSandboxR2Provider extends R2StorageProvider {
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

/**
 * تحليل ذرات المستوى الأعلى (Top-Level Boxes) لملف MP4 لإثبات أن moov يسبق mdat (+faststart).
 */
async function parseMp4TopLevelBoxes(filePath: string): Promise<{
  boxes: Array<{ type: string; offset: number; size: number }>;
  moovOffset: number;
  mdatOffset: number;
}> {
  const stat = await fsp.stat(filePath);
  const totalSize = stat.size;
  const handle = await fsp.open(filePath, 'r');
  const boxes: Array<{ type: string; offset: number; size: number }> = [];
  try {
    let offset = 0;
    const headerBuf = Buffer.alloc(16);
    while (offset + 8 <= totalSize) {
      const { bytesRead } = await handle.read(
        headerBuf,
        0,
        Math.min(16, totalSize - offset),
        offset,
      );
      if (bytesRead < 8) break;
      const size32 = headerBuf.readUInt32BE(0);
      const type = headerBuf.subarray(4, 8).toString('ascii');
      let boxSize = size32;
      if (size32 === 1) {
        if (bytesRead < 16) break;
        boxSize = Number(headerBuf.readBigUInt64BE(8));
      } else if (size32 === 0) {
        boxSize = totalSize - offset;
      }
      if (boxSize < 8) break;
      boxes.push({ type, offset, size: boxSize });
      offset += boxSize;
    }
  } finally {
    await handle.close();
  }
  const moovOffset = boxes.find((b) => b.type === 'moov')?.offset ?? -1;
  const mdatOffset = boxes.find((b) => b.type === 'mdat')?.offset ?? -1;
  return { boxes, moovOffset, mdatOffset };
}

async function downloadStreamToFile(
  stream: Readable,
  destPath: string,
): Promise<LocalFileDigest> {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    stream.pipe(ws);
    stream.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', () => resolve());
  });
  return computeFileDigest(destPath);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

describe('VIDEO P4-7B — Real FFmpeg Staging & E2E Validation (asas-media-poc)', () => {
  it('FFMPEG-B0 (Part 1): يرفض التشغيل فوراً (Fail-Closed) عند وجود أي متغير إنتاجي R2_* ويصنف 501 NotImplemented كخطأ غير قابل لإعادة المحاولة (F-7B-1)', () => {
    for (const prodVar of AMBIENT_PROD_R2_ENV_VARS) {
      expect(() =>
        assertSafeR2SandboxEnvironment({
          [prodVar]: 'prod-value-present',
          R2_SANDBOX_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
          R2_SANDBOX_ALLOWED_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
          R2_SANDBOX_BUCKET_NAME: 'asas-media-poc',
          R2_SANDBOX_ENDPOINT:
            'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
          R2_SANDBOX_ACCESS_KEY_ID: 'key',
          R2_SANDBOX_SECRET_ACCESS_KEY: 'secret',
        }),
      ).toThrow(VideoMediaConfigError);
    }

    const notImplErr = classifyStorageError(
      {
        name: 'NotImplemented',
        $metadata: { httpStatusCode: 501 },
      },
      'r2.copy',
    );
    expect(notImplErr.kind).toBe('INVALID_INPUT');
    expect(notImplErr.retryable).toBe(false);
    expect(notImplErr.httpStatus).toBe(501);
  });

  (hasSandboxEnvConfigured ? describe : describe.skip)(
    'Live FFmpeg + PostgreSQL + Cloudflare R2 E2E Suite (Isolated Run Prefix p4-7b/<run-id>/)',
    () => {
      const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const runPrefix = `p4-7b/${runId}`;

      let ffmpegBin = '';
      let ffprobeBin = '';
      let prevFfmpegBin: string | undefined;
      let prevFfprobeBin: string | undefined;
      let prevStoragePath: string | undefined;

      let tempDbName = '';
      let tempDbUrl = '';
      let dbCreated = false;

      let sandboxCreds: R2Credentials & { endpoint: string };
      let r2Provider: NamespacedSandboxR2Provider;
      let prisma: PrismaService;
      let config: VideoMediaConfig;
      let storage: StorageService;
      let localProvider: LocalObjectStorageProvider;
      let registry: ObjectStorageRegistry;
      let accessPolicy: MediaAccessPolicyService;
      let lifecycle: MediaLifecycleService;
      let ffprobe: FfprobeService;
      let validation: UploadValidationHelper;
      let diskGuard: DiskSpaceGuardService;
      let videoUpload: VideoUploadService;
      let schoolUploadService: MediaUploadService;
      let platformUploadService: PlatformMediaUploadService;
      let queue: MediaJobQueueService;
      let transcodeProcessor: VideoTranscodeProcessor;
      let moveSourceProcessor: MoveSourceProcessor;
      let deleteObjectsProcessor: DeleteObjectsProcessor;
      let worker: MediaWorkerService;
      let cleanupService: MediaCleanupService;
      let mediaService: MediaService;
      let mediaController: MediaController;
      let studentSyncService: StudentSyncService;

      let tmpDir = '';
      let fixturesDir = '';
      let fixture1080pPath = '';
      let fixture480pSilentMovPath = '';
      let fixture720pLongPath = '';
      let fixtureAudioOnlyFakeMp4Path = '';

      // بيانات البذر في PostgreSQL
      let schoolAId = 0;
      let schoolAUuid = '';
      let schoolBId = 0;
      let assignedTeacherUserId = 0;
      let assignedTeacherUuid = '';
      let unassignedTeacherUserId = 0;
      let subscribedStudentUserId = 0;
      let subscribedStudentUuid = '';
      let unsubscribedStudentUserId = 0;
      let unsubscribedStudentUuid = '';
      let schoolBStudentUserId = 0;
      let schoolBStudentUuid = '';
      let platformAdminId = 0;
      let subjectAId = 0;
      let sectionAId = 0;
      let yearAId = 0;
      let termAId = 0;

      const createdLessonBlockItemIds: number[] = [];
      const createdAssetIds: number[] = [];

      const metricsReport: Record<string, unknown> = {
        runId,
        runPrefix,
        bucketName: '',
        startedAt: new Date().toISOString(),
        tests: {},
      };

      async function uploadFileViaSchoolService(
        filePath: string,
        fileName: string,
        contentType: 'video/mp4' | 'video/quicktime',
        userId = assignedTeacherUserId,
        schoolId = schoolAId,
        schoolUuid = schoolAUuid,
      ) {
        const digest = await computeFileDigest(filePath);
        const fileBuf = await fsp.readFile(filePath);
        const initRes = await schoolUploadService.initSession(
          {
            kind: MediaKind.VIDEO,
            filename: fileName,
            totalSizeBytes: digest.sizeBytes,
            contentType,
          } as any,
          schoolId,
          schoolUuid,
          { userId, role: 'TEACHER' },
        );
        const chunkSize = initRes.chunk_size_bytes || 2 * 1024 * 1024;
        let offset = 0;
        while (offset < fileBuf.length) {
          const slice = fileBuf.subarray(
            offset,
            Math.min(offset + chunkSize, fileBuf.length),
          );
          const endByte = offset + slice.length - 1;
          const contentRange = `bytes ${offset}-${endByte}/${fileBuf.length}`;
          await schoolUploadService.uploadChunk(
            initRes.upload_session_uuid,
            schoolId,
            contentRange,
            slice,
            userId,
          );
          offset += slice.length;
        }
        const completeRes = await schoolUploadService.completeSession(
          initRes.upload_session_uuid,
          schoolId,
          schoolUuid,
          userId,
        );
        return { digest, initRes, completeRes };
      }

      beforeAll(async () => {
        // 1. فحص حارس العزل (Fail-Closed)
        sandboxCreds = assertSafeR2SandboxEnvironment(effectiveSandboxEnv);
        expect(sandboxCreds.bucketName).toBe('asas-media-poc');
        metricsReport.bucketName = sandboxCreds.bucketName;

        // 2. تحديد مسارات ثنائيات ffmpeg و ffprobe الحقيقية
        ffmpegBin = resolveRealBinary('ffmpeg');
        ffprobeBin = resolveRealBinary('ffprobe');
        prevFfmpegBin = process.env.MEDIA_FFMPEG_BIN;
        prevFfprobeBin = process.env.MEDIA_FFPROBE_BIN;
        process.env.MEDIA_FFMPEG_BIN = ffmpegBin;
        process.env.MEDIA_FFPROBE_BIN = ffprobeBin;

        // 3. تجهيز قاعدة PostgreSQL اختبارية مؤقتة ومعزولة
        tempDbName = `asas_video_p47b_pg_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
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

        prisma = new PrismaService({ datasourceUrl: tempDbUrl });
        await prisma.$connect();

        // 4. تجهيز مجلد التخزين المحلي وتوليد العينات الاختبارية الأربعة عبر ffmpeg الحقيقي
        tmpDir = await fsp.mkdtemp(
          path.join(os.tmpdir(), `asas-p4-7b-${runId}-`),
        );
        fixturesDir = path.join(tmpDir, 'fixtures');
        await fsp.mkdir(fixturesDir, { recursive: true });

        prevStoragePath = process.env.MEDIA_STORAGE_PATH;
        process.env.MEDIA_STORAGE_PATH = tmpDir;
        process.env.MEDIA_TMP_MIN_FREE_BYTES = '500000000';
        process.env.MEDIA_VIDEO_TRANSCODE_SCRATCH_BYTES = '100000000';
        process.env.MEDIA_WORKER_MIN_FREE_BYTES = '500000000';
        process.env.MEDIA_WORKER_LIVE_MIN_FREE_BYTES = '250000000';

        fixture1080pPath = path.join(
          fixturesDir,
          'fixture-1080p-16x9-audio.mp4',
        );
        fixture480pSilentMovPath = path.join(
          fixturesDir,
          'fixture-480p-4x3-silent.mov',
        );
        fixture720pLongPath = path.join(
          fixturesDir,
          'fixture-720p-16x9-audio.mp4',
        );
        fixtureAudioOnlyFakeMp4Path = path.join(
          fixturesDir,
          'fixture-audio-only-fake.mp4',
        );

        // (1) fixture-1080p-16x9-audio.mp4 (1920x1080, 2.5s, 24fps, h264 + aac)
        await execFileAsync(ffmpegBin, [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=1920x1080:rate=24',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '2.5',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-ac',
          '2',
          '-b:a',
          '128k',
          fixture1080pPath,
        ]);

        // (2) fixture-480p-4x3-silent.mov (640x480 4:3, 2.0s, 24fps, silent QuickTime .mov)
        await execFileAsync(ffmpegBin, [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=640x480:rate=24',
          '-t',
          '2.0',
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-f',
          'mov',
          fixture480pSilentMovPath,
        ]);

        // (3) fixture-720p-16x9-audio.mp4 (1280x720, 12.0s, 24fps, h264 + aac لاختبار SIGKILL)
        await execFileAsync(ffmpegBin, [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=1280x720:rate=24',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=520:sample_rate=48000',
          '-t',
          '12.0',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-ac',
          '2',
          '-b:a',
          '128k',
          fixture720pLongPath,
        ]);

        // (4) fixture-audio-only-fake.mp4 (ملف MP4 يحتوي مسار صوت فقط بلا أي مسار فيديو)
        await execFileAsync(ffmpegBin, [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=48000',
          '-t',
          '1.5',
          '-vn',
          '-c:a',
          'aac',
          '-b:a',
          '96k',
          fixtureAudioOnlyFakeMp4Path,
        ]);

        // 5. تهيئة VideoMediaConfig و NamespacedSandboxR2Provider
        config = new VideoMediaConfig();
        jest.spyOn(config, 'isUploadEnabled', 'get').mockReturnValue(true);
        jest.spyOn(config, 'getR2Credentials').mockReturnValue({
          accountId: sandboxCreds.accountId,
          accessKeyId: sandboxCreds.accessKeyId,
          secretAccessKey: sandboxCreds.secretAccessKey,
          bucketName: sandboxCreds.bucketName,
        });

        r2Provider = new NamespacedSandboxR2Provider(
          config,
          sandboxCreds,
          runPrefix,
        );

        storage = new StorageService();
        localProvider = new LocalObjectStorageProvider(storage);
        registry = new ObjectStorageRegistry(localProvider, r2Provider);
        accessPolicy = new MediaAccessPolicyService(prisma);
        lifecycle = new MediaLifecycleService(accessPolicy);
        ffprobe = new FfprobeService(config);
        validation = new UploadValidationHelper(config);
        diskGuard = new DiskSpaceGuardService(prisma);
        videoUpload = new VideoUploadService(
          prisma,
          storage,
          config,
          diskGuard,
          ffprobe,
          validation,
        );
        const dummyProcessing = {
          processAsset: jest.fn().mockResolvedValue(undefined),
        } as any;

        schoolUploadService = new MediaUploadService(
          prisma,
          storage,
          dummyProcessing,
          videoUpload,
          validation,
          accessPolicy,
        );
        platformUploadService = new PlatformMediaUploadService(
          prisma,
          storage,
          dummyProcessing,
          videoUpload,
          validation,
          accessPolicy,
        );

        queue = new MediaJobQueueService(prisma, config);
        transcodeProcessor = new VideoTranscodeProcessor(
          prisma,
          config,
          storage,
          registry,
          ffprobe,
          queue,
        );
        moveSourceProcessor = new MoveSourceProcessor(
          prisma,
          config,
          registry,
          queue,
        );
        deleteObjectsProcessor = new DeleteObjectsProcessor(
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
          transcodeProcessor,
          moveSourceProcessor,
          registry,
          deleteObjectsProcessor,
        );
        cleanupService = new MediaCleanupService(
          prisma,
          storage,
          lifecycle,
          config,
        );
        mediaService = new MediaService(
          prisma,
          storage,
          accessPolicy,
          config,
          r2Provider,
        );
        mediaController = new MediaController(mediaService, storage, prisma);
        studentSyncService = new StudentSyncService(prisma);

        // 6. بذر المدارس والمعلمين والطلاب والاشتراكات في PostgreSQL
        const schoolA = await prisma.school.create({
          data: {
            name: `P4-7B School A ${runId}`,
            schoolCode: 88711,
            appType: AppType.PRIVATE,
          },
        });
        schoolAId = schoolA.id;
        schoolAUuid = schoolA.uuid;

        const schoolB = await prisma.school.create({
          data: {
            name: `P4-7B School B ${runId}`,
            schoolCode: 88712,
            appType: AppType.PRIVATE,
          },
        });
        schoolBId = schoolB.id;

        // تفعيل نظام الاشتراكات في المدرسة A لاختبار استحقاق الفيديو
        await prisma.schoolSubscriptionSettings.create({
          data: {
            schoolId: schoolAId,
            isActivated: true,
            activatedAt: new Date(),
            isTrialEnabled: false,
            subscriptionPrice: 100,
            contactNumber: '777000111',
          },
        });

        const gradeDict = await prisma.gradeDictionary.create({
          data: {
            code: 'G-P47B-1',
            defaultName: 'الصف الأول',
            sortOrder: 1,
          },
        });
        const subjectDict = await prisma.subjectDictionary.create({
          data: {
            gradeDictionaryId: gradeDict.id,
            code: 'SUB-P47B-1',
            defaultName: 'العلوم',
          },
        });

        const yearA = await prisma.year.create({
          data: {
            schoolId: schoolAId,
            name: '2026-2027',
            isCurrent: true,
          },
        });
        yearAId = yearA.id;

        const termA = await prisma.term.create({
          data: {
            yearId: yearAId,
            name: 'الفصل الأول',
            orderIndex: 1,
            isCurrent: true,
          },
        });
        termAId = termA.id;

        const gradeA = await prisma.schoolGrade.create({
          data: {
            schoolId: schoolAId,
            dictionaryId: gradeDict.id,
            displayName: 'الصف الأول',
            sortOrder: 1,
          },
        });
        const sectionA = await prisma.section.create({
          data: {
            gradeId: gradeA.id,
            name: 'أ',
            orderIndex: 1,
          },
        });
        sectionAId = sectionA.id;

        const subjectA = await prisma.subject.create({
          data: {
            schoolId: schoolAId,
            gradeId: gradeA.id,
            dictionaryId: subjectDict.id,
            displayName: 'العلوم',
          },
        });
        subjectAId = subjectA.id;

        const subjectSectionA = await prisma.subjectSection.create({
          data: {
            subjectId: subjectAId,
            sectionId: sectionAId,
          },
        });

        const assignedTeacherUser = await prisma.user.create({
          data: {
            code: 9300001,
            schoolId: schoolAId,
            userType: UserType.TEACHER,
            name: 'معلم مسند - المدرسة أ',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        assignedTeacherUserId = assignedTeacherUser.id;
        assignedTeacherUuid = assignedTeacherUser.uuid;
        await prisma.teacher.create({
          data: { userId: assignedTeacherUserId },
        });
        await prisma.subjectSectionTeacher.create({
          data: {
            subjectSectionId: subjectSectionA.id,
            teacherId: assignedTeacherUserId,
          },
        });

        const unassignedTeacherUser = await prisma.user.create({
          data: {
            code: 9300002,
            schoolId: schoolAId,
            userType: UserType.TEACHER,
            name: 'معلم غير مسند - المدرسة أ',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        unassignedTeacherUserId = unassignedTeacherUser.id;
        await prisma.teacher.create({
          data: { userId: unassignedTeacherUserId },
        });

        // طالب مشترك في المدرسة A
        const subStudentUser = await prisma.user.create({
          data: {
            code: 9300003,
            schoolId: schoolAId,
            userType: UserType.STUDENT,
            name: 'طالب مشترك - المدرسة أ',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        subscribedStudentUserId = subStudentUser.id;
        subscribedStudentUuid = subStudentUser.uuid;
        await prisma.student.create({
          data: { userId: subscribedStudentUserId },
        });
        await prisma.studentEnrollment.create({
          data: {
            studentId: subscribedStudentUserId,
            yearId: yearAId,
            gradeId: gradeA.id,
            sectionId: sectionAId,
            isCurrent: true,
            status: 'ACTIVE',
          },
        });
        await prisma.studentAccessPeriod.create({
          data: {
            schoolId: schoolAId,
            studentUserId: subscribedStudentUserId,
            periodType: 'TRIAL' as any,
            startedAt: new Date(Date.now() - 86_400_000),
            expiresAt: new Date(Date.now() + 30 * 86_400_000),
          },
        });

        // طالب غير مشترك في المدرسة A
        const unsubStudentUser = await prisma.user.create({
          data: {
            code: 9300004,
            schoolId: schoolAId,
            userType: UserType.STUDENT,
            name: 'طالب غير مشترك - المدرسة أ',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        unsubscribedStudentUserId = unsubStudentUser.id;
        unsubscribedStudentUuid = unsubStudentUser.uuid;
        await prisma.student.create({
          data: { userId: unsubscribedStudentUserId },
        });

        // طالب في المدرسة B
        const schoolBStudentUser = await prisma.user.create({
          data: {
            code: 9300005,
            schoolId: schoolBId,
            userType: UserType.STUDENT,
            name: 'طالب - المدرسة ب',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        schoolBStudentUserId = schoolBStudentUser.id;
        schoolBStudentUuid = schoolBStudentUser.uuid;
        await prisma.student.create({
          data: { userId: schoolBStudentUserId },
        });

        const platformAdmin = await prisma.platformUser.create({
          data: {
            username: `plat_admin_${runId.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`,
            email: `plat-admin-${runId}@asas.local`,
            name: 'مدير المنصة P4-7B',
            passwordHash: 'hash',
            role: PlatformRole.PLATFORM_ADMIN,
            isActive: true,
          },
        });
        platformAdminId = platformAdmin.id;
      });

      afterAll(async () => {
        if (r2Provider) {
          for (const key of r2Provider.createdRemoteKeys) {
            if (key.startsWith(`${runPrefix}/`)) {
              await r2Provider.deleteObject(key).catch(() => undefined);
            }
          }
          r2Provider.onModuleDestroy();
        }

        if (prisma) {
          await prisma.$disconnect().catch(() => undefined);
        }

        if (dbCreated && tempDbName) {
          assertSafeTestDb(tempDbName);
          await execFileAsync('psql', [
            '-h',
            'localhost',
            '-p',
            '5432',
            '-d',
            'postgres',
            '-c',
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${tempDbName}';`,
          ]).catch(() => undefined);
          await execFileAsync('dropdb', [
            '-h',
            'localhost',
            '-p',
            '5432',
            '--if-exists',
            tempDbName,
          ]).catch(() => undefined);
        }

        if (prevFfmpegBin === undefined) delete process.env.MEDIA_FFMPEG_BIN;
        else process.env.MEDIA_FFMPEG_BIN = prevFfmpegBin;

        if (prevFfprobeBin === undefined) delete process.env.MEDIA_FFPROBE_BIN;
        else process.env.MEDIA_FFPROBE_BIN = prevFfprobeBin;

        if (prevStoragePath === undefined)
          delete process.env.MEDIA_STORAGE_PATH;
        else process.env.MEDIA_STORAGE_PATH = prevStoragePath;

        if (tmpDir) {
          await fsp
            .rm(tmpDir, { recursive: true, force: true })
            .catch(() => undefined);
        }

        metricsReport.finishedAt = new Date().toISOString();
        const metricsPath =
          process.env.P4_7B_METRICS_OUT ?? '/tmp/p4-7b-metrics.json';
        await fsp
          .writeFile(
            metricsPath,
            JSON.stringify(metricsReport, null, 2),
            'utf8',
          )
          .catch(() => undefined);
      });

      it('FFMPEG-B0 (Part 2): يتحقق من جاهزية ثنائيات ffmpeg و ffprobe الفعلية والمشفرات المطلوبة (libx264, aac, libwebp)', async () => {
        const t0 = Date.now();
        const [ffmpegVer, ffprobeVer, encodersOut, muxersOut, filtersOut] =
          await Promise.all([
            execFileAsync(ffmpegBin, ['-version']),
            execFileAsync(ffprobeBin, ['-version']),
            execFileAsync(ffmpegBin, ['-encoders']),
            execFileAsync(ffmpegBin, ['-muxers']),
            execFileAsync(ffmpegBin, ['-filters']),
          ]);

        const ffmpegVersionLine = ffmpegVer.stdout.split(/\r?\n/)[0] ?? '';
        const ffprobeVersionLine = ffprobeVer.stdout.split(/\r?\n/)[0] ?? '';

        expect(ffmpegVersionLine).toContain('ffmpeg version');
        expect(ffprobeVersionLine).toContain('ffprobe version');
        expect(encodersOut.stdout).toMatch(/\blibx264\b/);
        expect(encodersOut.stdout).toMatch(/\baac\b/);
        expect(encodersOut.stdout).toMatch(/\blibwebp\b/);
        expect(muxersOut.stdout).toMatch(/\bmp4\b/);
        expect(muxersOut.stdout).toMatch(/\bwebp\b/);
        expect(filtersOut.stdout).toMatch(/\bscale\b/);
        expect(filtersOut.stdout).toMatch(/\bfps\b/);

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B0'] = {
          durationMs: Date.now() - t0,
          ffmpegBin,
          ffprobeBin,
          ffmpegVersionLine,
          ffprobeVersionLine,
          encodersVerified: ['libx264', 'aac', 'libwebp'],
          muxersVerified: ['mp4', 'webp'],
          filtersVerified: ['scale', 'fps'],
          http501Retryable: false,
        };
      });

      it('FFMPEG-B1: يفحص العينات الأربع عبر FfprobeService الفعلي ويرفض ملف MP4 صوتي زائف ذرياً في completeSession بـ 422 NO_VIDEO_TRACK', async () => {
        const t0 = Date.now();
        const [probe1080, probe480Silent, probe720Long, probeFake] =
          await Promise.all([
            ffprobe.probe(fixture1080pPath),
            ffprobe.probe(fixture480pSilentMovPath),
            ffprobe.probe(fixture720pLongPath),
            ffprobe.probe(fixtureAudioOnlyFakeMp4Path),
          ]);

        expect(probe1080.valid).toBe(true);
        expect(probe1080.info?.width).toBe(1920);
        expect(probe1080.info?.height).toBe(1080);
        expect(probe1080.info?.videoCodec).toBe('h264');
        expect(probe1080.info?.audioCodec).toBe('aac');
        expect(probe1080.info?.isSilent).toBe(false);

        expect(probe480Silent.valid).toBe(true);
        expect(probe480Silent.info?.width).toBe(640);
        expect(probe480Silent.info?.height).toBe(480);
        expect(probe480Silent.info?.isSilent).toBe(true);
        expect(probe480Silent.info?.audioCodec).toBeNull();

        expect(probe720Long.valid).toBe(true);
        expect(probe720Long.info?.width).toBe(1280);
        expect(probe720Long.info?.height).toBe(720);
        expect(probe720Long.info?.durationSec).toBeGreaterThanOrEqual(11.5);

        expect(probeFake.valid).toBe(false);
        expect(probeFake.errors.join(' ')).toContain('NO_VIDEO_TRACK');

        // رفع ملف MP4 الصوتي الزائف عبر خدمة الرفع الحقيقية والتحقق من الرفض الذري في completeSession
        const fakeDigest = await computeFileDigest(fixtureAudioOnlyFakeMp4Path);
        const fakeBuf = await fsp.readFile(fixtureAudioOnlyFakeMp4Path);
        const initFake = await schoolUploadService.initSession(
          {
            kind: MediaKind.VIDEO,
            filename: 'audio-only-fake.mp4',
            totalSizeBytes: fakeDigest.sizeBytes,
            contentType: 'video/mp4',
          } as any,
          schoolAId,
          schoolAUuid,
          { userId: assignedTeacherUserId, role: 'TEACHER' },
        );
        await schoolUploadService.uploadChunk(
          initFake.upload_session_uuid,
          schoolAId,
          `bytes 0-${fakeBuf.length - 1}/${fakeBuf.length}`,
          fakeBuf,
          assignedTeacherUserId,
        );

        let caught422: HttpException | null = null;
        try {
          await schoolUploadService.completeSession(
            initFake.upload_session_uuid,
            schoolAId,
            schoolAUuid,
            assignedTeacherUserId,
          );
        } catch (err) {
          if (err instanceof HttpException) {
            caught422 = err;
          } else {
            throw err;
          }
        }
        expect(caught422).not.toBeNull();
        expect(caught422!.getStatus()).toBe(422);
        const errBody = caught422!.getResponse() as Record<string, any>;
        expect(errBody.error).toBe('INVALID_VIDEO');
        expect(errBody.code).toBe('VIDEO_VALIDATION_FAILED');
        expect(
          Array.isArray(errBody.details) &&
            errBody.details.some((d: string) => d.startsWith('NO_VIDEO_TRACK')),
        ).toBe(true);

        const canceledSession = await prisma.mediaUploadSession.findUnique({
          where: { uuid: initFake.upload_session_uuid },
          include: { mediaAsset: true },
        });
        expect(canceledSession?.status).toBe(MediaUploadStatus.CANCELED);
        expect(canceledSession?.lastError).toContain('NO_VIDEO_TRACK');
        expect(canceledSession?.mediaAsset?.isDeleted).toBe(true);
        if (canceledSession?.mediaAssetId) {
          createdAssetIds.push(canceledSession.mediaAssetId);
        }

        const jobsForFake = await prisma.mediaProcessingJob.count({
          where: { mediaAssetId: canceledSession?.mediaAssetId ?? -1 },
        });
        expect(jobsForFake).toBe(0);

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B1'] = {
          durationMs: Date.now() - t0,
          probe1080: probe1080.info,
          probe480Silent: probe480Silent.info,
          probe720Long: probe720Long.info,
          probeFakeErrors: probeFake.errors,
          fakeSessionStatus: canceledSession?.status,
          fakeAssetIsDeleted: canceledSession?.mediaAsset?.isDeleted,
          jobsCreatedForFake: jobsForFake,
        };
      });

      it('FFMPEG-B2 (E2E-1): رحلة معلم المدرسة والطالب الكاملة (1080p 16:9 بصوت → 360p/480p/720p + thumb.webp + ready/ على R2 + ربط درس + مزامنة W-049 + تنزيل 206 Range + عزل 403/404)', async () => {
        const t0 = Date.now();

        // 1. المعلم غير المسند يُرفض بـ 403 عند محاولة بدء جلسة رفع فيديو
        const fixtureDigest = await computeFileDigest(fixture1080pPath);
        await expect(
          schoolUploadService.initSession(
            {
              kind: MediaKind.VIDEO,
              filename: 'unassigned.mp4',
              totalSizeBytes: fixtureDigest.sizeBytes,
              contentType: 'video/mp4',
            } as any,
            schoolAId,
            schoolAUuid,
            { userId: unassignedTeacherUserId, role: 'TEACHER' },
          ),
        ).rejects.toThrow(ForbiddenException);

        // 2. المعلم المسند يرفع ملف 1080p على أجزاء ويكمل الجلسة (202 Accepted)
        const { completeRes } = await uploadFileViaSchoolService(
          fixture1080pPath,
          'lesson-1080p-intro.mp4',
          'video/mp4',
        );
        expect(completeRes.processing_status).toBe('PROCESSING');
        const assetUuid = completeRes.media_asset_uuid;

        const assetBefore = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        createdAssetIds.push(assetBefore.id);
        expect(assetBefore.processingStatus).toBe(ProcessingStatus.PROCESSING);

        // 3. تشغيل العامل الحقيقي لتحويل الفيديو عبر FFmpeg ورفع المخرجات الخمسة إلى R2
        const tTranscodeStart = Date.now();
        const processed = await worker.processNextJobOnce();
        const transcodeMs = Date.now() - tTranscodeStart;
        expect(processed.claimed).toBe(true);

        const assetAfter = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        expect(assetAfter.processingStatus).toBe(ProcessingStatus.DONE);
        expect(assetAfter.width).toBe(1920);
        expect(assetAfter.height).toBe(1080);

        const manifest = parseVariantsManifest(assetAfter.variantsJson);
        expect(manifest.quality_ladder).toEqual([360, 480, 720]);
        expect(manifest.preferred_variant).toBe('480p');
        expect(manifest.thumb?.status).toBe('VERIFIED');
        expect(manifest.thumb?.etag).toBeTruthy();
        expect(manifest.source?.location).toBe('READY');
        expect(manifest.source?.status).toBe('VERIFIED');
        expect(manifest.source?.etag).toBeTruthy();

        // التحقق من حذف ملف الاستقبال المحلي بعد اكتمال المعالجة
        await expect(
          fsp.stat(storage.getVideoStagingDir(assetUuid)),
        ).rejects.toThrow();

        // 4. تنزيل المخرجات الخمسة من حاوية R2 وفحصها بـ ffprobe الفعلي والتحقق من SHA-256 و +faststart
        const inspectDir = path.join(tmpDir, 'inspect-b2');
        const variantInspections: Record<string, unknown> = {};

        for (const [tier, expectedDims] of [
          ['360p', { w: 640, h: 360 }],
          ['480p', { w: 854, h: 480 }],
          ['720p', { w: 1280, h: 720 }],
        ] as const) {
          const rec = manifest.variants[tier];
          expect(rec).toBeDefined();
          expect(rec.status).toBe('VERIFIED');
          expect(rec.width).toBe(expectedDims.w);
          expect(rec.height).toBe(expectedDims.h);
          expect(rec.etag).toBeTruthy();

          const head = await r2Provider.headObject(rec.storage_key);
          expect(head.kind).toBe('FOUND');
          if (head.kind === 'FOUND') {
            expect(head.info.sizeBytes).toBe(rec.size_bytes);
            expect(head.info.etag).toBe(rec.etag);
          }

          const localOut = path.join(inspectDir, `${tier}.mp4`);
          const stream = await r2Provider.getObjectStream(rec.storage_key);
          const dlDigest = await downloadStreamToFile(stream, localOut);
          expect(dlDigest.sizeBytes).toBe(rec.size_bytes);
          expect(dlDigest.sha256Hex).toBe(rec.sha256);

          // فحص ffprobe الفعلي على النسخة المنزّلة من R2
          const rawProbe = await execFileAsync(ffprobeBin, [
            '-v',
            'quiet',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            localOut,
          ]);
          const parsedProbe = JSON.parse(rawProbe.stdout);
          const vStream = parsedProbe.streams.find(
            (s: any) => s.codec_type === 'video',
          );
          const aStream = parsedProbe.streams.find(
            (s: any) => s.codec_type === 'audio',
          );

          expect(vStream.codec_name).toBe('h264');
          expect(String(vStream.profile).toLowerCase()).toContain('main');
          expect(vStream.pix_fmt).toBe('yuv420p');
          expect(vStream.width).toBe(expectedDims.w);
          expect(vStream.height).toBe(expectedDims.h);

          expect(aStream).toBeDefined();
          expect(aStream.codec_name).toBe('aac');
          expect(Number(aStream.sample_rate)).toBe(48000);
          expect(Number(aStream.channels)).toBe(2);

          // إثبات +faststart (ذرة moov تسبق ذرة mdat)
          const atoms = await parseMp4TopLevelBoxes(localOut);
          expect(atoms.moovOffset).toBeGreaterThanOrEqual(0);
          expect(atoms.mdatOffset).toBeGreaterThan(atoms.moovOffset);

          variantInspections[tier] = {
            storageKey: rec.storage_key,
            sizeBytes: rec.size_bytes,
            sha256: rec.sha256,
            etag: rec.etag,
            width: vStream.width,
            height: vStream.height,
            profile: vStream.profile,
            pixFmt: vStream.pix_fmt,
            audioCodec: aStream.codec_name,
            sampleRate: Number(aStream.sample_rate),
            channels: Number(aStream.channels),
            moovOffset: atoms.moovOffset,
            mdatOffset: atoms.mdatOffset,
          };
        }

        // فحص الصورة المصغرة thumb.webp المنزّلة من R2
        const thumbRec = manifest.thumb!;
        const localThumb = path.join(inspectDir, 'thumb.webp');
        const thumbStream = await r2Provider.getObjectStream(
          thumbRec.storage_key,
        );
        const thumbDigest = await downloadStreamToFile(thumbStream, localThumb);
        expect(thumbDigest.sizeBytes).toBe(thumbRec.size_bytes);
        expect(thumbDigest.sha256Hex).toBe(thumbRec.sha256);

        const thumbBytes = await fsp.readFile(localThumb);
        expect(thumbBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(thumbBytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
        const thumbProbe = await execFileAsync(ffprobeBin, [
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_streams',
          localThumb,
        ]);
        const thumbStreamInfo = JSON.parse(thumbProbe.stdout).streams[0];
        expect(thumbStreamInfo.codec_name).toBe('webp');
        expect(thumbStreamInfo.width).toBe(640);
        expect(thumbStreamInfo.height).toBe(360);

        // فحص الملف الأصلي في video-sources/ready/
        const srcRec = manifest.source!;
        const headSrc = await r2Provider.headObject(srcRec.storage_key);
        expect(headSrc.kind).toBe('FOUND');
        expect(srcRec.sha256).toBe(fixtureDigest.sha256Hex);
        expect(srcRec.size_bytes).toBe(fixtureDigest.sizeBytes);

        // 5. ربط الفيديو وصورة بدرس منشور في المدرسة A والتحقق من مزامنة الطالب (W-049 & W-030)
        const imageAsset = await prisma.mediaAsset.create({
          data: {
            schoolId: schoolAId,
            ownerType: 'SCHOOL',
            kind: MediaKind.IMAGE,
            storageProvider: 'LOCAL',
            contentType: 'image/png',
            processingStatus: ProcessingStatus.DONE,
          },
        });

        const tplA = await prisma.lessonTemplate.create({
          data: {
            ownerType: 'SCHOOL',
            schoolId: schoolAId,
            title: 'درس العلوم التفاعلي بالفيديو',
            orderIndex: 1,
          },
        });
        const blockA = await prisma.lessonContentBlock.create({
          data: {
            templateId: tplA.id,
            title: 'فقرة الفيديو',
            orderIndex: 1,
          },
        });

        await prisma.$transaction(async (tx) => {
          const lockedVideo = await lifecycle.resolveAndLockAssetForLink(tx, {
            assetUuid,
            expectedKind: 'VIDEO',
            targetOwnerType: 'SCHOOL',
            schoolId: schoolAId,
          });
          const itemVideo = await tx.lessonBlockItem.create({
            data: {
              blockId: blockA.id,
              itemType: 'VIDEO',
              orderIndex: 1,
              mediaAssetId: lockedVideo.id,
            },
          });
          createdLessonBlockItemIds.push(itemVideo.id);

          const itemImage = await tx.lessonBlockItem.create({
            data: {
              blockId: blockA.id,
              itemType: 'IMAGE',
              orderIndex: 2,
              mediaAssetId: imageAsset.id,
            },
          });
          createdLessonBlockItemIds.push(itemImage.id);
        });

        const lessonA = await prisma.lesson.create({
          data: {
            templateId: tplA.id,
            schoolId: schoolAId,
            teacherId: assignedTeacherUserId,
            subjectId: subjectAId,
            yearId: yearAId,
            termId: termAId,
            status: 'PUBLISHED',
          },
        });
        await prisma.lessonTarget.create({
          data: {
            lessonId: lessonA.id,
            sectionId: sectionAId,
            publishedAt: new Date(),
          },
        });

        const syncPullRes = await studentSyncService.pull(
          schoolAId,
          subscribedStudentUuid,
          { cursors: { lessons: null } } as any,
        );
        const syncedLesson = syncPullRes.data.lessons.items.find(
          (l: any) => l.uuid === lessonA.uuid,
        );
        expect(syncedLesson).toBeDefined();
        // W-049: mediaAssetUuids يحتوي الصورة فقط ويستثني الفيديو
        expect(syncedLesson.mediaAssetUuids).toContain(imageAsset.uuid);
        expect(syncedLesson.mediaAssetUuids).not.toContain(assetUuid);
        const syncedVideoItem = syncedLesson.contentBlocks[0].items.find(
          (i: any) => i.itemType === 'VIDEO',
        );
        expect(syncedVideoItem.mediaAssetUuid).toBe(assetUuid);
        expect(syncedVideoItem.mediaVariants).toBeDefined();
        expect(syncedVideoItem.mediaVariants['480p']).toBeDefined();
        expect(syncedVideoItem.mediaVariants.thumb).toBeDefined();
        expect(JSON.stringify(syncedVideoItem.mediaVariants)).not.toContain(
          'storage_key',
        );

        // 6. التحقق من نقاط التسليم (/status, /download-url, Range 206 + If-Match, وعزل 403/404)
        const statusRes = await mediaController.getStatus(assetUuid, {
          schoolContext: { id: schoolAId },
          user: { sub: subscribedStudentUuid, ut: 'STUDENT' },
        });
        expect(statusRes.processing_status).toBe('DONE');
        expect(statusRes.variants_ready).toEqual(['360p', '480p', '720p']);
        expect(statusRes.preferred_variant).toBe('480p');

        // منع البث المباشر عبر الخادم لأصول R2 (409 USE_DOWNLOAD_URL)
        await expect(
          mediaController.download(
            assetUuid,
            '480p',
            undefined,
            undefined,
            {
              schoolContext: { id: schoolAId },
              user: { sub: subscribedStudentUuid, ut: 'STUDENT' },
            },
            {} as any,
          ),
        ).rejects.toThrow(ConflictException);

        // الطالب المشترك يحصل على رابط موقّع وينفذ طلب HTTP Range + If-Match فعلي ضد R2
        const dlRes = await mediaController.getDownloadUrl(assetUuid, '480p', {
          schoolContext: { id: schoolAId },
          user: { sub: subscribedStudentUuid, ut: 'STUDENT' },
        });
        expect(dlRes.variant).toBe('480p');
        expect(dlRes.etag).toBe(manifest.variants['480p'].etag);
        expect(dlRes.size_bytes).toBe(manifest.variants['480p'].size_bytes);

        const rangeEnd = Math.min(16383, dlRes.size_bytes - 1);
        const expectedRangeLen = rangeEnd + 1;
        const rangeResp = await fetch(dlRes.url, {
          headers: {
            Range: `bytes=0-${rangeEnd}`,
            'If-Match': dlRes.etag ?? '',
          },
        });
        expect(rangeResp.status).toBe(206);
        expect(rangeResp.headers.get('content-range')).toBe(
          `bytes 0-${rangeEnd}/${dlRes.size_bytes}`,
        );
        const rangeBuf = Buffer.from(await rangeResp.arrayBuffer());
        expect(rangeBuf.length).toBe(expectedRangeLen);

        const local480Buf = await fsp.readFile(
          path.join(inspectDir, '480p.mp4'),
        );
        expect(createHash('sha256').update(rangeBuf).digest('hex')).toBe(
          createHash('sha256')
            .update(local480Buf.subarray(0, expectedRangeLen))
            .digest('hex'),
        );

        // الطالب غير المشترك في المدرسة A يُرفض بـ 403 SUBSCRIPTION_INACTIVE
        await expect(
          mediaController.getDownloadUrl(assetUuid, '480p', {
            schoolContext: { id: schoolAId },
            user: { sub: unsubscribedStudentUuid, ut: 'STUDENT' },
          }),
        ).rejects.toThrow(ForbiddenException);

        // مستخدم في المدرسة B يُرفض بـ 404 ASSET_NOT_FOUND
        await expect(
          mediaController.getDownloadUrl(assetUuid, '480p', {
            schoolContext: { id: schoolBId },
            user: { sub: schoolBStudentUuid, ut: 'STUDENT' },
          }),
        ).rejects.toThrow(NotFoundException);

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B2'] = {
          durationMs: Date.now() - t0,
          transcodeMs,
          assetUuid,
          qualityLadder: manifest.quality_ladder,
          preferredVariant: manifest.preferred_variant,
          variants: variantInspections,
          thumb: {
            storageKey: thumbRec.storage_key,
            sizeBytes: thumbRec.size_bytes,
            sha256: thumbRec.sha256,
            width: thumbStreamInfo.width,
            height: thumbStreamInfo.height,
          },
          sourceReady: {
            storageKey: srcRec.storage_key,
            sizeBytes: srcRec.size_bytes,
            sha256: srcRec.sha256,
          },
          range206VerifiedBytes: rangeBuf.length,
          syncExcludedVideoFromMediaAssetUuids: true,
        };
      });

      it('FFMPEG-B3: يحول فيديو 480p صامت بنسبة 4:3 بصيغة QuickTime (.mov) دون تضخيم (No Upscaling → [360, 480]) مع أبعاد زوجية (480x360 و 640x480) وصفر مسارات صوتية', async () => {
        const t0 = Date.now();
        const { completeRes } = await uploadFileViaSchoolService(
          fixture480pSilentMovPath,
          'silent-4x3-480p.mov',
          'video/quicktime',
        );
        const assetUuid = completeRes.media_asset_uuid;
        const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        createdAssetIds.push(assetRow.id);

        const processed = await worker.processNextJobOnce();
        expect(processed.claimed).toBe(true);

        const updated = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        expect(updated.processingStatus).toBe(ProcessingStatus.DONE);

        const manifest = parseVariantsManifest(updated.variantsJson);
        expect(manifest.quality_ladder).toEqual([360, 480]);
        expect(manifest.preferred_variant).toBe('480p');
        expect(manifest.variants['720p']).toBeUndefined();

        // التحقق من عدم وجود كائن 720p على R2
        const head720 = await r2Provider.headObject(
          `media/${schoolAUuid}/${assetUuid}/f1/720p.mp4`,
        );
        expect(head720.kind).toBe('NOT_FOUND');

        const inspectDir = path.join(tmpDir, 'inspect-b3');
        for (const [tier, expectedDims] of [
          ['360p', { w: 480, h: 360 }],
          ['480p', { w: 640, h: 480 }],
        ] as const) {
          const rec = manifest.variants[tier];
          expect(rec).toBeDefined();
          expect(rec.width).toBe(expectedDims.w);
          expect(rec.height).toBe(expectedDims.h);
          expect(rec.width % 2).toBe(0);
          expect(rec.height % 2).toBe(0);

          const localOut = path.join(inspectDir, `${tier}.mp4`);
          const stream = await r2Provider.getObjectStream(rec.storage_key);
          await downloadStreamToFile(stream, localOut);

          const probeRes = await ffprobe.probe(localOut);
          expect(probeRes.valid).toBe(true);
          expect(probeRes.info?.width).toBe(expectedDims.w);
          expect(probeRes.info?.height).toBe(expectedDims.h);
          expect(probeRes.info?.isSilent).toBe(true);
          expect(probeRes.info?.audioCodec).toBeNull();

          const atoms = await parseMp4TopLevelBoxes(localOut);
          expect(atoms.moovOffset).toBeGreaterThanOrEqual(0);
          expect(atoms.mdatOffset).toBeGreaterThan(atoms.moovOffset);
        }

        // التحقق من أبعاد الصورة المصغرة 4:3 (640x480) وامتداد المصدر .mov في ready/
        const localThumb = path.join(inspectDir, 'thumb.webp');
        const thumbStream = await r2Provider.getObjectStream(
          manifest.thumb!.storage_key,
        );
        await downloadStreamToFile(thumbStream, localThumb);
        const thumbProbe = await execFileAsync(ffprobeBin, [
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_streams',
          localThumb,
        ]);
        const thumbInfo = JSON.parse(thumbProbe.stdout).streams[0];
        expect(thumbInfo.width).toBe(640);
        expect(thumbInfo.height).toBe(480);

        expect(manifest.source?.ext).toBe('mov');
        expect(manifest.source?.storage_key).toBe(
          `video-sources/ready/${schoolAUuid}/${assetUuid}/f1/original.mov`,
        );
        const headReadyMov = await r2Provider.headObject(
          manifest.source!.storage_key,
        );
        expect(headReadyMov.kind).toBe('FOUND');

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B3'] = {
          durationMs: Date.now() - t0,
          assetUuid,
          qualityLadder: manifest.quality_ladder,
          variant360Dims: `${manifest.variants['360p'].width}x${manifest.variants['360p'].height}`,
          variant480Dims: `${manifest.variants['480p'].width}x${manifest.variants['480p'].height}`,
          thumbDims: `${thumbInfo.width}x${thumbInfo.height}`,
          sourceKey: manifest.source?.storage_key,
          head720pKind: head720.kind,
        };
      });

      it('FFMPEG-B4 (E2E-2): رحلة فيديو المنصة والتوزيع والاستنساخ (Policy A) وإلغاء التوزيع دون نسخ كائنات R2', async () => {
        const t0 = Date.now();
        const digest = await computeFileDigest(fixture1080pPath);
        const fileBuf = await fsp.readFile(fixture1080pPath);
        const platformActor = {
          platformUserId: platformAdminId,
          role: PlatformRole.PLATFORM_ADMIN,
        };

        const initPlat = await platformUploadService.initSession(
          {
            kind: MediaKind.VIDEO,
            filename: 'platform-master.mp4',
            totalSizeBytes: digest.sizeBytes,
            contentType: 'video/mp4',
          } as any,
          platformActor,
        );
        const platChunkSize = initPlat.chunk_size_bytes || 1_048_576;
        for (let offset = 0; offset < fileBuf.length; offset += platChunkSize) {
          const end = Math.min(offset + platChunkSize, fileBuf.length) - 1;
          const chunk = fileBuf.subarray(offset, end + 1);
          await platformUploadService.uploadChunk(
            initPlat.upload_session_uuid,
            `bytes ${offset}-${end}/${fileBuf.length}`,
            chunk,
            platformActor,
          );
        }
        const completePlat = await platformUploadService.completeSession(
          initPlat.upload_session_uuid,
          platformActor,
        );
        const platformAssetUuid = completePlat.media_asset_uuid;

        const processed = await worker.processNextJobOnce();
        expect(processed.claimed).toBe(true);

        const platformAsset = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: platformAssetUuid },
        });
        createdAssetIds.push(platformAsset.id);
        expect(platformAsset.ownerType).toBe('PLATFORM');
        expect(platformAsset.schoolId).toBeNull();
        expect(platformAsset.processingStatus).toBe(ProcessingStatus.DONE);

        const manifest = parseVariantsManifest(platformAsset.variantsJson);
        expect(manifest.variants['480p'].storage_key).toBe(
          `media/platform/${platformAssetUuid}/f1/480p.mp4`,
        );
        expect(manifest.source?.storage_key).toBe(
          `video-sources/ready/platform/${platformAssetUuid}/f1/original.mp4`,
        );

        // ربط الفيديو بقالب درس منصة رسمي
        const platformTpl = await prisma.lessonTemplate.create({
          data: {
            ownerType: 'PLATFORM',
            schoolId: null,
            title: 'قالب درس منصة رسمي P4-7B',
            orderIndex: 1,
          },
        });
        const platformBlock = await prisma.lessonContentBlock.create({
          data: {
            templateId: platformTpl.id,
            title: 'فقرة منصة',
            orderIndex: 1,
          },
        });
        const platItem = await prisma.lessonBlockItem.create({
          data: {
            blockId: platformBlock.id,
            itemType: 'VIDEO',
            orderIndex: 1,
            mediaAssetId: platformAsset.id,
          },
        });
        createdLessonBlockItemIds.push(platItem.id);

        // قبل التوزيع: المدرسة A والمدرسة B تحصلان على 404
        await expect(
          mediaController.getDownloadUrl(platformAssetUuid, '480p', {
            schoolContext: { id: schoolAId },
            user: { sub: assignedTeacherUuid, ut: 'TEACHER' },
          }),
        ).rejects.toThrow(NotFoundException);

        // إنشاء توزيع نشط للمدرسة A فقط
        const dist = await prisma.contentDistribution.create({
          data: {
            schoolId: schoolAId,
            sourceLessonTemplateId: platformTpl.id,
            distributedByPlatformUserId: platformAdminId,
            status: DistributionStatus.ACTIVE,
          },
        });

        const dlDuringDist = await mediaController.getDownloadUrl(
          platformAssetUuid,
          '480p',
          {
            schoolContext: { id: schoolAId },
            user: { sub: assignedTeacherUuid, ut: 'TEACHER' },
          },
        );
        expect(dlDuringDist.variant).toBe('480p');

        // المدرسة B تظل ممنوعة بـ 404
        await expect(
          mediaController.getDownloadUrl(platformAssetUuid, '480p', {
            schoolContext: { id: schoolBId },
            user: { sub: schoolBStudentUuid, ut: 'TEACHER' },
          }),
        ).rejects.toThrow(NotFoundException);

        // استنساخ الدرس إلى المدرسة A (Policy A) مع مشاركة نفس mediaAssetId دون نسخ كائنات R2
        const remoteKeyCountBeforeFork = r2Provider.createdRemoteKeys.size;
        const clonedTpl = await prisma.lessonTemplate.create({
          data: {
            ownerType: 'SCHOOL',
            schoolId: schoolAId,
            sourceTemplateId: platformTpl.id,
            title: 'نسخة المدرسة أ المستنسخة',
            orderIndex: 2,
          },
        });
        const clonedBlock = await prisma.lessonContentBlock.create({
          data: {
            templateId: clonedTpl.id,
            title: 'فقرة مستنسخة',
            orderIndex: 1,
          },
        });
        const clonedItem = await prisma.lessonBlockItem.create({
          data: {
            blockId: clonedBlock.id,
            itemType: 'VIDEO',
            orderIndex: 1,
            mediaAssetId: platformAsset.id,
          },
        });
        createdLessonBlockItemIds.push(clonedItem.id);
        expect(r2Provider.createdRemoteKeys.size).toBe(
          remoteKeyCountBeforeFork,
        );

        // إلغاء التوزيع الرسمي (REVOKED) — المدرسة A تظل قادرة على الوصول بفضل Policy A
        await prisma.contentDistribution.update({
          where: { id: dist.id },
          data: { status: DistributionStatus.REVOKED },
        });

        const dlAfterRevoke = await mediaController.getDownloadUrl(
          platformAssetUuid,
          '480p',
          {
            schoolContext: { id: schoolAId },
            user: { sub: assignedTeacherUuid, ut: 'TEACHER' },
          },
        );
        expect(dlAfterRevoke.variant).toBe('480p');

        await expect(
          mediaController.getDownloadUrl(platformAssetUuid, '480p', {
            schoolContext: { id: schoolBId },
            user: { sub: schoolBStudentUuid, ut: 'TEACHER' },
          }),
        ).rejects.toThrow(NotFoundException);

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B4'] = {
          durationMs: Date.now() - t0,
          platformAssetUuid,
          r2KeysCopiedOnFork:
            r2Provider.createdRemoteKeys.size - remoteKeyCountBeforeFork,
          policyAAccessAfterRevoke: true,
          schoolBIsolated404: true,
        };
      });

      it('FFMPEG-B5: يستأنف المعالجة على مستوى الخطوة (f1 → f2) مع التحقق من الحجم و ETag على R2 وينظف مفاتيح الجيل اليتيم (f1/480p.mp4)', async () => {
        const t0 = Date.now();
        const { completeRes } = await uploadFileViaSchoolService(
          fixture1080pPath,
          'resume-f1-f2.mp4',
          'video/mp4',
        );
        const assetUuid = completeRes.media_asset_uuid;
        const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        createdAssetIds.push(assetRow.id);

        // 1. الجيل الأول (f1): يكمل thumb و 360p على R2، ويبدأ كتابة 480p (write_initiated=true, write_settled=false) ثم يفقد الإيجار
        const claimedF1 = await queue.claimNextJob(
          'worker-f1',
          config.workerLeaseSec,
        );
        expect(claimedF1).not.toBeNull();
        expect(BigInt(claimedF1!.fencing_token)).toBe(1n);
        const ctxF1 = {
          jobId: claimedF1!.id,
          workerId: 'worker-f1',
          fencingToken: 1n,
        };

        const origEncode = (
          transcodeProcessor as any
        ).encodeQualityVariant.bind(transcodeProcessor);
        const encodeSpyF1 = jest
          .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
          .mockImplementation(async (params: any) => {
            if (params.spec.quality === '480p') {
              // محاكاة رفع كائن يتيم غير مستقر تحت f1/480p.mp4 قبل انتهاء الإيجار
              const orphanKey = `media/${schoolAUuid}/${assetUuid}/f1/480p.mp4`;
              await queue.markGenerationWriteInitiated(ctxF1, orphanKey);
              await r2Provider.uploadFromFile(fixture1080pPath, orphanKey, {
                contentType: 'video/mp4',
              });
              // إنهاء صلاحية إيجار f1 واسترداده ليفشل f1 بـ LeaseLostError
              await prisma.mediaProcessingJob.update({
                where: { id: claimedF1!.id },
                data: { leaseUntil: new Date(Date.now() - 10_000) },
              });
              await queue.recoverStaleLeases();
            }
            return origEncode(params);
          });

        await transcodeProcessor.processClaimedJob(claimedF1!, ctxF1);
        encodeSpyF1.mockRestore();

        // إثبات أن أي كتابة متأخرة من f1 تُرفض بـ LeaseLostError
        await expect(
          queue.runFencedMutation(ctxF1, async () => 'should-fail'),
        ).rejects.toThrow(LeaseLostError);

        // التحقق من وجود الكائن اليتيم f1/480p.mp4 والكائنين المعتمدين f1/thumb.webp و f1/360p.mp4 على R2
        const f1ThumbKey = `media/${schoolAUuid}/${assetUuid}/f1/thumb.webp`;
        const f1Variant360Key = `media/${schoolAUuid}/${assetUuid}/f1/360p.mp4`;
        const f1Orphan480Key = `media/${schoolAUuid}/${assetUuid}/f1/480p.mp4`;
        expect((await r2Provider.headObject(f1ThumbKey)).kind).toBe('FOUND');
        expect((await r2Provider.headObject(f1Variant360Key)).kind).toBe(
          'FOUND',
        );
        expect((await r2Provider.headObject(f1Orphan480Key)).kind).toBe(
          'FOUND',
        );

        // 2. الجيل الثاني (f2): يستأنف من 480p دون إعادة ترميز thumb أو 360p بعد تطابق الحجم و ETag على R2
        await prisma.mediaProcessingJob.update({
          where: { id: claimedF1!.id },
          data: { nextRetryAt: new Date(Date.now() - 1_000) },
        });

        const extractThumbSpyF2 = jest.spyOn(
          transcodeProcessor as any,
          'extractThumbnail',
        );
        const encodedQualitiesInF2: string[] = [];
        const encodeSpyF2 = jest
          .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
          .mockImplementation(async (params: any) => {
            encodedQualitiesInF2.push(params.spec.quality);
            return origEncode(params);
          });

        const processedF2 = await worker.processNextJobOnce();
        expect(processedF2.claimed).toBe(true);
        expect(extractThumbSpyF2).not.toHaveBeenCalled();
        expect(encodedQualitiesInF2).toEqual(['480p', '720p']);

        extractThumbSpyF2.mockRestore();
        encodeSpyF2.mockRestore();

        const assetDone = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        expect(assetDone.processingStatus).toBe(ProcessingStatus.DONE);
        const manifestDone = parseVariantsManifest(assetDone.variantsJson);
        expect(manifestDone.thumb?.storage_key).toBe(f1ThumbKey);
        expect(manifestDone.variants['360p'].storage_key).toBe(f1Variant360Key);
        expect(manifestDone.variants['480p'].storage_key).toBe(
          `media/${schoolAUuid}/${assetUuid}/f2/480p.mp4`,
        );
        expect(manifestDone.variants['720p'].storage_key).toBe(
          `media/${schoolAUuid}/${assetUuid}/f2/720p.mp4`,
        );

        // 3. تشغيل ماسح الأيتام (runPeriodicSweepOnce) والتحقق من حذف f1/480p.mp4 وبقاء f1/thumb و f1/360p و f2/*
        await worker.runPeriodicSweepOnce();

        expect((await r2Provider.headObject(f1Orphan480Key)).kind).toBe(
          'NOT_FOUND',
        );
        expect((await r2Provider.headObject(f1ThumbKey)).kind).toBe('FOUND');
        expect((await r2Provider.headObject(f1Variant360Key)).kind).toBe(
          'FOUND',
        );
        expect(
          (
            await r2Provider.headObject(
              `media/${schoolAUuid}/${assetUuid}/f2/480p.mp4`,
            )
          ).kind,
        ).toBe('FOUND');

        const jobAfterSweep = await prisma.mediaProcessingJob.findUniqueOrThrow(
          { where: { id: claimedF1!.id } },
        );
        const stepStateAfterSweep = parseJobStepState(
          jobAfterSweep.stepStateJson,
        );
        expect(
          stepStateAfterSweep.generations_registry?.['1']
            ?.reconciliation_status,
        ).toBe('VERIFIED_ABSENT');

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B5'] = {
          durationMs: Date.now() - t0,
          assetUuid,
          reusedFromF1: [f1ThumbKey, f1Variant360Key],
          encodedInF2: encodedQualitiesInF2,
          sweptOrphanKey: f1Orphan480Key,
          orphanHeadAfterSweep: 'NOT_FOUND',
          generation1Status:
            stepStateAfterSweep.generations_registry?.['1']
              ?.reconciliation_status,
        };
      });

      it('FFMPEG-B6 (E2E-3): قتل حقيقي لعملية العامل (SIGKILL) أثناء عمل ffmpeg الفعلي والتحقق على مستوى نظام التشغيل من توقف workerPid و ffmpegPid قبل بدء الجيل f2', async () => {
        const t0 = Date.now();
        const { completeRes } = await uploadFileViaSchoolService(
          fixture720pLongPath,
          'sigkill-720p-12s.mp4',
          'video/mp4',
        );
        const assetUuid = completeRes.media_asset_uuid;
        const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        createdAssetIds.push(assetRow.id);

        const jobRow = await prisma.mediaProcessingJob.findFirstOrThrow({
          where: { mediaAssetId: assetRow.id, jobType: 'TRANSCODE_VIDEO' },
        });

        const childScriptPath = path.resolve(
          __dirname,
          './p4-7b-sigkill-child-worker.ts',
        );
        const tsNodeRegisterPath = path.resolve(
          PROJECT_ROOT,
          'node_modules/ts-node/register/transpile-only',
        );

        let capturedWorkerPid = 0;
        let capturedFfmpegPid = 0;
        let midEncodeBytes = 0;

        const childEnv: NodeJS.ProcessEnv = {
          ...process.env,
          ...fileVars,
          DATABASE_URL: tempDbUrl,
          MEDIA_STORAGE_PATH: tmpDir,
          MEDIA_FFMPEG_BIN: ffmpegBin,
          MEDIA_FFPROBE_BIN: ffprobeBin,
          P4_7B_CHILD_DB_URL: tempDbUrl,
          P4_7B_CHILD_RUN_PREFIX: runPrefix,
          P4_7B_CHILD_JOB_ID: String(jobRow.id),
        };
        for (const prodKey of AMBIENT_PROD_R2_ENV_VARS) {
          delete childEnv[prodKey];
        }

        const childProc = spawn(
          process.execPath,
          ['-r', tsNodeRegisterPath, childScriptPath],
          {
            cwd: PROJECT_ROOT,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );

        let childStderr = '';
        childProc.stderr?.on('data', (chunk: Buffer) => {
          childStderr += chunk.toString('utf8');
        });

        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(
                new Error(
                  `Timeout waiting for MID_ENCODE from child worker. stderr=${childStderr}`,
                ),
              );
            }, 60_000);

            let stdoutBuf = '';
            childProc.stdout?.on('data', (chunk: Buffer) => {
              stdoutBuf += chunk.toString('utf8');
              const lines = stdoutBuf.split(/\r?\n/);
              stdoutBuf = lines.pop() ?? '';
              for (const line of lines) {
                if (line.startsWith('CHILD_R2_KEY:')) {
                  const key = line.slice('CHILD_R2_KEY:'.length).trim();
                  if (key) r2Provider.createdRemoteKeys.add(key);
                } else if (line.startsWith('MID_ENCODE:')) {
                  const parts = line.trim().split(':');
                  capturedWorkerPid = Number(parts[1]);
                  capturedFfmpegPid = Number(parts[2]);
                  midEncodeBytes = Number(parts[3] ?? '0');
                  clearTimeout(timeout);
                  resolve();
                }
              }
            });

            childProc.once('exit', (code, sig) => {
              if (!capturedFfmpegPid) {
                clearTimeout(timeout);
                reject(
                  new Error(
                    `Child worker exited prematurely (code=${String(code)}, sig=${String(sig)}): ${childStderr}`,
                  ),
                );
              }
            });
          });

          expect(capturedWorkerPid).toBeGreaterThan(0);
          expect(capturedFfmpegPid).toBeGreaterThan(0);
          expect(capturedFfmpegPid).not.toBe(capturedWorkerPid);

          // إثبات أن كلتا العمليتين حيتان قبل إرسال SIGKILL
          expect(isProcessAlive(capturedWorkerPid)).toBe(true);
          expect(isProcessAlive(capturedFfmpegPid)).toBe(true);

          // إرسال SIGKILL إلى عملية العامل الأب فقط (workerPid) دون لمس ffmpegPid مباشرة
          const tKill = Date.now();
          process.kill(capturedWorkerPid, 'SIGKILL');

          // مراقبة توقف كلتا العمليتين على مستوى نظام التشغيل (ESRCH) قبل بدء الجيل الثاني f2
          let bothDeadElapsedMs = -1;
          for (let i = 0; i < 100; i++) {
            const wAlive = isProcessAlive(capturedWorkerPid);
            const fAlive = isProcessAlive(capturedFfmpegPid);
            if (!wAlive && !fAlive) {
              bothDeadElapsedMs = Date.now() - tKill;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }

          const workerStillAlive = isProcessAlive(capturedWorkerPid);
          const ffmpegStillAlive = isProcessAlive(capturedFfmpegPid);

          // قاعدة chat312.md الحاكمة: إذا بقي ffmpegPid حياً يجب أن يفشل الاختبار فوراً
          expect(workerStillAlive).toBe(false);
          expect(ffmpegStillAlive).toBe(false);
          expect(bothDeadElapsedMs).toBeGreaterThanOrEqual(0);

          // استرداد الإيجار المنتهي وتشغيل الجيل الثاني (f2) حتى الوصول إلى DONE
          await prisma.mediaProcessingJob.update({
            where: { id: jobRow.id },
            data: { leaseUntil: new Date(Date.now() - 10_000) },
          });
          const recoveredRes = await queue.recoverStaleLeases();
          expect(recoveredRes.recoveredToRetrying).toBeGreaterThanOrEqual(1);

          await prisma.mediaProcessingJob.update({
            where: { id: jobRow.id },
            data: { nextRetryAt: new Date(Date.now() - 1_000) },
          });

          const processedF2 = await worker.processNextJobOnce();
          expect(processedF2.claimed).toBe(true);

          const finalAsset = await prisma.mediaAsset.findUniqueOrThrow({
            where: { uuid: assetUuid },
          });
          expect(finalAsset.processingStatus).toBe(ProcessingStatus.DONE);

          const finalManifest = parseVariantsManifest(finalAsset.variantsJson);
          // إثبات أن f2 أعاد استخدام thumb و 360p من الجيل الأول (f1) وأنتج 480p و 720p تحت f2
          expect(finalManifest.thumb?.storage_key).toBe(
            `media/${schoolAUuid}/${assetUuid}/f1/thumb.webp`,
          );
          expect(finalManifest.variants['360p'].storage_key).toBe(
            `media/${schoolAUuid}/${assetUuid}/f1/360p.mp4`,
          );
          expect(finalManifest.variants['480p'].storage_key).toBe(
            `media/${schoolAUuid}/${assetUuid}/f2/480p.mp4`,
          );
          expect(finalManifest.variants['720p'].storage_key).toBe(
            `media/${schoolAUuid}/${assetUuid}/f2/720p.mp4`,
          );

          await worker.runPeriodicSweepOnce();

          // التحقق من حذف مجلد الاستقبال المحلي بعد اكتمال f2
          await expect(
            fsp.stat(storage.getVideoStagingDir(assetUuid)),
          ).rejects.toThrow();

          (metricsReport.tests as Record<string, unknown>)['FFMPEG-B6'] = {
            durationMs: Date.now() - t0,
            assetUuid,
            workerPid: capturedWorkerPid,
            ffmpegPid: capturedFfmpegPid,
            midEncodeBytesWhenKilled: midEncodeBytes,
            bothProcessesTerminatedWithinMs: bothDeadElapsedMs,
            workerAliveBeforeF2: workerStillAlive,
            ffmpegAliveBeforeF2: ffmpegStillAlive,
            f2ReusedF1ThumbAnd360p: true,
            finalProcessingStatus: finalAsset.processingStatus,
          };
        } finally {
          // تنظيف دفاعي للآلة فقط إذا بقيت أي عملية حية عند فشل الاختبار
          if (capturedWorkerPid > 0 && isProcessAlive(capturedWorkerPid)) {
            try {
              process.kill(capturedWorkerPid, 'SIGKILL');
            } catch {
              // ignore
            }
          }
          if (capturedFfmpegPid > 0 && isProcessAlive(capturedFfmpegPid)) {
            try {
              process.kill(capturedFfmpegPid, 'SIGKILL');
            } catch {
              // ignore
            }
          }
        }
      });

      it('FFMPEG-B7: يرفع الملف الأصلي إلى video-sources/hold/ على R2 ويتحقق من SHA-256 عند الفشل النهائي قبل حذف ملف الاستقبال المحلي', async () => {
        const t0 = Date.now();
        const { digest, completeRes } = await uploadFileViaSchoolService(
          fixture1080pPath,
          'terminal-failure-hold.mp4',
          'video/mp4',
        );
        const assetUuid = completeRes.media_asset_uuid;
        const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: assetUuid },
        });
        createdAssetIds.push(assetRow.id);

        const jobRow = await prisma.mediaProcessingJob.findFirstOrThrow({
          where: { mediaAssetId: assetRow.id, jobType: 'TRANSCODE_VIDEO' },
        });
        await prisma.mediaProcessingJob.update({
          where: { id: jobRow.id },
          data: { attemptCount: 3, maxAttempts: 4 },
        });

        const encodeSpy = jest
          .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
          .mockRejectedValue(
            new DeterministicTranscodeError(
              'SIMULATED_TERMINAL_ENCODE_FAILURE',
            ),
          );

        const processed = await worker.processNextJobOnce();
        encodeSpy.mockRestore();
        expect(processed.claimed).toBe(true);

        const failedJob = await prisma.mediaProcessingJob.findUniqueOrThrow({
          where: { id: jobRow.id },
        });
        const failedAsset = await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: assetRow.id },
        });
        expect(failedJob.status).toBe('FAILED');
        expect(failedAsset.processingStatus).toBe(ProcessingStatus.ERROR);

        const manifest = parseVariantsManifest(failedAsset.variantsJson);
        const holdKey = `video-sources/hold/${schoolAUuid}/${assetUuid}/f1/original.mp4`;
        expect(manifest.source?.location).toBe('HOLD');
        expect(manifest.source?.storage_key).toBe(holdKey);
        expect(manifest.source?.sha256).toBe(digest.sha256Hex);

        const headHold = await r2Provider.headObject(holdKey);
        expect(headHold.kind).toBe('FOUND');
        if (headHold.kind === 'FOUND') {
          expect(headHold.info.sizeBytes).toBe(digest.sizeBytes);
        }

        // التحقق من حذف مجلد الاستقبال المحلي بعد تأكيد رفع hold/
        await expect(
          fsp.stat(storage.getVideoStagingDir(assetUuid)),
        ).rejects.toThrow();

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B7'] = {
          durationMs: Date.now() - t0,
          assetUuid,
          jobStatus: failedJob.status,
          assetProcessingStatus: failedAsset.processingStatus,
          holdKey,
          holdSizeBytes: digest.sizeBytes,
          holdSha256: digest.sha256Hex,
          localStagingDeletedAfterHold: true,
        };
      });

      it('FFMPEG-B8: ينفذ دورة الحذف الإنتاجية الكاملة (P4-6) ويتحقق من عدم بقاء أي كائن تحت بادئة التشغيل الحالي p4-7b/<run-id>/', async () => {
        const t0 = Date.now();

        // 1. فك ربط جميع عناصر الدروس الاختبارية (تصفير المراجع النشطة)
        await prisma.lessonBlockItem.updateMany({
          where: { id: { in: createdLessonBlockItemIds } },
          data: { isDeleted: true, deletedAt: new Date() },
        });

        // 2. تشغيل تنظيف الأصول غير المرتبطة لتتحول جميعها إلى isDeleted = true
        await prisma.$transaction(async (tx) => {
          await lifecycle.lockMediaAssetsForUpdate(tx, createdAssetIds);
          await lifecycle.reconcileUnlinkedAssetsUnderLock(tx, createdAssetIds);
        });

        // تقادم تاريخ الحذف الناعم (31 يوماً > 30 يوماً فترة السماح الإنتاجية)
        const expiredDeletedAt = new Date(Date.now() - 31 * 86_400_000);
        await prisma.mediaAsset.updateMany({
          where: { id: { in: createdAssetIds } },
          data: { isDeleted: true, deletedAt: expiredDeletedAt },
        });

        // 3. جدولة مهام DELETE_OBJECTS عبر MediaCleanupService الإنتاجي
        const enqueuedCount = await cleanupService.scheduleDeleteObjectsJobs();
        expect(enqueuedCount).toBeGreaterThanOrEqual(6);

        // 4. تشغيل العامل لمعالجة جميع مهام DELETE_OBJECTS حتى تفرغ القائمة مع التقاط سجل التدقيق المهيكل MEDIA_ASSET_PURGED
        const purgedEvents: Array<Record<string, unknown>> = [];
        const loggerLogSpy = jest
          .spyOn((deleteObjectsProcessor as any).logger, 'log')
          .mockImplementation((msg: unknown) => {
            if (typeof msg === 'string' && msg.includes('MEDIA_ASSET_PURGED')) {
              try {
                purgedEvents.push(JSON.parse(msg) as Record<string, unknown>);
              } catch {
                // ignore
              }
            }
          });

        let deleteJobsProcessed = 0;
        while ((await worker.processNextJobOnce()).claimed) {
          deleteJobsProcessed++;
        }
        loggerLogSpy.mockRestore();
        expect(deleteJobsProcessed).toBeGreaterThanOrEqual(enqueuedCount);

        // 5. التحقق من حذف جميع صفوف الأصول الاختبارية من PostgreSQL وتسجيل MEDIA_ASSET_PURGED
        const remainingAssets = await prisma.mediaAsset.count({
          where: { id: { in: createdAssetIds } },
        });
        expect(remainingAssets).toBe(0);

        const purgedAudits = purgedEvents.length;
        expect(purgedAudits).toBeGreaterThanOrEqual(enqueuedCount);

        // 6. التحقق عبر HeadObject == 404 (NOT_FOUND) لكل مفتاح أُنشئ في هذا التشغيل تحت p4-7b/<run-id>/
        const trackedKeys = Array.from(r2Provider.createdRemoteKeys);
        expect(trackedKeys.length).toBeGreaterThan(0);

        let verified404Count = 0;
        for (const scopedKey of trackedKeys) {
          expect(scopedKey.startsWith(`${runPrefix}/`)).toBe(true);
          const head = await r2Provider.headObject(scopedKey);
          expect(head).toEqual({ kind: 'NOT_FOUND' });
          verified404Count++;
        }

        (metricsReport.tests as Record<string, unknown>)['FFMPEG-B8'] = {
          durationMs: Date.now() - t0,
          enqueuedDeleteJobs: enqueuedCount,
          deleteJobsProcessed,
          remainingAssetsInDb: remainingAssets,
          purgedAuditLogsCount: purgedAudits,
          totalTrackedKeysUnderRunPrefix: trackedKeys.length,
          verified404Count,
        };
      });
    },
  );
});
