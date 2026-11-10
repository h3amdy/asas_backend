/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
// src/shared/media/worker/video-p6-4.staging.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P6 (Stage 2) — اختبارات التكامل الحية لخط أنابيب الفيديو الخلفي (P6-4.0 .. P6-4.6)
// مرجع: docs/features/video/11-VIDEO-P6-INTEGRATION-TEST-PLAN.md (v1.5 — Approved in chat331.md)
//        docs/Sessions/11_3_11_2026/chat333.md (Stage 2 Execution Authorization)
// ═══════════════════════════════════════════════════════════════
//
// الضوابط الحاكمة المعتمدة (chat331.md & chat333.md):
// 1. ملف اختبار مستقل (video-p6-4.staging.integration.spec.ts) دون تعديل ملفات P4-7A/P4-7B أو الكود الإنتاجي.
// 2. جميع المفاتيح المنشأة على حاوية asas-media-poc تقع حصراً تحت البادئة المعزولة: p6-live-<runId>/.
// 3. بوابة فحص مسبقة إلزامية (Pre-Flight R2 Prefix Gate — P6-4.0) قبل أي اتصال فعلي بـ R2.
// 4. اختبار P6-4.4 ينفذ جزء macOS بالكامل ويسجل جزء حاوية Linux كـ PENDING / DEFERRED (DEP-5).
// 5. اختبار P6-4.6 يتضمن إثبات هوية سلسلة الحقن (4-part Object.is) وفشل R2 العابر المشروط بالمفتاح
//    في المحاولة الأولى (SIMULATED_R2_503_FIRST_ATTEMPT -> RETRYING + بقاء صف MediaAsset) ثم النجاح
//    في المحاولة الثانية والتحقق من HeadObject == 404 لكل مفتاح تحت p6-live-<runId>/.
// ═══════════════════════════════════════════════════════════════

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
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
import { createHash, randomBytes } from 'crypto';
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

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p64_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
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

describe('VIDEO P6 (Stage 2) — Backend Video Pipeline Live Integration (p6-live-<runId>/)', () => {
  (hasSandboxEnvConfigured ? describe : describe.skip)(
    'Pre-Flight R2 Prefix Gate + P6-4.1..P6-4.6 Live Suite on asas-media-poc',
    () => {
      const runId = `${formatCompactUtcTimestamp()}-${randomBytes(3).toString('hex')}`;
      const runPrefix = `p6-live-${runId}`;

      let ffmpegBin = '';
      let ffprobeBin = '';
      let prevFfmpegBin: string | undefined;
      let prevFfprobeBin: string | undefined;
      let prevStoragePath: string | undefined;

      let tempDbName = '';
      let tempDbUrl = '';
      let dbCreated = false;

      let sandboxCreds: R2Credentials & { endpoint: string };
      let r2Provider: NamespacedP6R2Provider;
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

      // مخرجات مشتركة بين خطوات P6-4.1 .. P6-4.6
      let primary1080AssetUuid = '';
      let primary1080FixtureDigest: LocalFileDigest;

      const createdLessonBlockItemIds: number[] = [];
      const createdAssetIds: number[] = [];

      const metricsReport: Record<string, unknown> = {
        stage: 'Stage 2 (Pre-Flight R2 Prefix Gate + P6-4.1..P6-4.6)',
        runId,
        runPrefix: `${runPrefix}/`,
        bucketName: '',
        startedAt: new Date().toISOString(),
        preFlightR2PrefixGate: {},
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
        // 1. فحص حارس العزل (Fail-Closed) قبل أي اتصال شبكي
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

        // 3. تجهيز قاعدة PostgreSQL اختبارية مؤقتة ومعزولة لـ P6-4
        tempDbName = `asas_video_p64_pg_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
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
          path.join(os.tmpdir(), `asas-p6-4-${runId}-`),
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

        // (1) fixture-1080p-16x9-audio.mp4 (1920x1080, 3.0s, 24fps, h264 + aac)
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
          '3.0',
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

        // 5. تهيئة VideoMediaConfig و NamespacedP6R2Provider ببادئة p6-live-<runId>
        config = new VideoMediaConfig();
        jest.spyOn(config, 'isUploadEnabled', 'get').mockReturnValue(true);
        jest.spyOn(config, 'getR2Credentials').mockReturnValue({
          accountId: sandboxCreds.accountId,
          accessKeyId: sandboxCreds.accessKeyId,
          secretAccessKey: sandboxCreds.secretAccessKey,
          bucketName: sandboxCreds.bucketName,
        });

        r2Provider = new NamespacedP6R2Provider(
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
            name: `P6-4 School A ${runId}`,
            schoolCode: 88641,
            appType: AppType.PRIVATE,
          },
        });
        schoolAId = schoolA.id;
        schoolAUuid = schoolA.uuid;

        const schoolB = await prisma.school.create({
          data: {
            name: `P6-4 School B ${runId}`,
            schoolCode: 88642,
            appType: AppType.PRIVATE,
          },
        });
        schoolBId = schoolB.id;

        await prisma.schoolSubscriptionSettings.create({
          data: {
            schoolId: schoolAId,
            isActivated: true,
            activatedAt: new Date(),
            isTrialEnabled: false,
            subscriptionPrice: 100,
            contactNumber: '777000222',
          },
        });

        const gradeDict = await prisma.gradeDictionary.create({
          data: {
            code: 'G-P64-1',
            defaultName: 'الصف الأول',
            sortOrder: 1,
          },
        });
        const subjectDict = await prisma.subjectDictionary.create({
          data: {
            gradeDictionaryId: gradeDict.id,
            code: 'SUB-P64-1',
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
            schoolId: schoolAId,
            userType: UserType.TEACHER,
            name: 'معلم مسند - P6-4 أ',
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
            schoolId: schoolAId,
            userType: UserType.TEACHER,
            name: 'معلم غير مسند - P6-4 أ',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        unassignedTeacherUserId = unassignedTeacherUser.id;
        await prisma.teacher.create({
          data: { userId: unassignedTeacherUserId },
        });

        const subStudentUser = await prisma.user.create({
          data: {
            schoolId: schoolAId,
            userType: UserType.STUDENT,
            name: 'طالب مشترك - P6-4 أ',
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

        const unsubStudentUser = await prisma.user.create({
          data: {
            schoolId: schoolAId,
            userType: UserType.STUDENT,
            name: 'طالب غير مشترك - P6-4 أ',
            passwordHash: 'hash',
            isActive: true,
          },
        });
        unsubscribedStudentUserId = unsubStudentUser.id;
        unsubscribedStudentUuid = unsubStudentUser.uuid;
        await prisma.student.create({
          data: { userId: unsubscribedStudentUserId },
        });

        const schoolBStudentUser = await prisma.user.create({
          data: {
            schoolId: schoolBId,
            userType: UserType.STUDENT,
            name: 'طالب - P6-4 ب',
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
            username: `plat_p64_${runId.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`,
            email: `plat-p64-${runId}@asas.local`,
            name: 'مدير المنصة P6-4',
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
          process.env.P6_4_METRICS_OUT ?? '/tmp/p6-4-metrics.json';
        await fsp
          .writeFile(
            metricsPath,
            JSON.stringify(metricsReport, null, 2),
            'utf8',
          )
          .catch(() => undefined);
      });

      it('P6-4.0 (Pre-Flight R2 Prefix Gate): يتحقق قبل أي اتصال شبكي بـ R2 من عزل البادئة p6-live-<runId>/ ورفض أي مفتاح خارجها أو متغير إنتاجي R2_*', async () => {
        const t0 = Date.now();

        // 1. التأكد من عدم إجراء أي اتصال شبكي بـ R2 حتى هذه اللحظة
        expect(r2Provider.createdRemoteKeys.size).toBe(0);

        // 2. حارس العزل Fail-Closed ضد أي متغير إنتاجي R2_*
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

        // 3. التحقق من صيغة runId وبادئة p6-live-<runId>/
        expect(runId).toMatch(/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{6}$/);
        expect(runPrefix).toBe(`p6-live-${runId}`);

        // 4. فحص مفاتيح المصدر والمخرجات العينية قبل أي اتصال فعلي بـ R2
        const sampleAssetUuid = '00000000-0000-4000-8000-000000000001';
        const sampleReadySourceKey = r2Provider.toScopedKey(
          `video-sources/ready/${schoolAUuid}/${sampleAssetUuid}/f1/original.mp4`,
        );
        const sampleHoldSourceKey = r2Provider.toScopedKey(
          `video-sources/hold/${schoolAUuid}/${sampleAssetUuid}/f1/original.mp4`,
        );
        const sampleOutput480Key = r2Provider.toScopedKey(
          `media/${schoolAUuid}/${sampleAssetUuid}/f1/480p.mp4`,
        );
        const sampleOutputThumbKey = r2Provider.toScopedKey(
          `media/${schoolAUuid}/${sampleAssetUuid}/f1/thumb.webp`,
        );

        for (const key of [
          sampleReadySourceKey,
          sampleHoldSourceKey,
          sampleOutput480Key,
          sampleOutputThumbKey,
        ]) {
          expect(key.startsWith(`${runPrefix}/`)).toBe(true);
          expect(() => r2Provider.assertUnderRunPrefix(key)).not.toThrow();
        }

        // 5. إثبات أن الحارس assertUnderRunPrefix يرمي SANDBOX_PREFIX_VIOLATION فوراً لأي مفتاح خارج البادئة
        let thrownLegacyViolation = '';
        try {
          r2Provider.assertUnderRunPrefix(
            'media/school-uuid/asset-uuid/f1/480p.mp4',
          );
        } catch (err) {
          thrownLegacyViolation = (err as Error).message;
        }
        expect(thrownLegacyViolation).toContain('SANDBOX_PREFIX_VIOLATION');

        let thrownP47bViolation = '';
        try {
          r2Provider.assertUnderRunPrefix(
            `p4-7b/${runId}/media/${schoolAUuid}/${sampleAssetUuid}/f1/480p.mp4`,
          );
        } catch (err) {
          thrownP47bViolation = (err as Error).message;
        }
        expect(thrownP47bViolation).toContain('SANDBOX_PREFIX_VIOLATION');

        // 6. التحقق من جاهزية ثنائيات ffmpeg و ffprobe الحقيقية
        const [ffmpegVer, ffprobeVer, encodersOut] = await Promise.all([
          execFileAsync(ffmpegBin, ['-version']),
          execFileAsync(ffprobeBin, ['-version']),
          execFileAsync(ffmpegBin, ['-encoders']),
        ]);
        const ffmpegVersionLine = ffmpegVer.stdout.split(/\r?\n/)[0] ?? '';
        const ffprobeVersionLine = ffprobeVer.stdout.split(/\r?\n/)[0] ?? '';
        expect(ffmpegVersionLine).toContain('ffmpeg version');
        expect(ffprobeVersionLine).toContain('ffprobe version');
        expect(encodersOut.stdout).toMatch(/\blibx264\b/);
        expect(encodersOut.stdout).toMatch(/\baac\b/);
        expect(encodersOut.stdout).toMatch(/\blibwebp\b/);

        const notImplErr = classifyStorageError(
          { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } },
          'r2.copy',
        );
        expect(notImplErr.retryable).toBe(false);

        metricsReport.preFlightR2PrefixGate = {
          durationMs: Date.now() - t0,
          runId,
          effectivePrefix: `${runPrefix}/`,
          sampleReadySourceKey,
          sampleHoldSourceKey,
          sampleOutput480Key,
          sampleOutputThumbKey,
          prefixComplianceRatio:
            '100% (4/4 sample keys + all 7 provider methods)',
          legacyKeyRejectedError: thrownLegacyViolation,
          p47bKeyRejectedError: thrownP47bViolation,
          remoteKeysCreatedDuringPreFlight: r2Provider.createdRemoteKeys.size,
          ffmpegVersionLine,
          ffprobeVersionLine,
        };
      });

      it('P6-4.1: يختبر الرفع المجزأ للفيديو (init -> chunk 1 -> رفض جزء خارج الترتيب 409 -> probeSession -> استئناف -> complete 202) ويرفض ملف MP4 صوتي زائف ذرياً بـ 422 NO_VIDEO_TRACK', async () => {
        const t0 = Date.now();

        // 1. المعلم غير المسند يُرفض بـ 403 ForbiddenException عند محاولة بدء جلسة رفع فيديو
        primary1080FixtureDigest = await computeFileDigest(fixture1080pPath);
        await expect(
          schoolUploadService.initSession(
            {
              kind: MediaKind.VIDEO,
              filename: 'unassigned-teacher.mp4',
              totalSizeBytes: primary1080FixtureDigest.sizeBytes,
              contentType: 'video/mp4',
            } as any,
            schoolAId,
            schoolAUuid,
            { userId: unassignedTeacherUserId, role: 'TEACHER' },
          ),
        ).rejects.toThrow(ForbiddenException);

        // 2. المعلم المسند يبدأ جلسة رفع فيديو مجزأة (64KB لكل جزء لاختبار الترتيب والاستئناف)
        const fileBuf = await fsp.readFile(fixture1080pPath);
        const customChunkSize = 65_536; // 64 KB
        expect(fileBuf.length).toBeGreaterThan(customChunkSize * 2);

        const initRes = await schoolUploadService.initSession(
          {
            kind: MediaKind.VIDEO,
            filename: 'p6-4-lesson-1080p.mp4',
            totalSizeBytes: fileBuf.length,
            chunkSizeBytes: customChunkSize,
            contentType: 'video/mp4',
          } as any,
          schoolAId,
          schoolAUuid,
          { userId: assignedTeacherUserId, role: 'TEACHER' },
        );
        const sessionUuid = initRes.upload_session_uuid;

        // رفع الجزء الأول (0 .. 65535)
        const chunk1 = fileBuf.subarray(0, customChunkSize);
        const chunk1Res = await schoolUploadService.uploadChunk(
          sessionUuid,
          schoolAId,
          `bytes 0-${customChunkSize - 1}/${fileBuf.length}`,
          chunk1,
          assignedTeacherUserId,
        );
        expect(chunk1Res.bytes_received).toBe(customChunkSize);

        // محاولة إرسال جزء خارج الترتيب (تخطي الجزء الثاني وإرسال الجزء الثالث) -> يجب أن يُرفض بـ 409 ConflictException
        const outOfOrderStart = customChunkSize * 2;
        const outOfOrderEnd =
          Math.min(outOfOrderStart + customChunkSize, fileBuf.length) - 1;
        await expect(
          schoolUploadService.uploadChunk(
            sessionUuid,
            schoolAId,
            `bytes ${outOfOrderStart}-${outOfOrderEnd}/${fileBuf.length}`,
            fileBuf.subarray(outOfOrderStart, outOfOrderEnd + 1),
            assignedTeacherUserId,
          ),
        ).rejects.toThrow(ConflictException);

        // استعلام حالة الجلسة عبر probeSession والتأكد من بقاء bytes_received عند حدود الجزء الأول السليم
        const probeAfter409 = await schoolUploadService.probeSession(
          sessionUuid,
          schoolAId,
          assignedTeacherUserId,
        );
        expect(probeAfter409.status).toBe(MediaUploadStatus.UPLOADING);
        expect(probeAfter409.bytes_received).toBe(customChunkSize);

        // استئناف رفع بقية الأجزاء بالترتيب الصحيح من bytes_received حتى نهاية الملف
        let offset = probeAfter409.bytes_received;
        while (offset < fileBuf.length) {
          const slice = fileBuf.subarray(
            offset,
            Math.min(offset + customChunkSize, fileBuf.length),
          );
          const endByte = offset + slice.length - 1;
          await schoolUploadService.uploadChunk(
            sessionUuid,
            schoolAId,
            `bytes ${offset}-${endByte}/${fileBuf.length}`,
            slice,
            assignedTeacherUserId,
          );
          offset += slice.length;
        }

        // إتمام الجلسة والتحقق من فحص ffprobe الفعلي وإنشاء مهمة TRANSCODE_VIDEO (202 PROCESSING)
        const completeRes = await schoolUploadService.completeSession(
          sessionUuid,
          schoolAId,
          schoolAUuid,
          assignedTeacherUserId,
        );
        expect(completeRes.processing_status).toBe('PROCESSING');
        primary1080AssetUuid = completeRes.media_asset_uuid;

        const assetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: primary1080AssetUuid },
        });
        createdAssetIds.push(assetRow.id);
        expect(assetRow.processingStatus).toBe(ProcessingStatus.PROCESSING);

        const pendingJob = await prisma.mediaProcessingJob.findFirstOrThrow({
          where: { mediaAssetId: assetRow.id, jobType: 'TRANSCODE_VIDEO' },
        });
        expect(pendingJob.status).toBe('PENDING');

        // 3. رفع ملف MP4 صوتي زائف (بلا مسار فيديو) والتحقق من الرفض الذري بـ 422 NO_VIDEO_TRACK
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

        (metricsReport.tests as Record<string, unknown>)['P6-4.1'] = {
          durationMs: Date.now() - t0,
          primary1080AssetUuid,
          totalSizeBytes: fileBuf.length,
          chunkSizeBytes: customChunkSize,
          outOfOrderChunkRejected409: true,
          probedBytesReceivedBeforeResume: probeAfter409.bytes_received,
          completedStatus: completeRes.processing_status,
          transcodeJobStatus: pendingJob.status,
          fakeAudioOnlyRejectedStatus: 422,
          fakeSessionStatus: canceledSession?.status,
          fakeJobsCreated: jobsForFake,
        };
      });

      it('P6-4.2: يحول الفيديو عبر FFmpeg الفعلي ويرفع المخرجات إلى R2 تحت p6-live-<runId>/ (1080p بصوت -> 360p/480p/720p + thumb.webp + faststart؛ و 480p 4:3 صامت .mov دون تضخيم 720p)', async () => {
        const t0 = Date.now();

        // 0. فحص صلاحية اتصال حاوية R2 الاختبارية (HeadBucket) قبل بدء أول رفع فعلي
        try {
          const hb = await r2Provider
            .getRawClient()
            .send(new HeadBucketCommand({ Bucket: sandboxCreds.bucketName }));
          expect(hb.$metadata.httpStatusCode ?? 200).toBe(200);
        } catch (err: any) {
          const status = err?.$metadata?.httpStatusCode ?? 'UNKNOWN';
          throw new Error(
            `R2_SANDBOX_AUTH_FAILED: فشل الاتصال بحاوية R2 الاختبارية "${sandboxCreds.bucketName}" (HTTP ${String(status)}). يرجى التحقق من صلاحية أو انتهاء مفتاح R2_SANDBOX_ACCESS_KEY_ID في .env.r2-sandbox.`,
          );
        }

        // ── الجزء أ: تحويل فيديو 1080p (16:9 بصوت) المرفوع في P6-4.1 ──
        const tTranscode1080 = Date.now();
        const processed1080 = await worker.processNextJobOnce();
        const transcode1080Ms = Date.now() - tTranscode1080;
        expect(processed1080.claimed).toBe(true);

        const asset1080After = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: primary1080AssetUuid },
        });
        expect(asset1080After.processingStatus).toBe(ProcessingStatus.DONE);
        expect(asset1080After.width).toBe(1920);
        expect(asset1080After.height).toBe(1080);

        const manifest1080 = parseVariantsManifest(asset1080After.variantsJson);
        expect(manifest1080.quality_ladder).toEqual([360, 480, 720]);
        expect(manifest1080.preferred_variant).toBe('480p');
        expect(manifest1080.thumb?.status).toBe('VERIFIED');
        expect(manifest1080.thumb?.etag).toBeTruthy();

        const inspectDir1080 = path.join(tmpDir, 'inspect-p6-4-2-1080');
        const variantInspections1080: Record<string, unknown> = {};

        for (const [tier, expectedDims] of [
          ['360p', { w: 640, h: 360 }],
          ['480p', { w: 854, h: 480 }],
          ['720p', { w: 1280, h: 720 }],
        ] as const) {
          const rec = manifest1080.variants[tier];
          expect(rec).toBeDefined();
          expect(rec.status).toBe('VERIFIED');
          expect(rec.width).toBe(expectedDims.w);
          expect(rec.height).toBe(expectedDims.h);
          expect(rec.etag).toBeTruthy();

          const scopedKey = r2Provider.toScopedKey(rec.storage_key);
          expect(scopedKey.startsWith(`${runPrefix}/`)).toBe(true);
          expect(r2Provider.createdRemoteKeys.has(scopedKey)).toBe(true);

          const head = await r2Provider.headObject(rec.storage_key);
          expect(head.kind).toBe('FOUND');
          if (head.kind === 'FOUND') {
            expect(head.info.sizeBytes).toBe(rec.size_bytes);
            expect(head.info.etag).toBe(rec.etag);
          }

          const localOut = path.join(inspectDir1080, `${tier}.mp4`);
          const stream = await r2Provider.getObjectStream(rec.storage_key);
          const dlDigest = await downloadStreamToFile(stream, localOut);
          expect(dlDigest.sizeBytes).toBe(rec.size_bytes);
          expect(dlDigest.sha256Hex).toBe(rec.sha256);

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

          const atoms = await parseMp4TopLevelBoxes(localOut);
          expect(atoms.moovOffset).toBeGreaterThanOrEqual(0);
          expect(atoms.mdatOffset).toBeGreaterThan(atoms.moovOffset);

          variantInspections1080[tier] = {
            scopedStorageKey: scopedKey,
            sizeBytes: rec.size_bytes,
            sha256: rec.sha256,
            etag: rec.etag,
            width: vStream.width,
            height: vStream.height,
            moovOffset: atoms.moovOffset,
            mdatOffset: atoms.mdatOffset,
          };
        }

        const thumbRec = manifest1080.thumb!;
        const localThumb1080 = path.join(inspectDir1080, 'thumb.webp');
        const thumbStream1080 = await r2Provider.getObjectStream(
          thumbRec.storage_key,
        );
        const thumbDigest1080 = await downloadStreamToFile(
          thumbStream1080,
          localThumb1080,
        );
        expect(thumbDigest1080.sizeBytes).toBe(thumbRec.size_bytes);
        expect(thumbDigest1080.sha256Hex).toBe(thumbRec.sha256);

        const thumbBytes = await fsp.readFile(localThumb1080);
        expect(thumbBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(thumbBytes.subarray(8, 12).toString('ascii')).toBe('WEBP');

        // ── الجزء ب: تحويل فيديو 480p صامت بنسبة 4:3 (.mov) دون تضخيم (No Upscaling -> [360, 480]) ──
        const { completeRes: complete480Silent } =
          await uploadFileViaSchoolService(
            fixture480pSilentMovPath,
            'p6-4-silent-4x3-480p.mov',
            'video/quicktime',
          );
        const silentAssetUuid = complete480Silent.media_asset_uuid;
        const silentAssetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: silentAssetUuid },
        });
        createdAssetIds.push(silentAssetRow.id);

        const processedSilent = await worker.processNextJobOnce();
        expect(processedSilent.claimed).toBe(true);

        const silentUpdated = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: silentAssetUuid },
        });
        expect(silentUpdated.processingStatus).toBe(ProcessingStatus.DONE);

        const manifestSilent = parseVariantsManifest(
          silentUpdated.variantsJson,
        );
        expect(manifestSilent.quality_ladder).toEqual([360, 480]);
        expect(manifestSilent.preferred_variant).toBe('480p');
        expect(manifestSilent.variants['720p']).toBeUndefined();

        const head720Silent = await r2Provider.headObject(
          `media/${schoolAUuid}/${silentAssetUuid}/f1/720p.mp4`,
        );
        expect(head720Silent.kind).toBe('NOT_FOUND');

        const inspectDirSilent = path.join(tmpDir, 'inspect-p6-4-2-silent');
        for (const [tier, expectedDims] of [
          ['360p', { w: 480, h: 360 }],
          ['480p', { w: 640, h: 480 }],
        ] as const) {
          const rec = manifestSilent.variants[tier];
          expect(rec).toBeDefined();
          expect(rec.width).toBe(expectedDims.w);
          expect(rec.height).toBe(expectedDims.h);
          expect(rec.width % 2).toBe(0);
          expect(rec.height % 2).toBe(0);

          const localOut = path.join(inspectDirSilent, `${tier}.mp4`);
          const stream = await r2Provider.getObjectStream(rec.storage_key);
          await downloadStreamToFile(stream, localOut);

          const probeRes = await ffprobe.probe(localOut);
          expect(probeRes.valid).toBe(true);
          expect(probeRes.info?.width).toBe(expectedDims.w);
          expect(probeRes.info?.height).toBe(expectedDims.h);
          expect(probeRes.info?.isSilent).toBe(true);
          expect(probeRes.info?.audioCodec).toBeNull();
        }

        (metricsReport.tests as Record<string, unknown>)['P6-4.2'] = {
          durationMs: Date.now() - t0,
          transcode1080Ms,
          primary1080AssetUuid,
          variants1080: variantInspections1080,
          thumb1080ScopedKey: r2Provider.toScopedKey(thumbRec.storage_key),
          silent480AssetUuid: silentAssetUuid,
          silentQualityLadder: manifestSilent.quality_ladder,
          silent360Dims: `${manifestSilent.variants['360p'].width}x${manifestSilent.variants['360p'].height}`,
          silent480Dims: `${manifestSilent.variants['480p'].width}x${manifestSilent.variants['480p'].height}`,
          silent720HeadKind: head720Silent.kind,
        };
      });

      it('P6-4.3: يتحقق من حفظ الملف الأصلي على R2 في مسار النجاح (video-sources/ready/) وفي مسار الفشل الحتمي النهائي (video-sources/hold/) قبل حذف الاستقبال المحلي', async () => {
        const t0 = Date.now();

        // 1. مسار النجاح (READY): التحقق من الملف الأصلي المحفوظ لـ primary1080AssetUuid
        const asset1080 = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: primary1080AssetUuid },
        });
        const manifest1080 = parseVariantsManifest(asset1080.variantsJson);
        const readySource = manifest1080.source!;
        expect(readySource.location).toBe('READY');
        expect(readySource.status).toBe('VERIFIED');
        expect(readySource.storage_key).toBe(
          `video-sources/ready/${schoolAUuid}/${primary1080AssetUuid}/f1/original.mp4`,
        );
        expect(readySource.sha256).toBe(primary1080FixtureDigest.sha256Hex);
        expect(readySource.size_bytes).toBe(primary1080FixtureDigest.sizeBytes);

        const headReady = await r2Provider.headObject(readySource.storage_key);
        expect(headReady.kind).toBe('FOUND');
        if (headReady.kind === 'FOUND') {
          expect(headReady.info.sizeBytes).toBe(
            primary1080FixtureDigest.sizeBytes,
          );
        }

        // التأكد من حذف مجلد الاستقبال المحلي بعد تأكيد رفع READY
        await expect(
          fsp.stat(storage.getVideoStagingDir(primary1080AssetUuid)),
        ).rejects.toThrow();

        // 2. مسار الفشل النهائي (HOLD): رفع أصل جديد ومحاكاة فشل نهائي والتحقق من رفع المصدر إلى video-sources/hold/
        const { digest: holdDigest, completeRes: holdComplete } =
          await uploadFileViaSchoolService(
            fixture1080pPath,
            'p6-4-terminal-failure-hold.mp4',
            'video/mp4',
          );
        const holdAssetUuid = holdComplete.media_asset_uuid;
        const holdAssetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: holdAssetUuid },
        });
        createdAssetIds.push(holdAssetRow.id);

        const holdJobRow = await prisma.mediaProcessingJob.findFirstOrThrow({
          where: { mediaAssetId: holdAssetRow.id, jobType: 'TRANSCODE_VIDEO' },
        });
        await prisma.mediaProcessingJob.update({
          where: { id: holdJobRow.id },
          data: { attemptCount: 3, maxAttempts: 4 },
        });

        const encodeSpy = jest
          .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
          .mockRejectedValue(
            new DeterministicTranscodeError(
              'SIMULATED_TERMINAL_ENCODE_FAILURE_P6_4_3',
            ),
          );

        const processedHold = await worker.processNextJobOnce();
        encodeSpy.mockRestore();
        expect(processedHold.claimed).toBe(true);

        const failedJob = await prisma.mediaProcessingJob.findUniqueOrThrow({
          where: { id: holdJobRow.id },
        });
        const failedAsset = await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: holdAssetRow.id },
        });
        expect(failedJob.status).toBe('FAILED');
        expect(failedAsset.processingStatus).toBe(ProcessingStatus.ERROR);

        const holdManifest = parseVariantsManifest(failedAsset.variantsJson);
        const expectedHoldKey = `video-sources/hold/${schoolAUuid}/${holdAssetUuid}/f1/original.mp4`;
        expect(holdManifest.source?.location).toBe('HOLD');
        expect(holdManifest.source?.storage_key).toBe(expectedHoldKey);
        expect(holdManifest.source?.sha256).toBe(holdDigest.sha256Hex);

        const headHold = await r2Provider.headObject(expectedHoldKey);
        expect(headHold.kind).toBe('FOUND');
        if (headHold.kind === 'FOUND') {
          expect(headHold.info.sizeBytes).toBe(holdDigest.sizeBytes);
        }

        // التحقق من حذف مجلد الاستقبال المحلي بعد تأكيد رفع HOLD و SHA-256
        await expect(
          fsp.stat(storage.getVideoStagingDir(holdAssetUuid)),
        ).rejects.toThrow();

        (metricsReport.tests as Record<string, unknown>)['P6-4.3'] = {
          durationMs: Date.now() - t0,
          readyScopedKey: r2Provider.toScopedKey(readySource.storage_key),
          readySha256Verified: true,
          holdAssetUuid,
          holdScopedKey: r2Provider.toScopedKey(expectedHoldKey),
          holdSha256Verified: true,
          localStagingCleanedAfterReadyAndHold: true,
        };
      });

      it('P6-4.4 (macOS Host Execution — Linux Container Deferred on DEP-5): يستأنف على مستوى الخطوة (f1 -> f2) وينظف مفاتيح الجيل اليتيم، وينفذ قتل SIGKILL حقيقي لـ workerPid أثناء عمل ffmpeg مع إثبات موت workerPid و guardPid و ffmpegPid (ESRCH)', async () => {
        const t0 = Date.now();

        // ── الجزء 1: الاستئناف على مستوى الخطوة (f1 -> f2) وتسييج الإيجار (LeaseLostError) وتنظيف مفاتيح الجيل اليتيم ──
        const { completeRes: resumeComplete } =
          await uploadFileViaSchoolService(
            fixture1080pPath,
            'p6-4-resume-f1-f2.mp4',
            'video/mp4',
          );
        const resumeAssetUuid = resumeComplete.media_asset_uuid;
        const resumeAssetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: resumeAssetUuid },
        });
        createdAssetIds.push(resumeAssetRow.id);

        const claimedF1 = await queue.claimNextJob(
          'worker-p6-f1',
          config.workerLeaseSec,
        );
        expect(claimedF1).not.toBeNull();
        expect(BigInt(claimedF1!.fencing_token)).toBe(1n);
        const ctxF1 = {
          jobId: claimedF1!.id,
          workerId: 'worker-p6-f1',
          fencingToken: 1n,
        };

        const origEncode = (
          transcodeProcessor as any
        ).encodeQualityVariant.bind(transcodeProcessor);
        const encodeSpyF1 = jest
          .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
          .mockImplementation(async (params: any) => {
            if (params.spec.quality === '480p') {
              const orphanKey = `media/${schoolAUuid}/${resumeAssetUuid}/f1/480p.mp4`;
              await queue.markGenerationWriteInitiated(ctxF1, orphanKey);
              await r2Provider.uploadFromFile(fixture1080pPath, orphanKey, {
                contentType: 'video/mp4',
              });
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
          queue.runFencedMutation(ctxF1, async () => 'stale-f1-write'),
        ).rejects.toThrow(LeaseLostError);

        const f1ThumbKey = `media/${schoolAUuid}/${resumeAssetUuid}/f1/thumb.webp`;
        const f1Variant360Key = `media/${schoolAUuid}/${resumeAssetUuid}/f1/360p.mp4`;
        const f1Orphan480Key = `media/${schoolAUuid}/${resumeAssetUuid}/f1/480p.mp4`;
        expect((await r2Provider.headObject(f1ThumbKey)).kind).toBe('FOUND');
        expect((await r2Provider.headObject(f1Variant360Key)).kind).toBe(
          'FOUND',
        );
        expect((await r2Provider.headObject(f1Orphan480Key)).kind).toBe(
          'FOUND',
        );

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

        await worker.runPeriodicSweepOnce();
        expect((await r2Provider.headObject(f1Orphan480Key)).kind).toBe(
          'NOT_FOUND',
        );
        expect((await r2Provider.headObject(f1ThumbKey)).kind).toBe('FOUND');
        expect((await r2Provider.headObject(f1Variant360Key)).kind).toBe(
          'FOUND',
        );

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

        // ── الجزء 2: قتل SIGKILL الحقيقي لعملية العامل الأب (workerPid) أثناء عمل ffmpeg الفعلي على macOS ──
        const { completeRes: sigkillComplete } =
          await uploadFileViaSchoolService(
            fixture720pLongPath,
            'p6-4-sigkill-720p-12s.mp4',
            'video/mp4',
          );
        const sigkillAssetUuid = sigkillComplete.media_asset_uuid;
        const sigkillAssetRow = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: sigkillAssetUuid },
        });
        createdAssetIds.push(sigkillAssetRow.id);

        const sigkillJobRow = await prisma.mediaProcessingJob.findFirstOrThrow({
          where: {
            mediaAssetId: sigkillAssetRow.id,
            jobType: 'TRANSCODE_VIDEO',
          },
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
        let capturedGuardPid = 0;
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
          P4_7B_CHILD_JOB_ID: String(sigkillJobRow.id),
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
                  if (key) {
                    expect(key.startsWith(`${runPrefix}/`)).toBe(true);
                    r2Provider.createdRemoteKeys.add(key);
                  }
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

          // التقاط معرف عملية الحارس (/bin/sh pipe-EOF guardPid) التابعة لـ workerPid قبل إرسال SIGKILL
          const pgrepOut = await execFileAsync('pgrep', [
            '-P',
            String(capturedWorkerPid),
          ]).catch(() => ({ stdout: '' }));
          const childPids = pgrepOut.stdout
            .split(/\r?\n/)
            .map((s) => Number(s.trim()))
            .filter((n) => n > 0 && n !== capturedFfmpegPid);
          if (childPids.length > 0) {
            capturedGuardPid = childPids[0];
          }

          expect(isProcessAlive(capturedWorkerPid)).toBe(true);
          expect(isProcessAlive(capturedFfmpegPid)).toBe(true);

          // إرسال SIGKILL إلى عملية العامل الأب فقط (capturedWorkerPid) دون لمس ffmpegPid مباشرة
          const tKill = Date.now();
          process.kill(capturedWorkerPid, 'SIGKILL');

          // مراقبة توقف العمليات عبر bounded polling (كل 25ms حتى 2500ms)
          let allDeadElapsedMs = -1;
          for (let i = 0; i < 100; i++) {
            const wAlive = isProcessAlive(capturedWorkerPid);
            const fAlive = isProcessAlive(capturedFfmpegPid);
            const gAlive =
              capturedGuardPid > 0 ? isProcessAlive(capturedGuardPid) : false;
            if (!wAlive && !fAlive && !gAlive) {
              allDeadElapsedMs = Date.now() - tKill;
              break;
            }
            await new Promise((r) => setTimeout(r, 25));
          }

          const workerStillAlive = isProcessAlive(capturedWorkerPid);
          const ffmpegStillAlive = isProcessAlive(capturedFfmpegPid);
          const guardStillAlive =
            capturedGuardPid > 0 ? isProcessAlive(capturedGuardPid) : false;

          expect(workerStillAlive).toBe(false);
          expect(ffmpegStillAlive).toBe(false);
          expect(guardStillAlive).toBe(false);
          expect(allDeadElapsedMs).toBeGreaterThanOrEqual(0);
          expect(allDeadElapsedMs).toBeLessThanOrEqual(2500);

          // استرداد الإيجار المنتهي وتشغيل الجيل الثاني (f2) حتى الوصول إلى DONE
          await prisma.mediaProcessingJob.update({
            where: { id: sigkillJobRow.id },
            data: { leaseUntil: new Date(Date.now() - 10_000) },
          });
          const recoveredRes = await queue.recoverStaleLeases();
          expect(recoveredRes.recoveredToRetrying).toBeGreaterThanOrEqual(1);

          await prisma.mediaProcessingJob.update({
            where: { id: sigkillJobRow.id },
            data: { nextRetryAt: new Date(Date.now() - 1_000) },
          });

          const processedSigkillF2 = await worker.processNextJobOnce();
          expect(processedSigkillF2.claimed).toBe(true);

          const finalSigkillAsset = await prisma.mediaAsset.findUniqueOrThrow({
            where: { uuid: sigkillAssetUuid },
          });
          expect(finalSigkillAsset.processingStatus).toBe(
            ProcessingStatus.DONE,
          );

          const finalSigkillManifest = parseVariantsManifest(
            finalSigkillAsset.variantsJson,
          );
          expect(finalSigkillManifest.thumb?.storage_key).toBe(
            `media/${schoolAUuid}/${sigkillAssetUuid}/f1/thumb.webp`,
          );
          expect(finalSigkillManifest.variants['360p'].storage_key).toBe(
            `media/${schoolAUuid}/${sigkillAssetUuid}/f1/360p.mp4`,
          );
          expect(finalSigkillManifest.variants['480p'].storage_key).toBe(
            `media/${schoolAUuid}/${sigkillAssetUuid}/f2/480p.mp4`,
          );
          expect(finalSigkillManifest.variants['720p'].storage_key).toBe(
            `media/${schoolAUuid}/${sigkillAssetUuid}/f2/720p.mp4`,
          );

          await worker.runPeriodicSweepOnce();

          (metricsReport.tests as Record<string, unknown>)['P6-4.4'] = {
            durationMs: Date.now() - t0,
            macOsExecutionStatus: 'PASS',
            linuxContainerExecutionStatus: 'PENDING_DEFERRED_DEP_5',
            stepResumeAssetUuid: resumeAssetUuid,
            reusedFromF1: [f1ThumbKey, f1Variant360Key],
            encodedInF2: encodedQualitiesInF2,
            sweptOrphanKey: r2Provider.toScopedKey(f1Orphan480Key),
            generation1ReconciliationStatus:
              stepStateAfterSweep.generations_registry?.['1']
                ?.reconciliation_status,
            sigkillAssetUuid,
            workerPid: capturedWorkerPid,
            guardPid: capturedGuardPid,
            ffmpegPid: capturedFfmpegPid,
            midEncodeBytesWhenKilled: midEncodeBytes,
            allProcessesTerminatedWithinMs: allDeadElapsedMs,
            orphanFfmpegProcessesRemaining: 0,
            sigkillFinalStatus: finalSigkillAsset.processingStatus,
          };
        } finally {
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

      it('P6-4.5: يتحقق من الروابط الموقعة وتنزيل 206 Partial Content على جزأين مع تطابق SHA-256، ورفض If-Match الخاطئ بـ 412، ورفض النطاق خارج الحدود بـ 416، وعزل المستأجرين والاشتراكات و Policy A', async () => {
        const t0 = Date.now();

        const asset1080 = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: primary1080AssetUuid },
        });
        const manifest1080 = parseVariantsManifest(asset1080.variantsJson);

        // 1. ربط الفيديو وصورة بدرس منشور في المدرسة A والتحقق من مزامنة الطالب (W-049)
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
            title: 'درس العلوم التفاعلي P6-4.5',
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
            assetUuid: primary1080AssetUuid,
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
        expect(syncedLesson.mediaAssetUuids).toContain(imageAsset.uuid);
        expect(syncedLesson.mediaAssetUuids).not.toContain(
          primary1080AssetUuid,
        );

        // 2. الحصول على الرابط الموقّع للطالب المشترك وتنفيذ تنزيل مجزأ على جزأين (206 Partial Content) مع إعادة التجميع ومطابقة SHA-256
        const dlRes = await mediaController.getDownloadUrl(
          primary1080AssetUuid,
          '480p',
          {
            schoolContext: { id: schoolAId },
            user: { sub: subscribedStudentUuid, ut: 'STUDENT' },
          },
        );
        expect(dlRes.variant).toBe('480p');
        expect(dlRes.etag).toBe(manifest1080.variants['480p'].etag);
        expect(dlRes.size_bytes).toBe(manifest1080.variants['480p'].size_bytes);

        const totalSize = dlRes.size_bytes;
        const splitPoint = Math.floor(totalSize / 2);

        const respPart1 = await fetch(dlRes.url, {
          headers: {
            Range: `bytes=0-${splitPoint - 1}`,
            'If-Match': dlRes.etag ?? '',
          },
        });
        expect(respPart1.status).toBe(206);
        expect(respPart1.headers.get('content-range')).toBe(
          `bytes 0-${splitPoint - 1}/${totalSize}`,
        );
        const bufPart1 = Buffer.from(await respPart1.arrayBuffer());
        expect(bufPart1.length).toBe(splitPoint);

        const respPart2 = await fetch(dlRes.url, {
          headers: {
            Range: `bytes=${splitPoint}-${totalSize - 1}`,
            'If-Match': dlRes.etag ?? '',
          },
        });
        expect(respPart2.status).toBe(206);
        expect(respPart2.headers.get('content-range')).toBe(
          `bytes ${splitPoint}-${totalSize - 1}/${totalSize}`,
        );
        const bufPart2 = Buffer.from(await respPart2.arrayBuffer());
        expect(bufPart2.length).toBe(totalSize - splitPoint);

        const reassembledBuf = Buffer.concat([bufPart1, bufPart2]);
        expect(reassembledBuf.length).toBe(totalSize);
        const reassembledSha256 = createHash('sha256')
          .update(reassembledBuf)
          .digest('hex');
        expect(reassembledSha256).toBe(manifest1080.variants['480p'].sha256);

        // 3. طلب بـ If-Match خاطئ -> يجب أن يعيد R2 حالة 412 Precondition Failed
        const respWrongEtag = await fetch(dlRes.url, {
          headers: {
            Range: 'bytes=0-1023',
            'If-Match': '"00000000000000000000000000000000"',
          },
        });
        expect(respWrongEtag.status).toBe(412);

        // 4. طلب Range خارج حدود الملف -> يجب أن يعيد R2 حالة 416 Range Not Satisfiable
        const respOutOfBounds = await fetch(dlRes.url, {
          headers: {
            Range: `bytes=${totalSize + 100000}-${totalSize + 200000}`,
          },
        });
        expect(respOutOfBounds.status).toBe(416);

        // 5. عزل الاشتراكات والمستأجرين (403 للطالب غير المشترك، 404 لمدرسة أخرى)
        await expect(
          mediaController.getDownloadUrl(primary1080AssetUuid, '480p', {
            schoolContext: { id: schoolAId },
            user: { sub: unsubscribedStudentUuid, ut: 'STUDENT' },
          }),
        ).rejects.toThrow(ForbiddenException);

        await expect(
          mediaController.getDownloadUrl(primary1080AssetUuid, '480p', {
            schoolContext: { id: schoolBId },
            user: { sub: schoolBStudentUuid, ut: 'STUDENT' },
          }),
        ).rejects.toThrow(NotFoundException);

        // 6. فيديو المنصة والتوزيع والاستنساخ (Policy A) دون نسخ كائنات R2
        const digestPlat = await computeFileDigest(fixture1080pPath);
        const platBuf = await fsp.readFile(fixture1080pPath);
        const platformActor = {
          platformUserId: platformAdminId,
          role: PlatformRole.PLATFORM_ADMIN,
        };
        const initPlat = await platformUploadService.initSession(
          {
            kind: MediaKind.VIDEO,
            filename: 'p6-4-platform-master.mp4',
            totalSizeBytes: digestPlat.sizeBytes,
            contentType: 'video/mp4',
          } as any,
          platformActor,
        );
        const platChunkSize = initPlat.chunk_size_bytes || 1_048_576;
        for (let offset = 0; offset < platBuf.length; offset += platChunkSize) {
          const end = Math.min(offset + platChunkSize, platBuf.length) - 1;
          const chunk = platBuf.subarray(offset, end + 1);
          await platformUploadService.uploadChunk(
            initPlat.upload_session_uuid,
            `bytes ${offset}-${end}/${platBuf.length}`,
            chunk,
            platformActor,
          );
        }
        const completePlat = await platformUploadService.completeSession(
          initPlat.upload_session_uuid,
          platformActor,
        );
        const platformAssetUuid = completePlat.media_asset_uuid;

        const processedPlat = await worker.processNextJobOnce();
        expect(processedPlat.claimed).toBe(true);

        const platformAsset = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: platformAssetUuid },
        });
        createdAssetIds.push(platformAsset.id);

        const platformTpl = await prisma.lessonTemplate.create({
          data: {
            ownerType: 'PLATFORM',
            schoolId: null,
            title: 'قالب درس منصة رسمي P6-4.5',
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

        const dist = await prisma.contentDistribution.create({
          data: {
            schoolId: schoolAId,
            sourceLessonTemplateId: platformTpl.id,
            distributedByPlatformUserId: platformAdminId,
            status: DistributionStatus.ACTIVE,
          },
        });

        const remoteKeyCountBeforeFork = r2Provider.createdRemoteKeys.size;
        const clonedTpl = await prisma.lessonTemplate.create({
          data: {
            ownerType: 'SCHOOL',
            schoolId: schoolAId,
            sourceTemplateId: platformTpl.id,
            title: 'نسخة المدرسة أ المستنسخة P6-4.5',
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

        (metricsReport.tests as Record<string, unknown>)['P6-4.5'] = {
          durationMs: Date.now() - t0,
          rangePart1Bytes: bufPart1.length,
          rangePart2Bytes: bufPart2.length,
          reassembledBytes: reassembledBuf.length,
          reassembledSha256MatchesManifest: true,
          wrongIfMatchStatus: respWrongEtag.status,
          outOfBoundsRangeStatus: respOutOfBounds.status,
          unsubscribedStudentRejected403: true,
          otherSchoolRejected404: true,
          policyAClonedR2KeysCopied:
            r2Provider.createdRemoteKeys.size - remoteKeyCountBeforeFork,
        };
      });

      it('P6-4.6: ينفذ دورة الحذف الكاملة (DELETE_OBJECTS) مع إثبات هوية سلسلة الحقن (4-part Object.is) وفشل R2 العابر المشروط بالمفتاح في المحاولة 1 ثم النجاح في المحاولة 2 والتحقق من 404 لكل مفتاح تحت p6-live-<runId>/', async () => {
        const t0 = Date.now();

        // 1. إثبات هوية سلسلة الحقن الكاملة من العامل إلى مزود R2 (4-part Fail-Fast Identity Assertions — v1.5)
        expect(
          Object.is(
            (worker as any).deleteObjectsProcessor,
            deleteObjectsProcessor,
          ),
        ).toBe(true);
        expect(
          Object.is((deleteObjectsProcessor as any).storageRegistry, registry),
        ).toBe(true);
        expect(Object.is(registry.get('R2'), r2Provider)).toBe(true);
        expect(
          Object.is(
            (deleteObjectsProcessor as any).storageRegistry.get('R2'),
            r2Provider,
          ),
        ).toBe(true);

        // 2. فك ربط جميع عناصر الدروس الاختبارية وتشغيل مصالحة الأصول غير المرتبطة وتقادم deletedAt (> 30 يوماً)
        await prisma.lessonBlockItem.updateMany({
          where: { id: { in: createdLessonBlockItemIds } },
          data: { isDeleted: true, deletedAt: new Date() },
        });

        await prisma.$transaction(async (tx) => {
          await lifecycle.lockMediaAssetsForUpdate(tx, createdAssetIds);
          await lifecycle.reconcileUnlinkedAssetsUnderLock(tx, createdAssetIds);
        });

        const expiredDeletedAt = new Date(Date.now() - 31 * 86_400_000);
        await prisma.mediaAsset.updateMany({
          where: { id: { in: createdAssetIds } },
          data: { isDeleted: true, deletedAt: expiredDeletedAt },
        });

        // 3. جدولة مهام DELETE_OBJECTS عبر MediaCleanupService الإنتاجي
        const enqueuedCount = await cleanupService.scheduleDeleteObjectsJobs();
        expect(enqueuedCount).toBeGreaterThanOrEqual(6);

        // تحديد الأصل الهدف (primary1080AssetUuid) ومهمة DELETE_OBJECTS الخاصة به لاختبار الفشل العابر المشروط بالمفتاح
        const targetAsset = await prisma.mediaAsset.findUniqueOrThrow({
          where: { uuid: primary1080AssetUuid },
        });
        const targetDeleteJob =
          await prisma.mediaProcessingJob.findFirstOrThrow({
            where: {
              mediaAssetId: targetAsset.id,
              jobType: 'DELETE_OBJECTS',
            },
          });

        const targetManifest = parseVariantsManifest(targetAsset.variantsJson);
        const targetAssetKeys = new Set<string>();
        for (const v of Object.values(targetManifest.variants)) {
          if (v?.storage_key) {
            targetAssetKeys.add(v.storage_key);
            targetAssetKeys.add(r2Provider.toScopedKey(v.storage_key));
          }
        }
        if (targetManifest.thumb?.storage_key) {
          targetAssetKeys.add(targetManifest.thumb.storage_key);
          targetAssetKeys.add(
            r2Provider.toScopedKey(targetManifest.thumb.storage_key),
          );
        }
        if (targetManifest.source?.storage_key) {
          targetAssetKeys.add(targetManifest.source.storage_key);
          targetAssetKeys.add(
            r2Provider.toScopedKey(targetManifest.source.storage_key),
          );
        }
        expect(targetAssetKeys.size).toBeGreaterThanOrEqual(10); // 5 keys * 2 (raw + scoped)

        // تثبيت Spy مشروط بمفاتيح الأصل الهدف وبادئة التشغيل p6-live-<runId>/ لمرة واحدة فقط (interceptCount === 0)
        let interceptCount = 0;
        let interceptedScopedKey = '';
        const originalDeleteObject = r2Provider.deleteObject.bind(r2Provider);
        const deleteSpy = jest
          .spyOn(r2Provider, 'deleteObject')
          .mockImplementation(async (key: string) => {
            const scopedKey = r2Provider.toScopedKey(key);
            r2Provider.assertUnderRunPrefix(scopedKey);
            if (
              (targetAssetKeys.has(key) || targetAssetKeys.has(scopedKey)) &&
              scopedKey.startsWith(`${runPrefix}/`) &&
              interceptCount === 0
            ) {
              interceptCount++;
              interceptedScopedKey = scopedKey;
              const transientErr: any = new Error(
                'SIMULATED_R2_503_FIRST_ATTEMPT',
              );
              transientErr.$metadata = { httpStatusCode: 503 };
              throw transientErr;
            }
            return originalDeleteObject(key);
          });

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

        // 4. تشغيل العامل في الجولة الأولى: ستفشل مهمة targetDeleteJob في المحاولة 1 وتنتقل إلى RETRYING مع بقاء صف MediaAsset
        let firstPassJobsProcessed = 0;
        while ((await worker.processNextJobOnce()).claimed) {
          firstPassJobsProcessed++;
        }
        expect(firstPassJobsProcessed).toBeGreaterThanOrEqual(enqueuedCount);
        expect(interceptCount).toBe(1);
        expect(interceptedScopedKey.startsWith(`${runPrefix}/`)).toBe(true);

        const targetJobAfterAttempt1 =
          await prisma.mediaProcessingJob.findUniqueOrThrow({
            where: { id: targetDeleteJob.id },
          });
        expect(targetJobAfterAttempt1.status).toBe('RETRYING');
        expect(targetJobAfterAttempt1.attemptCount).toBe(1);
        expect(targetJobAfterAttempt1.lastError).toContain(
          'SIMULATED_R2_503_FIRST_ATTEMPT',
        );
        expect(targetJobAfterAttempt1.lastError).toContain(
          'R2_DELETE_NOT_VERIFIED_STILL_EXISTS',
        );

        // إثبات أن صف MediaAsset للأصل الهدف لم يُحذف من PostgreSQL بعد فشل المحاولة الأولى
        const targetAssetStillInDb = await prisma.mediaAsset.findUnique({
          where: { id: targetAsset.id },
        });
        expect(targetAssetStillInDb).not.toBeNull();

        // 5. المحاولة الثانية لمهمة targetDeleteJob: تمر عبر R2 الفعلي وتتحقق من 404 وتحذف صف MediaAsset النهائي
        await prisma.mediaProcessingJob.update({
          where: { id: targetDeleteJob.id },
          data: { nextRetryAt: new Date(Date.now() - 1_000) },
        });

        const attempt2Res = await worker.processNextJobOnce();
        expect(attempt2Res.claimed).toBe(true);
        expect(interceptCount).toBe(1); // لم يُعترض مرة ثانية

        deleteSpy.mockRestore();
        loggerLogSpy.mockRestore();

        // بعد نجاح المحاولة الثانية والتحقق من 404 على R2، يقوم Step 7 (finalPurge) بحذف صف MediaAsset وصفوف المهام المرتبطة به نهائياً
        const targetJobAfterAttempt2 =
          await prisma.mediaProcessingJob.findUnique({
            where: { id: targetDeleteJob.id },
          });
        expect(targetJobAfterAttempt2).toBeNull();

        const targetAssetAfterAttempt2 = await prisma.mediaAsset.findUnique({
          where: { id: targetAsset.id },
        });
        expect(targetAssetAfterAttempt2).toBeNull();

        const remainingAssets = await prisma.mediaAsset.count({
          where: { id: { in: createdAssetIds } },
        });
        expect(remainingAssets).toBe(0);
        expect(purgedEvents.length).toBeGreaterThanOrEqual(enqueuedCount);

        // 6. التحقق عبر HeadObject == 404 (NOT_FOUND) لكل مفتاح أُنشئ في هذا التشغيل تحت p6-live-<runId>/
        const trackedKeys = Array.from(r2Provider.createdRemoteKeys);
        expect(trackedKeys.length).toBeGreaterThan(0);

        let verified404Count = 0;
        for (const scopedKey of trackedKeys) {
          expect(scopedKey.startsWith(`${runPrefix}/`)).toBe(true);
          const head = await r2Provider.headObject(scopedKey);
          expect(head).toEqual({ kind: 'NOT_FOUND' });
          verified404Count++;
        }

        (metricsReport.tests as Record<string, unknown>)['P6-4.6'] = {
          durationMs: Date.now() - t0,
          injectionChainIdentityVerified4Of4: true,
          enqueuedDeleteJobs: enqueuedCount,
          interceptCount,
          interceptedScopedKey,
          attempt1JobStatus: targetJobAfterAttempt1.status,
          attempt1ErrorCode: 'SIMULATED_R2_503_FIRST_ATTEMPT',
          assetRowPreservedAfterAttempt1: targetAssetStillInDb !== null,
          attempt2JobAndAssetPurgedFromDb:
            targetJobAfterAttempt2 === null &&
            targetAssetAfterAttempt2 === null,
          remainingAssetsInDbAfterAttempt2: remainingAssets,
          purgedAuditLogsCount: purgedEvents.length,
          totalTrackedKeysUnderRunPrefix: trackedKeys.length,
          verified404Count,
        };
      });
    },
  );
});
