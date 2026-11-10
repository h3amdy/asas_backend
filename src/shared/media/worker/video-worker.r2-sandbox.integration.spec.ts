// src/shared/media/worker/video-worker.r2-sandbox.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// ☁️ VIDEO P4-7A — التحقق الفعلي على Cloudflare R2 (حاوية asas-media-poc غير الإنتاجية)
// مرجع: docs/Sessions/11_3_11_2026/chat307.md & chat308.md
// ═══════════════════════════════════════════════════════════════
//
// الضمانات الحاكمة (chat307.md):
// 1. حارس العزل (Fail-Closed): يفشل قبل أي اتصال شبكي إذا وُجد أي متغير إنتاجي R2_*.
// 2. يقرأ بيانات الاتصال حصراً من .env.r2-sandbox (أو متغيرات R2_SANDBOX_*).
// 3. جميع المفاتيح المنشأة في هذا التشغيل تقع حصراً تحت البادئة: p4-7a/<run-id>/.
// 4. فصل تام بين اختبار R2 واختبار FFmpeg (لا يُشغَّل VideoTranscodeProcessor هنا).
// 5. اختبار R2-A8 يتحقق من حذف مفاتيح التشغيل الحالي فقط (p4-7a/<run-id>/) دون مسح خارج البادئة.
// 6. لا تُطبع أي مفاتيح سرية أو روابط موقعة في السجلات أو التقارير.
// ═══════════════════════════════════════════════════════════════

import {
  HeadBucketCommand,
  ListBucketsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { AppType, MediaKind, ProcessingStatus } from '@prisma/client';
import { execFile } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { PrismaService } from '../../../prisma/prisma.service';
import { MediaCleanupService } from '../../../school/media/media-cleanup.service';
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
import { MediaJobQueueService } from '../queue/media-job-queue.service';
import { R2StorageProvider } from '../r2-storage.provider';
import { StorageService } from '../storage.service';
import {
  AMBIENT_PROD_R2_ENV_VARS,
  assertSafeR2SandboxEnvironment,
  R2Credentials,
  REQUIRED_R2_SANDBOX_ENV_VARS,
  VideoMediaConfig,
  VideoMediaConfigError,
} from '../video-media.config';
import { DeleteObjectsProcessor } from './delete-objects.processor';
import { MediaWorkerService } from './media-worker.service';
import { MoveSourceProcessor } from './move-source.processor';
import { VideoTranscodeProcessor } from './video-transcode.processor';

jest.setTimeout(300_000);

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SANDBOX_ENV_FILE = path.resolve(PROJECT_ROOT, '.env.r2-sandbox');

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p47a_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
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
 * مع فرض بادئة التشغيل p4-7a/<run-id>/ على جميع المفاتيح وتعقب كل مفتاح أُنشئ.
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

/**
 * توليد ملف ثنائي حتمي غير قابل للضغط السهل مع ترويسة MP4 ftyp في بدايته.
 */
async function createDeterministicMp4LikeFile(
  filePath: string,
  totalBytes: number,
  seedLabel: string,
): Promise<LocalFileDigest> {
  const ftypHeader = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);

  const handle = await fsp.open(filePath, 'w');
  try {
    let written = 0;
    const chunkSize = 64 * 1024;
    let blockIndex = 0;
    while (written < totalBytes) {
      const remaining = totalBytes - written;
      const len = Math.min(chunkSize, remaining);
      const buf = Buffer.allocUnsafe(len);
      const blockSeed = createHash('sha256')
        .update(`${seedLabel}:${blockIndex++}`)
        .digest();
      for (let i = 0; i < len; i++) {
        buf[i] = (blockSeed[i & 31] ^ ((i * 31 + blockIndex) & 0xff)) & 0xff;
      }
      if (written === 0 && len >= ftypHeader.length) {
        ftypHeader.copy(buf, 0);
      }
      await handle.write(buf, 0, len, written);
      written += len;
    }
  } finally {
    await handle.close();
  }
  return computeFileDigest(filePath);
}

describe('VIDEO P4-7A — Cloudflare R2 Sandbox Validation (asas-media-poc)', () => {
  it('R2-A0: يرفض التشغيل فوراً (Fail-Closed) قبل أي اتصال شبكي إذا وُجد أي متغير إنتاجي R2_*', () => {
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
  });

  (hasSandboxEnvConfigured ? describe : describe.skip)(
    'Live Sandbox Suite against asas-media-poc (Isolated Run Prefix p4-7a/<run-id>/)',
    () => {
      const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const runPrefix = `p4-7a/${runId}`;

      let tempDbName = '';
      let dbCreated = false;
      let prevStoragePath: string | undefined;

      let sandboxCreds: R2Credentials & { endpoint: string };
      let r2Provider: NamespacedSandboxR2Provider;
      let prisma: PrismaService;
      let config: VideoMediaConfig;
      let storage: StorageService;
      let localProvider: LocalObjectStorageProvider;
      let registry: ObjectStorageRegistry;
      let lifecycle: MediaLifecycleService;
      let queue: MediaJobQueueService;
      let moveSourceProcessor: MoveSourceProcessor;
      let deleteObjectsProcessor: DeleteObjectsProcessor;
      let cleanupService: MediaCleanupService;
      let worker: MediaWorkerService;

      let tmpDir: string;
      let smallFilePath: string;
      let smallDigest: LocalFileDigest;
      let altSmallFilePath: string;
      let altSmallDigest: LocalFileDigest;
      let multipartFilePath: string;
      let multipartDigest: LocalFileDigest;

      let testSchoolId: number;
      let testSchoolUuid: string;

      const metricsReport: Record<string, unknown> = {
        runId,
        runPrefix,
        bucketName: '',
        startedAt: new Date().toISOString(),
        tests: {},
      };

      beforeAll(async () => {
        // 1. فحص حارس العزل على بيئة الاختبار الحالية (يفشل فوراً إذا وُجد أي متغير إنتاجي R2_*)
        sandboxCreds = assertSafeR2SandboxEnvironment(effectiveSandboxEnv);
        expect(sandboxCreds.bucketName).toBe('asas-media-poc');
        metricsReport.bucketName = sandboxCreds.bucketName;

        // 2. تجهيز قاعدة PostgreSQL اختبارية مؤقتة ومعزولة
        tempDbName = `asas_video_p47a_pg_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
        assertSafeTestDb(tempDbName);
        const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
        const dbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}`;

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
          env: { ...process.env, DATABASE_URL: dbUrl },
        });

        prisma = new PrismaService({ datasourceUrl: dbUrl });
        await prisma.$connect();

        // 3. تجهيز الملفات الاختبارية المحلية الجاهزة (بدون FFmpeg)
        tmpDir = await fsp.mkdtemp(
          path.join(os.tmpdir(), `asas-p4-7a-${runId}-`),
        );
        prevStoragePath = process.env.MEDIA_STORAGE_PATH;
        process.env.MEDIA_STORAGE_PATH = tmpDir;

        smallFilePath = path.join(tmpDir, 'single-1mib.mp4');
        altSmallFilePath = path.join(tmpDir, 'variant-512kib.mp4');
        multipartFilePath = path.join(tmpDir, 'multipart-18mib.mp4');

        smallDigest = await createDeterministicMp4LikeFile(
          smallFilePath,
          1_048_576, // 1 MiB (< 8 MiB -> PutObject)
          `small-${runId}`,
        );
        altSmallDigest = await createDeterministicMp4LikeFile(
          altSmallFilePath,
          524_288, // 512 KiB
          `alt-${runId}`,
        );
        multipartDigest = await createDeterministicMp4LikeFile(
          multipartFilePath,
          18 * 1024 * 1024, // 18 MiB (3 parts: 8MiB + 8MiB + 2MiB -> Multipart)
          `multipart-${runId}`,
        );

        metricsReport.files = {
          single1MiB: {
            sizeBytes: smallDigest.sizeBytes,
            sha256: smallDigest.sha256Hex,
          },
          variant512KiB: {
            sizeBytes: altSmallDigest.sizeBytes,
            sha256: altSmallDigest.sha256Hex,
          },
          multipart18MiB: {
            sizeBytes: multipartDigest.sizeBytes,
            sha256: multipartDigest.sha256Hex,
          },
        };

        // 4. تهيئة VideoMediaConfig و NamespacedSandboxR2Provider دون تلويث process.env بمتغيرات إنتاجية
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

        // 5. تهيئة خدمات التخزين، الطابور، وعمال MOVE_SOURCE و DELETE_OBJECTS
        storage = new StorageService();
        localProvider = new LocalObjectStorageProvider(storage);
        registry = new ObjectStorageRegistry(localProvider, r2Provider);
        lifecycle = new MediaLifecycleService(
          new MediaAccessPolicyService(prisma),
        );
        queue = new MediaJobQueueService(prisma, config);

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
        // لا نستخدم VideoTranscodeProcessor في P4-7A (مفصول لبوابة P4-7B)
        const unusedTranscodeProcessor = {} as VideoTranscodeProcessor;
        worker = new MediaWorkerService(
          config,
          queue,
          unusedTranscodeProcessor,
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

        const school = await prisma.school.create({
          data: {
            name: `P4-7A Sandbox School ${runId}`,
            schoolCode: 88701,
            appType: AppType.PUBLIC,
          },
        });
        testSchoolId = school.id;
        testSchoolUuid = school.uuid;
      });

      afterAll(async () => {
        // تنظيف دفاعي لأي مفاتيح متبقية تحت بادئة التشغيل الحالي فقط
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
          await execFileAsync('dropdb', [
            '-h',
            'localhost',
            '-p',
            '5432',
            '--if-exists',
            tempDbName,
          ]).catch(() => undefined);
        }

        if (prevStoragePath === undefined) {
          delete process.env.MEDIA_STORAGE_PATH;
        } else {
          process.env.MEDIA_STORAGE_PATH = prevStoragePath;
        }

        if (tmpDir) {
          await fsp
            .rm(tmpDir, { recursive: true, force: true })
            .catch(() => undefined);
        }

        metricsReport.finishedAt = new Date().toISOString();
        const metricsPath =
          process.env.P4_7A_METRICS_OUT ?? '/tmp/p4-7a-metrics.json';
        await fsp
          .writeFile(
            metricsPath,
            JSON.stringify(metricsReport, null, 2),
            'utf8',
          )
          .catch(() => undefined);
      });

      it('R2-A1: التحقق من الاتصال بـ asas-media-poc وعودة 404 لمفتاح غير موجود وتسجيل سلوك ListBuckets بشكل مستقل', async () => {
        const t0 = Date.now();
        const rawClient = r2Provider.getRawClient();

        const headBucketRes = await rawClient.send(
          new HeadBucketCommand({ Bucket: sandboxCreds.bucketName }),
        );
        const headBucketMs = Date.now() - t0;
        const headBucketStatus = headBucketRes.$metadata.httpStatusCode ?? 200;
        expect(headBucketStatus).toBe(200);

        const t1 = Date.now();
        const missingKey = `${runPrefix}/probes/missing-${randomUUID()}.bin`;
        const headMissing = await r2Provider.headObject(missingKey);
        const headMissingMs = Date.now() - t1;
        expect(headMissing).toEqual({ kind: 'NOT_FOUND' });

        // فحص ListBuckets كاختبار صلاحيات مستقل غير حاجب للبوابة (chat307.md §2.3)
        let listBucketsOutcome: {
          status: number | string;
          code: string;
          ms: number;
        };
        const t2 = Date.now();
        try {
          const lbRes = await rawClient.send(new ListBucketsCommand({}));
          listBucketsOutcome = {
            status: lbRes.$metadata.httpStatusCode ?? 200,
            code: 'ALLOWED_TOKEN_HAS_ACCOUNT_READ',
            ms: Date.now() - t2,
          };
        } catch (err: unknown) {
          const sdkErr = err as {
            $metadata?: { httpStatusCode?: number };
            name?: string;
            Code?: string;
          };
          listBucketsOutcome = {
            status: sdkErr?.$metadata?.httpStatusCode ?? 'ERROR',
            code: sdkErr?.name ?? sdkErr?.Code ?? 'AccessDenied',
            ms: Date.now() - t2,
          };
        }

        (metricsReport.tests as Record<string, unknown>)['R2-A1'] = {
          status: 'PASS',
          headBucketHttpStatus: headBucketStatus,
          headBucketMs,
          headMissingOutcome: headMissing.kind,
          headMissingHttpStatus: 404,
          headMissingMs,
          listBucketsObservation: listBucketsOutcome,
        };
      });

      it('R2-A2: رفع فردي PutObject (<8MiB) مع ChecksumSHA256 والتحقق التدفقـي وكشف اختلاف SHA-256 أو الحجم', async () => {
        const key = `${runPrefix}/direct/single-1mib.mp4`;
        const t0 = Date.now();
        const uploadRes = await r2Provider.uploadFromFile(smallFilePath, key, {
          contentType: 'video/mp4',
          digest: smallDigest,
        });
        const uploadAndVerifyMs = Date.now() - t0;

        expect(uploadRes.verified).toBe(true);
        expect(uploadRes.key).toBe(key);
        expect(uploadRes.sizeBytes).toBe(1_048_576);
        expect(uploadRes.sha256Hex).toBe(smallDigest.sha256Hex);
        expect(uploadRes.etag).toBeTruthy();

        const head = await r2Provider.headObject(key);
        expect(head.kind).toBe('FOUND');
        if (head.kind === 'FOUND') {
          expect(head.info.sizeBytes).toBe(1_048_576);
          expect(head.info.etag).toBe(uploadRes.etag);
        }

        // اختبار كشف اختلاف SHA-256 على الكائن المخزن فعلاً
        const wrongShaDigest: LocalFileDigest = {
          sizeBytes: smallDigest.sizeBytes,
          sha256Hex: '0'.repeat(64),
          sha256Base64: Buffer.alloc(32, 0).toString('base64'),
        };
        const tMismatch = Date.now();
        const mismatchRes = await r2Provider.verifyStoredObjectSha256(
          key,
          wrongShaDigest,
        );
        const mismatchVerifyMs = Date.now() - tMismatch;
        expect(mismatchRes.ok).toBe(false);
        expect(mismatchRes.reason).toBe('SHA256_MISMATCH');
        expect(mismatchRes.remoteBytesRead).toBe(1_048_576);

        // اختبار كشف اختلاف الحجم من HeadObject دون تنزيل التدفق
        const wrongSizeDigest: LocalFileDigest = {
          ...smallDigest,
          sizeBytes: smallDigest.sizeBytes + 100,
        };
        const sizeMismatchRes = await r2Provider.verifyStoredObjectSha256(
          key,
          wrongSizeDigest,
        );
        expect(sizeMismatchRes.ok).toBe(false);
        expect(sizeMismatchRes.reason).toBe('SIZE_MISMATCH');
        expect(sizeMismatchRes.remoteBytesRead).toBe(0);

        (metricsReport.tests as Record<string, unknown>)['R2-A2'] = {
          status: 'PASS',
          key,
          sizeBytes: uploadRes.sizeBytes,
          sha256: uploadRes.sha256Hex,
          etag: uploadRes.etag,
          uploadAndVerifyMs,
          mismatchVerifyMs,
          sha256MismatchReason: mismatchRes.reason,
          sizeMismatchReason: sizeMismatchRes.reason,
        };
      });

      it('R2-A3: رفع متعدد الأجزاء Multipart (18 MiB = 3 أجزاء) مع ChecksumAlgorithm=SHA256 والتحقق التدفقـي الكامل', async () => {
        const key = `${runPrefix}/direct/multipart-18mib.mp4`;
        let progressEvents = 0;
        let lastLoaded = 0;

        const t0 = Date.now();
        const uploadRes = await r2Provider.uploadFromFile(
          multipartFilePath,
          key,
          {
            contentType: 'video/mp4',
            digest: multipartDigest,
            onProgress: (loaded) => {
              progressEvents++;
              lastLoaded = loaded;
            },
          },
        );
        const multipartUploadAndVerifyMs = Date.now() - t0;

        expect(uploadRes.verified).toBe(true);
        expect(uploadRes.key).toBe(key);
        expect(uploadRes.sizeBytes).toBe(18 * 1024 * 1024);
        expect(uploadRes.sha256Hex).toBe(multipartDigest.sha256Hex);
        expect(uploadRes.etag).toMatch(/-3"?$/);
        expect(progressEvents).toBeGreaterThan(0);
        expect(lastLoaded).toBeGreaterThan(0);

        (metricsReport.tests as Record<string, unknown>)['R2-A3'] = {
          status: 'PASS',
          key,
          sizeBytes: uploadRes.sizeBytes,
          sha256: uploadRes.sha256Hex,
          compositeEtag: uploadRes.etag,
          multipartUploadAndVerifyMs,
          progressEvents,
        };
      });

      it('R2-A4: الروابط الموقعة Presigned GET + طلبات Range (206) وعبر حدود الأجزاء + If-Match (412) + خارج النطاق (416) + انتهاء الصلاحية (403)', async () => {
        const key = `${runPrefix}/direct/multipart-18mib.mp4`;
        const head = await r2Provider.headObject(key);
        expect(head.kind).toBe('FOUND');
        const etag = head.kind === 'FOUND' ? head.info.etag! : '';

        const { url: presignedUrl } = await r2Provider.getPresignedGetUrl(
          key,
          300,
        );

        // (أ) أول 1 MiB مع Range و If-Match مطابق
        const tRange1 = Date.now();
        const resRange1 = await fetch(presignedUrl, {
          headers: {
            Range: 'bytes=0-1048575',
            'If-Match': etag,
          },
        });
        const bufRange1 = Buffer.from(await resRange1.arrayBuffer());
        const range1Ms = Date.now() - tRange1;

        expect(resRange1.status).toBe(206);
        expect(resRange1.headers.get('content-range')).toBe(
          `bytes 0-1048575/${18 * 1024 * 1024}`,
        );
        expect(bufRange1.length).toBe(1_048_576);

        const expectedSlice1 = Buffer.allocUnsafe(1_048_576);
        const fh = await fsp.open(multipartFilePath, 'r');
        try {
          await fh.read(expectedSlice1, 0, 1_048_576, 0);
        } finally {
          await fh.close();
        }
        const slice1Sha256 = createHash('sha256')
          .update(bufRange1)
          .digest('hex');
        const expectedSlice1Sha256 = createHash('sha256')
          .update(expectedSlice1)
          .digest('hex');
        expect(slice1Sha256).toBe(expectedSlice1Sha256);

        // (ب) Range يعبر حد الجزء الأول والثاني (8MiB - 1024 إلى 8MiB + 1023)
        const boundaryStart = 8 * 1024 * 1024 - 1024;
        const boundaryEnd = 8 * 1024 * 1024 + 1023;
        const tCross = Date.now();
        const resCross = await fetch(presignedUrl, {
          headers: {
            Range: `bytes=${boundaryStart}-${boundaryEnd}`,
            'If-Match': etag,
          },
        });
        const bufCross = Buffer.from(await resCross.arrayBuffer());
        const crossPartRangeMs = Date.now() - tCross;

        expect(resCross.status).toBe(206);
        expect(resCross.headers.get('content-range')).toBe(
          `bytes ${boundaryStart}-${boundaryEnd}/${18 * 1024 * 1024}`,
        );
        expect(bufCross.length).toBe(2048);

        const expectedCross = Buffer.allocUnsafe(2048);
        const fh2 = await fsp.open(multipartFilePath, 'r');
        try {
          await fh2.read(expectedCross, 0, 2048, boundaryStart);
        } finally {
          await fh2.close();
        }
        expect(createHash('sha256').update(bufCross).digest('hex')).toBe(
          createHash('sha256').update(expectedCross).digest('hex'),
        );

        // (ج) If-Match خاطئ -> 412 Precondition Failed
        const t412 = Date.now();
        const res412 = await fetch(presignedUrl, {
          headers: {
            Range: 'bytes=0-1023',
            'If-Match': '"00000000000000000000000000000000"',
          },
        });
        await res412.arrayBuffer().catch(() => undefined);
        const ifMatch412Ms = Date.now() - t412;
        expect(res412.status).toBe(412);

        // (د) Range خارج النطاق -> 416 Range Not Satisfiable
        const outStart = 18 * 1024 * 1024 + 1024;
        const res416 = await fetch(presignedUrl, {
          headers: {
            Range: `bytes=${outStart}-${outStart + 1024}`,
          },
        });
        await res416.arrayBuffer().catch(() => undefined);
        expect(res416.status).toBe(416);

        // (هـ) انتهاء صلاحية Presigned URL قصير العمر (TTL = 2s -> انتظار 3.5s -> 403)
        const { url: shortUrl } = await r2Provider.getPresignedGetUrl(key, 2);
        await new Promise((r) => setTimeout(r, 3500));
        const t403 = Date.now();
        const res403 = await fetch(shortUrl, {
          headers: { Range: 'bytes=0-1023' },
        });
        const body403 = await res403.text();
        const expired403Ms = Date.now() - t403;
        expect(res403.status).toBe(403);
        expect(body403).toContain('ExpiredRequest');

        (metricsReport.tests as Record<string, unknown>)['R2-A4'] = {
          status: 'PASS',
          range1MiB: {
            httpStatus: resRange1.status,
            contentRange: resRange1.headers.get('content-range'),
            sha256: slice1Sha256,
            ms: range1Ms,
          },
          crossPartRange: {
            httpStatus: resCross.status,
            contentRange: resCross.headers.get('content-range'),
            bytes: bufCross.length,
            ms: crossPartRangeMs,
          },
          ifMatchMismatch: {
            httpStatus: res412.status,
            ms: ifMatch412Ms,
          },
          outOfBoundsRange: {
            httpStatus: res416.status,
          },
          expiredPresignedUrl: {
            ttlSec: 2,
            waitedMs: 3500,
            httpStatus: res403.status,
            ms: expired403Ms,
          },
        };
      });

      it('R2-A5 & R2-A6: تنفيذ MOVE_SOURCE (ready/ ↔ hold/) ثم DELETE_OBJECTS السباعي باستخدام كائنات جاهزة على R2 الحقيقي و PostgreSQL المحلي', async () => {
        const assetUuid = randomUUID();

        // 1. رفع كائنات الأصل الخمسة مسبقة التجهيز تحت بادئة التشغيل p4-7a/<run-id>/
        const readySourceLogicalKey = `video-sources/ready/${testSchoolUuid}/${assetUuid}/f1/original.mp4`;
        const key360 = `${runPrefix}/media/${testSchoolUuid}/${assetUuid}/f1/360p.mp4`;
        const key480 = `${runPrefix}/media/${testSchoolUuid}/${assetUuid}/f1/480p.mp4`;
        const key720 = `${runPrefix}/media/${testSchoolUuid}/${assetUuid}/f1/720p.mp4`;
        const keyThumb = `${runPrefix}/media/${testSchoolUuid}/${assetUuid}/f1/thumb.webp`;

        const upSource = await r2Provider.uploadFromFile(
          smallFilePath,
          readySourceLogicalKey,
          { contentType: 'video/mp4', digest: smallDigest },
        );
        const up360 = await r2Provider.uploadFromFile(
          altSmallFilePath,
          key360,
          {
            contentType: 'video/mp4',
            digest: altSmallDigest,
          },
        );
        const up480 = await r2Provider.uploadFromFile(
          altSmallFilePath,
          key480,
          {
            contentType: 'video/mp4',
            digest: altSmallDigest,
          },
        );
        const up720 = await r2Provider.uploadFromFile(
          altSmallFilePath,
          key720,
          {
            contentType: 'video/mp4',
            digest: altSmallDigest,
          },
        );
        const upThumb = await r2Provider.uploadFromFile(
          altSmallFilePath,
          keyThumb,
          {
            contentType: 'image/webp',
            digest: altSmallDigest,
          },
        );

        const nowIso = new Date().toISOString();
        const variantsManifest = {
          schema_version: 1,
          quality_ladder: [360, 480, 720],
          preferred_variant: '720p',
          variants: {
            '360p': {
              storage_key: up360.key,
              height: 360,
              width: 640,
              size_bytes: up360.sizeBytes,
              sha256: up360.sha256Hex,
              etag: up360.etag ?? undefined,
              status: 'VERIFIED',
              verified_at: nowIso,
            },
            '480p': {
              storage_key: up480.key,
              height: 480,
              width: 854,
              size_bytes: up480.sizeBytes,
              sha256: up480.sha256Hex,
              etag: up480.etag ?? undefined,
              status: 'VERIFIED',
              verified_at: nowIso,
            },
            '720p': {
              storage_key: up720.key,
              height: 720,
              width: 1280,
              size_bytes: up720.sizeBytes,
              sha256: up720.sha256Hex,
              etag: up720.etag ?? undefined,
              status: 'VERIFIED',
              verified_at: nowIso,
            },
          },
          thumb: {
            storage_key: upThumb.key,
            size_bytes: upThumb.sizeBytes,
            sha256: upThumb.sha256Hex,
            etag: upThumb.etag ?? undefined,
            status: 'VERIFIED',
            verified_at: nowIso,
          },
          source: {
            storage_key: upSource.key,
            ext: 'mp4',
            location: 'READY',
            size_bytes: upSource.sizeBytes,
            sha256: upSource.sha256Hex,
            etag: upSource.etag ?? undefined,
            status: 'VERIFIED',
            verified_at: nowIso,
          },
        };

        const asset = await prisma.mediaAsset.create({
          data: {
            uuid: assetUuid,
            schoolId: testSchoolId,
            ownerType: 'SCHOOL',
            kind: MediaKind.VIDEO,
            storageProvider: 'R2',
            storageKey: up720.key,
            contentType: 'video/mp4',
            sizeBytes: smallDigest.sizeBytes,
            sha256: smallDigest.sha256Hex,
            processingStatus: ProcessingStatus.DONE,
            variantsJson: JSON.stringify(variantsManifest),
          },
        });

        // ── (1) MOVE_SOURCE: نقل المصدر من READY إلى HOLD على R2 الحقيقي ──
        const moveToHoldJob = await prisma.mediaProcessingJob.create({
          data: {
            mediaAssetId: asset.id,
            jobType: 'MOVE_SOURCE',
            status: 'PENDING',
            idempotencyKey: `MOVE_SOURCE:${assetUuid}:HOLD:${runId}`,
            payloadJson: JSON.stringify({
              assetUuid,
              targetLocation: 'HOLD',
            }),
            nextRetryAt: new Date(Date.now() - 1000),
          },
        });

        const tMoveHold = Date.now();
        const ranHold = await worker.processNextJobOnce();
        const moveToHoldMs = Date.now() - tMoveHold;
        expect(ranHold.claimed).toBe(true);

        const jobAfterHold = await prisma.mediaProcessingJob.findUniqueOrThrow({
          where: { id: moveToHoldJob.id },
        });
        expect(jobAfterHold.status).toBe('COMPLETED');

        const assetAfterHold = await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        });
        const manifestAfterHold = JSON.parse(assetAfterHold.variantsJson!) as {
          source: { location: string; storage_key: string };
        };
        expect(manifestAfterHold.source.location).toBe('HOLD');
        const holdKey = manifestAfterHold.source.storage_key;
        expect(holdKey).toContain(
          `video-sources/hold/${testSchoolUuid}/${assetUuid}/`,
        );

        // المفتاح القديم في ready/ يجب أن يصبح 404، والمفتاح الجديد في hold/ موجود وسليم
        const oldReadyHead = await r2Provider.headObject(upSource.key);
        const newHoldHead = await r2Provider.headObject(holdKey);
        expect(oldReadyHead).toEqual({ kind: 'NOT_FOUND' });
        expect(newHoldHead.kind).toBe('FOUND');

        // ── (2) MOVE_SOURCE: إعادة المصدر من HOLD إلى READY على R2 الحقيقي ──
        const moveToReadyJob = await prisma.mediaProcessingJob.create({
          data: {
            mediaAssetId: asset.id,
            jobType: 'MOVE_SOURCE',
            status: 'PENDING',
            idempotencyKey: `MOVE_SOURCE:${assetUuid}:READY:${runId}`,
            payloadJson: JSON.stringify({
              assetUuid,
              targetLocation: 'READY',
            }),
            nextRetryAt: new Date(Date.now() - 1000),
          },
        });

        const tMoveReady = Date.now();
        const ranReady = await worker.processNextJobOnce();
        const moveToReadyMs = Date.now() - tMoveReady;
        expect(ranReady.claimed).toBe(true);

        const jobAfterReady = await prisma.mediaProcessingJob.findUniqueOrThrow(
          {
            where: { id: moveToReadyJob.id },
          },
        );
        expect(jobAfterReady.status).toBe('COMPLETED');

        const assetAfterReady = await prisma.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        });
        const manifestAfterReady = JSON.parse(
          assetAfterReady.variantsJson!,
        ) as {
          source: { location: string; storage_key: string };
        };
        expect(manifestAfterReady.source.location).toBe('READY');
        const finalReadyKey = manifestAfterReady.source.storage_key;
        expect(finalReadyKey).toContain(
          `video-sources/ready/${testSchoolUuid}/${assetUuid}/`,
        );

        expect(await r2Provider.headObject(holdKey)).toEqual({
          kind: 'NOT_FOUND',
        });
        expect((await r2Provider.headObject(finalReadyKey)).kind).toBe('FOUND');

        (metricsReport.tests as Record<string, unknown>)['R2-A5_MOVE_SOURCE'] =
          {
            status: 'PASS',
            moveToHoldMs,
            moveToReadyMs,
            initialReadyKey: upSource.key,
            holdKey: r2Provider.toScopedKey(holdKey),
            finalReadyKey: r2Provider.toScopedKey(finalReadyKey),
            oldKeysVerified404: true,
          };

        // ── (3) DELETE_OBJECTS: إضافة مفتاح جيل يتيم على R2 وتنفيذ الحذف السباعي الكامل ──
        const orphanKey = `${runPrefix}/media/${testSchoolUuid}/${assetUuid}/f99/orphan-720p.mp4`;
        await r2Provider.uploadFromFile(altSmallFilePath, orphanKey, {
          contentType: 'video/mp4',
          digest: altSmallDigest,
        });

        await prisma.mediaProcessingJob.create({
          data: {
            mediaAssetId: asset.id,
            jobType: 'TRANSCODE_VIDEO',
            status: 'COMPLETED',
            idempotencyKey: `TRANSCODE_VIDEO:${assetUuid}`,
            finishedAt: new Date(),
            stepStateJson: JSON.stringify({
              generations_registry: {
                '99': {
                  fencing_token: '99',
                  registered_at: new Date().toISOString(),
                  lease_expires_at: new Date().toISOString(),
                  keys: {
                    [orphanKey]: { write_initiated: true, write_settled: true },
                  },
                  reconciliation_status: 'RECONCILIATION_CLOSED',
                  sweep_pass_count: 1,
                },
              },
            }),
          },
        });

        // تقادم تاريخ الحذف الناعم لتجاوز مهلة الـ 30 يوماً
        const expiredDeletedAt = new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        );
        await prisma.mediaAsset.update({
          where: { id: asset.id },
          data: {
            isDeleted: true,
            deletedAt: expiredDeletedAt,
          },
        });

        const purgedLogs: string[] = [];
        const logSpy = jest
          .spyOn(Logger.prototype, 'log')
          .mockImplementation((msg: unknown) => {
            if (typeof msg === 'string' && msg.includes('MEDIA_ASSET_PURGED')) {
              purgedLogs.push(msg);
            }
          });

        let deleteObjectsMs = 0;
        try {
          const scheduledCount =
            await cleanupService.scheduleDeleteObjectsJobs();
          expect(scheduledCount).toBeGreaterThanOrEqual(1);

          const tDel = Date.now();
          const ranDel = await worker.processNextJobOnce();
          deleteObjectsMs = Date.now() - tDel;
          expect(ranDel.claimed).toBe(true);
        } finally {
          logSpy.mockRestore();
        }

        // التحقق من حذف صف MediaAsset والمهام المرتبطة من PostgreSQL
        const assetInDb = await prisma.mediaAsset.findUnique({
          where: { id: asset.id },
        });
        expect(assetInDb).toBeNull();
        const jobsInDb = await prisma.mediaProcessingJob.count({
          where: { mediaAssetId: asset.id },
        });
        expect(jobsInDb).toBe(0);

        // التحقق الفعلي من عودة 404 لجميع المفاتيح السبعة على Cloudflare R2
        // (4 جودات/مصغرة + المصدر الحالي في ready/ + مفتاح الجيل السابق في hold/ من مهمة النقل الأولى + الجيل اليتيم f99)
        const keysToVerifyGone = [
          up360.key,
          up480.key,
          up720.key,
          upThumb.key,
          holdKey,
          finalReadyKey,
          orphanKey,
        ];
        for (const k of keysToVerifyGone) {
          const h = await r2Provider.headObject(k);
          expect(h).toEqual({ kind: 'NOT_FOUND' });
        }

        expect(purgedLogs).toHaveLength(1);
        const purgedEvent = JSON.parse(purgedLogs[0]) as {
          event: string;
          assetUuid: string;
          kind: string;
          ownerType: string;
          schoolId: number;
          storageProvider: string;
          keysVerifiedDeleted: number;
          jobsSummary: unknown[];
        };
        expect(purgedEvent).toMatchObject({
          event: 'MEDIA_ASSET_PURGED',
          assetUuid,
          kind: 'VIDEO',
          ownerType: 'SCHOOL',
          schoolId: testSchoolId,
          storageProvider: 'R2',
          keysVerifiedDeleted: 7,
        });
        expect(Array.isArray(purgedEvent.jobsSummary)).toBe(true);
        expect(purgedEvent.jobsSummary.length).toBe(4);

        (metricsReport.tests as Record<string, unknown>)[
          'R2-A6_DELETE_OBJECTS'
        ] = {
          status: 'PASS',
          deleteObjectsMs,
          keysVerifiedDeleted: purgedEvent.keysVerifiedDeleted,
          dbAssetPurged: true,
          dbJobsPurged: true,
          purgedAuditLog: {
            event: purgedEvent.event,
            kind: purgedEvent.kind,
            ownerType: purgedEvent.ownerType,
            storageProvider: purgedEvent.storageProvider,
            keysVerifiedDeleted: purgedEvent.keysVerifiedDeleted,
            jobsSummary: purgedEvent.jobsSummary,
          },
        };
      });

      it('R2-A8: تنظيف مفاتيح الاختبار المباشرة والتحقق من اختفاء 100% من مفاتيح التشغيل الحالي (p4-7a/<run-id>/) دون لمس خارج البادئة', async () => {
        const directKeys = [
          `${runPrefix}/direct/single-1mib.mp4`,
          `${runPrefix}/direct/multipart-18mib.mp4`,
        ];

        const tClean = Date.now();
        for (const k of directKeys) {
          await r2Provider.deleteObject(k);
        }
        const directDeleteMs = Date.now() - tClean;

        const allRunKeys = Array.from(r2Provider.createdRemoteKeys);
        expect(allRunKeys.length).toBeGreaterThanOrEqual(9);

        const verificationResults: Record<string, string> = {};
        const tVerify = Date.now();
        for (const key of allRunKeys) {
          expect(key.startsWith(`${runPrefix}/`)).toBe(true);
          const head = await r2Provider.headObject(key);
          verificationResults[key] = head.kind;
          expect(head).toEqual({ kind: 'NOT_FOUND' });
        }
        const verifyAllAbsentMs = Date.now() - tVerify;

        (metricsReport.tests as Record<string, unknown>)[
          'R2-A8_CURRENT_RUN_CLEANUP'
        ] = {
          status: 'PASS',
          runPrefix,
          totalRunKeysCreated: allRunKeys.length,
          allVerified404Count: allRunKeys.length,
          directDeleteMs,
          verifyAllAbsentMs,
          verifiedKeys: verificationResults,
        };
      });
    },
  );
});
