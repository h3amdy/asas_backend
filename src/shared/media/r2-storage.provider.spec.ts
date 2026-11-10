/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
// src/shared/media/r2-storage.provider.spec.ts
// ═══════════════════════════════════════════════════════════════
// ☁️ VIDEO P4-2 — اختبارات وحدة R2StorageProvider (بلا شبكة)
// ═══════════════════════════════════════════════════════════════
// يُستخدم S3Client الحقيقي و lib-storage Upload الحقيقي، مع متجر R2 وهمي في الذاكرة
// يُحقن كـ middleware في مرحلة initialize فيعترض كل أمر قبل الإرسال. هذا يختبر مسار
// الرفع الفعلي (PutObject مقابل Multipart، البصمات، التحقق، الحذف، إعادة المحاولة)
// مع التحكم الكامل في حالات الفشل: 503، انقطاع الشبكة، 403، BadDigest، وتلف صامت.
// ═══════════════════════════════════════════════════════════════
import { ServiceUnavailableException } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { createHash, randomBytes } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import {
  R2Credentials,
  REQUIRED_R2_ENV_VARS,
  VideoMediaConfig,
} from './video-media.config';
import { R2_PART_SIZE_BYTES, R2StorageProvider } from './r2-storage.provider';
import { computeFileDigest } from './file-digest.util';
import { StorageOperationError } from './storage-errors';

// ── متجر R2 وهمي ──────────────────────────────────────────

type StoredObject = { body: Buffer; etag: string };
type Failure = {
  command: string;
  error: Error;
  times: number;
  onFail?: () => Promise<void> | void;
};

function sdkError(name: string, status?: number, code?: string): Error {
  return Object.assign(new Error(name), {
    name,
    ...(code ? { code } : {}),
    ...(status !== undefined ? { $metadata: { httpStatusCode: status } } : {}),
  });
}

const md5 = (b: Buffer) => `"${createHash('md5').update(b).digest('hex')}"`;

class FakeR2 {
  objects = new Map<string, StoredObject>();
  multipart = new Map<string, Map<number, Buffer>>();
  calls: string[] = [];
  failures: Failure[] = [];
  /** عدد مرات التخزين القادمة التي يُقلب فيها بايت بصمت (الحجم و ETag يبقيان كما هما) */
  corruptNextStores = 0;
  private uploadSeq = 0;

  private store(key: string, body: Buffer) {
    const etag = md5(body);
    let stored = Buffer.from(body);
    if (this.corruptNextStores > 0) {
      this.corruptNextStores--;
      stored = Buffer.from(body);
      stored[Math.floor(stored.length / 2)] ^= 0xff;
    }
    this.objects.set(key, { body: stored, etag });
    return etag;
  }

  async handle(command: string, input: any): Promise<Record<string, unknown>> {
    this.calls.push(command);
    const failure = this.failures.find(
      (f) => f.command === command && f.times > 0,
    );
    if (failure) {
      failure.times--;
      await failure.onFail?.();
      throw failure.error;
    }

    switch (command) {
      case 'PutObjectCommand': {
        const body = Buffer.from(input.Body);
        if (input.ChecksumSHA256) {
          const actual = createHash('sha256').update(body).digest('base64');
          if (actual !== input.ChecksumSHA256) throw sdkError('BadDigest', 400);
        }
        return { ETag: this.store(input.Key, body) };
      }
      case 'CreateMultipartUploadCommand': {
        if (input.ChecksumAlgorithm) {
          // محاكاة سلوك Cloudflare R2 الفعلي المكتشف في P4-7A (501 NotImplemented لترويسة x-amz-checksum-algorithm في Multipart)
          throw sdkError('NotImplemented', 501);
        }
        const id = `upload-${++this.uploadSeq}`;
        this.multipart.set(id, new Map());
        return { UploadId: id, Bucket: input.Bucket, Key: input.Key };
      }
      case 'UploadPartCommand': {
        const body = Buffer.from(input.Body);
        this.multipart.get(input.UploadId)!.set(input.PartNumber, body);
        return { ETag: md5(body) };
      }
      case 'CompleteMultipartUploadCommand': {
        const parts = this.multipart.get(input.UploadId)!;
        const ordered = [...input.MultipartUpload.Parts]
          .sort((a, b) => a.PartNumber - b.PartNumber)
          .map((p) => parts.get(p.PartNumber)!);
        this.multipart.delete(input.UploadId);
        const etag = this.store(input.Key, Buffer.concat(ordered));
        return {
          ETag: etag,
          Bucket: input.Bucket,
          Key: input.Key,
          Location: `https://fake/${input.Key}`,
        };
      }
      case 'AbortMultipartUploadCommand':
        this.multipart.delete(input.UploadId);
        return {};
      case 'HeadObjectCommand': {
        const o = this.objects.get(input.Key);
        if (!o) throw sdkError('NotFound', 404);
        return { ContentLength: o.body.length, ETag: o.etag };
      }
      case 'GetObjectCommand': {
        const o = this.objects.get(input.Key);
        if (!o) throw sdkError('NoSuchKey', 404);
        let body = o.body;
        const m = /^bytes=(\d+)-(\d*)$/.exec(input.Range ?? '');
        if (m)
          body = body.subarray(
            Number(m[1]),
            m[2] ? Number(m[2]) + 1 : undefined,
          );
        return {
          Body: Readable.from([body]),
          ContentLength: body.length,
          ETag: o.etag,
        };
      }
      case 'DeleteObjectCommand':
        this.objects.delete(input.Key);
        return {};
      default:
        throw new Error(`FakeR2: unsupported ${command}`);
    }
  }

  install(client: S3Client) {
    client.middlewareStack.add(
      (_next, context) => async (args: any) => {
        const output = await this.handle(
          context.commandName as string,
          args.input,
        );
        return {
          output: { $metadata: { httpStatusCode: 200 }, ...output },
          response: {},
        } as any;
      },
      { step: 'initialize', priority: 'high', name: 'fakeR2Middleware' },
    );
  }
}

class TestR2Provider extends R2StorageProvider {
  createdClients = 0;
  constructor(
    config: VideoMediaConfig,
    private readonly fake: FakeR2,
  ) {
    super(config);
    this.retryPolicy = { maxAttempts: 3, backoffMs: [0, 0] };
  }
  protected createClient(creds: R2Credentials): S3Client {
    this.createdClients++;
    const client = super.createClient(creds);
    this.fake.install(client);
    return client;
  }
}

// ── تهيئة ─────────────────────────────────────────────────

const ENV_KEYS = ['VIDEO_UPLOAD_ENABLED', ...REQUIRED_R2_ENV_VARS];
const FAKE_SECRET = 'fake-secret-value-should-never-appear';
const saved: Record<string, string | undefined> = {};
let tmpDir: string;
let smallFile: string; // 1MiB → PutObject واحد
let largeFile: string; // 20MiB → 3 أجزاء (8 + 8 + 4)

function makeConfig(enabled = true): VideoMediaConfig {
  for (const k of ENV_KEYS) delete process.env[k];
  if (enabled) {
    Object.assign(process.env, {
      VIDEO_UPLOAD_ENABLED: 'true',
      R2_ACCOUNT_ID: 'testaccount',
      R2_ACCESS_KEY_ID: 'fake-access-key-id',
      R2_SECRET_ACCESS_KEY: FAKE_SECRET,
      R2_BUCKET_NAME: 'asas-media-unit-test',
    });
  }
  return new VideoMediaConfig();
}

async function writeRandomFile(file: string, bytes: number) {
  await fsp.writeFile(file, randomBytes(bytes));
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'r2-provider-spec-'));
  smallFile = path.join(tmpDir, 'small.mp4');
  largeFile = path.join(tmpDir, 'large.mp4');
  await writeRandomFile(smallFile, 1024 * 1024);
  await writeRandomFile(largeFile, 20 * 1024 * 1024);
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

function setup() {
  const fake = new FakeR2();
  const provider = new TestR2Provider(makeConfig(true), fake);
  return { fake, provider };
}

async function expectLocalIntact(file: string, expectedSha: string) {
  const d = await computeFileDigest(file);
  expect(d.sha256Hex).toBe(expectedSha);
}

// ── الاختبارات ────────────────────────────────────────────

describe('R2StorageProvider — عزل الإعدادات', () => {
  it('الفيديو معطّل → لا يُنشأ عميل S3، وأي عملية ترمي 503', async () => {
    const fake = new FakeR2();
    const provider = new TestR2Provider(makeConfig(false), fake);
    expect(provider.isClientInitialized).toBe(false);

    await expect(
      provider.uploadFromFile(smallFile, 'k/a.mp4', {
        contentType: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(provider.headObject('k/a.mp4')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(provider.createdClients).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('العميل يُنشأ مرة واحدة عند أول استخدام فقط', async () => {
    const { provider } = setup();
    expect(provider.createdClients).toBe(0);
    await provider.headObject('none/x.mp4');
    await provider.headObject('none/y.mp4');
    expect(provider.createdClients).toBe(1);
    provider.onModuleDestroy();
    expect(provider.isClientInitialized).toBe(false);
  });
});

describe('R2StorageProvider — الرفع بالتدفق والتحقق الحقيقي', () => {
  it('ملف < 8MiB → PutObject واحد مع ChecksumSHA256 المحلية، ثم Head + Get للتحقق', async () => {
    const { fake, provider } = setup();
    const digest = await computeFileDigest(smallFile);
    const res = await provider.uploadFromFile(
      smallFile,
      'videos/a/source.mp4',
      { contentType: 'video/mp4' },
    );

    expect(res).toMatchObject({
      key: 'videos/a/source.mp4',
      sizeBytes: digest.sizeBytes,
      sha256Hex: digest.sha256Hex,
      verified: true,
    });
    expect(res.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(fake.calls).toEqual([
      'PutObjectCommand',
      'HeadObjectCommand',
      'GetObjectCommand',
    ]);
    expect(
      fake.objects
        .get('videos/a/source.mp4')!
        .body.equals(await fsp.readFile(smallFile)),
    ).toBe(true);
    await expectLocalIntact(smallFile, digest.sha256Hex);
  });

  it('ملف ≥ 8MiB → Multipart بأجزاء 8MiB (20MiB = 3 أجزاء) ثم تحقق كامل', async () => {
    const { fake, provider } = setup();
    const digest = await computeFileDigest(largeFile);
    const progress: number[] = [];
    const res = await provider.uploadFromFile(largeFile, 'videos/b/720p.mp4', {
      contentType: 'video/mp4',
      digest,
      onProgress: (n) => progress.push(n),
    });

    expect(res.verified).toBe(true);
    expect(fake.calls.filter((c) => c === 'UploadPartCommand')).toHaveLength(3);
    expect(fake.calls).toContain('CreateMultipartUploadCommand');
    expect(fake.calls).toContain('CompleteMultipartUploadCommand');
    expect(fake.calls.slice(-2)).toEqual([
      'HeadObjectCommand',
      'GetObjectCommand',
    ]);
    expect(fake.multipart.size).toBe(0);
    expect(progress.length).toBeGreaterThan(0);
    expect(Math.max(...progress)).toBe(digest.sizeBytes);
    expect(R2_PART_SIZE_BYTES).toBe(8 * 1024 * 1024);
    await expectLocalIntact(largeFile, digest.sha256Hex);
  });

  it('R2-V1: تلف صامت لبايت واحد مع تطابق الحجم و ETag → يُكتشف بـ SHA-256، يُحذف الكائن التالف، ثم ينجح الرفع في المحاولة الثانية', async () => {
    const { fake, provider } = setup();
    fake.corruptNextStores = 1;
    const digest = await computeFileDigest(smallFile);

    const res = await provider.uploadFromFile(
      smallFile,
      'videos/c/source.mp4',
      { contentType: 'video/mp4' },
    );

    expect(res.verified).toBe(true);
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(2);
    expect(fake.calls.filter((c) => c === 'DeleteObjectCommand')).toHaveLength(
      1,
    ); // حذف النسخة التالفة
    expect(
      createHash('sha256')
        .update(fake.objects.get('videos/c/source.mp4')!.body)
        .digest('hex'),
    ).toBe(digest.sha256Hex);
    await expectLocalIntact(smallFile, digest.sha256Hex);
  });

  it('تلف مستمر → INTEGRITY بعد 3 محاولات، لا يبقى أي كائن في R2، والملف المحلي سليم', async () => {
    const { fake, provider } = setup();
    fake.corruptNextStores = 99;
    const digest = await computeFileDigest(largeFile);

    const err = await provider
      .uploadFromFile(largeFile, 'videos/d/source.mp4', {
        contentType: 'video/mp4',
        digest,
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(StorageOperationError);
    expect(err).toMatchObject({ kind: 'INTEGRITY', code: 'SHA256_MISMATCH' });
    expect(
      fake.calls.filter((c) => c === 'CompleteMultipartUploadCommand'),
    ).toHaveLength(3);
    expect(fake.objects.has('videos/d/source.mp4')).toBe(false);
    await expectLocalIntact(largeFile, digest.sha256Hex);
  });

  it('BadDigest من R2 (بصمة لا تطابق البايتات المرسلة) → INTEGRITY ولا يُخزَّن شيء', async () => {
    const { fake, provider } = setup();
    const real = await computeFileDigest(smallFile);
    const wrong = {
      ...real,
      sha256Hex: '0'.repeat(64),
      sha256Base64: Buffer.alloc(32).toString('base64'),
    };

    const err = await provider
      .uploadFromFile(smallFile, 'videos/e/source.mp4', {
        contentType: 'video/mp4',
        digest: wrong,
      })
      .catch((e) => e);

    expect(err).toMatchObject({
      kind: 'INTEGRITY',
      code: 'BadDigest',
      httpStatus: 400,
    });
    expect(fake.objects.size).toBe(0);
    await expectLocalIntact(smallFile, real.sha256Hex);
  });
});

describe('R2StorageProvider — الفشل وإعادة المحاولة دون فقدان الملف', () => {
  it.each([
    ['503 ServiceUnavailable', sdkError('ServiceUnavailable', 503)],
    ['500 InternalError', sdkError('InternalError', 500)],
    ['429 SlowDown', sdkError('SlowDown', 429)],
    ['انقطاع الشبكة ECONNRESET', sdkError('Error', undefined, 'ECONNRESET')],
    ['Timeout', sdkError('TimeoutError')],
  ])('%s مرة واحدة → إعادة محاولة ثم نجاح', async (_label, error) => {
    const { fake, provider } = setup();
    fake.failures.push({ command: 'PutObjectCommand', error, times: 1 });
    const digest = await computeFileDigest(smallFile);

    const res = await provider.uploadFromFile(
      smallFile,
      'videos/f/source.mp4',
      { contentType: 'video/mp4' },
    );

    expect(res.verified).toBe(true);
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(2);
    await expectLocalIntact(smallFile, digest.sha256Hex);
  });

  it('فشل جزء في منتصف Multipart → يُلغى الرفع المتعدد (لا أجزاء يتيمة) ثم يُعاد بالكامل وينجح', async () => {
    const { fake, provider } = setup();
    fake.failures.push({
      command: 'UploadPartCommand',
      error: sdkError('ServiceUnavailable', 503),
      times: 1,
    });
    const digest = await computeFileDigest(largeFile);

    const res = await provider.uploadFromFile(
      largeFile,
      'videos/g/source.mp4',
      { contentType: 'video/mp4', digest },
    );

    expect(res.verified).toBe(true);
    expect(fake.calls).toContain('AbortMultipartUploadCommand');
    expect(fake.multipart.size).toBe(0);
    await expectLocalIntact(largeFile, digest.sha256Hex);
  });

  it('فشل عابر مستمر → TRANSIENT بعد 3 محاولات فقط، والملف المحلي باقٍ وسليم', async () => {
    const { fake, provider } = setup();
    fake.failures.push({
      command: 'PutObjectCommand',
      error: sdkError('ServiceUnavailable', 503),
      times: 99,
    });
    const digest = await computeFileDigest(smallFile);

    const err = await provider
      .uploadFromFile(smallFile, 'videos/h/source.mp4', {
        contentType: 'video/mp4',
      })
      .catch((e) => e);

    expect(err).toMatchObject({
      kind: 'TRANSIENT',
      retryable: true,
      httpStatus: 503,
    });
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(3);
    expect(fake.objects.size).toBe(0);
    await expectLocalIntact(smallFile, digest.sha256Hex);
  });

  it('403 AccessDenied → FORBIDDEN بلا إعادة محاولة، ولا يظهر السر في رسالة الخطأ', async () => {
    const { fake, provider } = setup();
    fake.failures.push({
      command: 'PutObjectCommand',
      error: sdkError('AccessDenied', 403),
      times: 99,
    });

    const err = await provider
      .uploadFromFile(smallFile, 'videos/i/source.mp4', {
        contentType: 'video/mp4',
      })
      .catch((e) => e);

    expect(err).toMatchObject({
      kind: 'FORBIDDEN',
      retryable: false,
      httpStatus: 403,
    });
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(1);
    expect(`${err.message} ${err.stack}`).not.toContain(FAKE_SECRET);
  });

  it('501 NotImplemented → INVALID_INPUT بلا إعادة محاولة (F-7B-1: خطأ بروتوكولي دائم ليس TRANSIENT)', async () => {
    const { fake, provider } = setup();
    fake.failures.push({
      command: 'PutObjectCommand',
      error: sdkError('NotImplemented', 501),
      times: 99,
    });

    const err = await provider
      .uploadFromFile(smallFile, 'videos/i501/source.mp4', {
        contentType: 'video/mp4',
      })
      .catch((e) => e);

    expect(err).toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'NotImplemented',
      retryable: false,
      httpStatus: 501,
    });
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(1);
  });

  it('فشل التحقق بسبب خطأ عابر في Head (وليس اختلاف المحتوى) → يُعاد ولا يُحذف الكائن خطأً', async () => {
    const { fake, provider } = setup();
    fake.failures.push({
      command: 'HeadObjectCommand',
      error: sdkError('ServiceUnavailable', 503),
      times: 1,
    });

    const res = await provider.uploadFromFile(
      smallFile,
      'videos/j/source.mp4',
      { contentType: 'video/mp4' },
    );

    expect(res.verified).toBe(true);
    expect(fake.calls).not.toContain('DeleteObjectCommand');
  });

  it('تغيّر الملف المحلي بين المحاولات → LOCAL_FILE_CHANGED بلا إعادة (لا رفع لنسخة مختلفة)', async () => {
    const { fake, provider } = setup();
    const mutable = path.join(tmpDir, 'mutable.mp4');
    await writeRandomFile(mutable, 512 * 1024);
    fake.failures.push({
      command: 'PutObjectCommand',
      error: sdkError('ServiceUnavailable', 503),
      times: 1,
      onFail: () => fsp.appendFile(mutable, Buffer.from('extra')),
    });

    const err = await provider
      .uploadFromFile(mutable, 'videos/k/source.mp4', {
        contentType: 'video/mp4',
      })
      .catch((e) => e);

    expect(err).toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'LOCAL_FILE_CHANGED',
      retryable: false,
    });
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(1);
    expect((await fsp.stat(mutable)).size).toBe(512 * 1024 + 5); // الملف لم يُحذف
  });

  it('الإلغاء عبر AbortSignal → ABORTED بلا إعادة محاولة', async () => {
    const { fake, provider } = setup();
    const controller = new AbortController();
    fake.failures.push({
      command: 'PutObjectCommand',
      error: sdkError('ServiceUnavailable', 503),
      times: 1,
      onFail: () => controller.abort(),
    });

    const err = await provider
      .uploadFromFile(smallFile, 'videos/l/source.mp4', {
        contentType: 'video/mp4',
        abortSignal: controller.signal,
      })
      .catch((e) => e);

    expect(err).toMatchObject({ kind: 'ABORTED', retryable: false });
    expect(fake.calls.filter((c) => c === 'PutObjectCommand')).toHaveLength(1);
  });

  it('مدخلات غير صالحة تُرفض قبل أي طلب شبكي', async () => {
    const { fake, provider } = setup();
    const empty = path.join(tmpDir, 'empty.mp4');
    await fsp.writeFile(empty, '');

    for (const [file, key, code] of [
      [
        path.join(tmpDir, 'missing.mp4'),
        'videos/m/a.mp4',
        'LOCAL_FILE_MISSING',
      ],
      [empty, 'videos/m/a.mp4', 'LOCAL_FILE_EMPTY'],
      [tmpDir, 'videos/m/a.mp4', 'LOCAL_NOT_A_FILE'],
      [smallFile, '../escape.mp4', 'INVALID_KEY_BAD_SEGMENT'],
      [smallFile, '/abs/a.mp4', 'INVALID_KEY_ABSOLUTE'],
      [smallFile, 'a//b.mp4', 'INVALID_KEY_BAD_SEGMENT'],
    ]) {
      const err = await provider
        .uploadFromFile(file, key, { contentType: 'video/mp4' })
        .catch((e) => e);
      expect(err).toMatchObject({ kind: 'INVALID_INPUT', code });
    }
    expect(fake.calls).toEqual([]);
  });
});

describe('R2StorageProvider — Head / Verify / Get / Delete', () => {
  it.each([
    ['404', sdkError('NotFound', 404), { kind: 'NOT_FOUND' }],
    ['403', sdkError('AccessDenied', 403), { kind: 'FORBIDDEN' }],
    [
      '503',
      sdkError('ServiceUnavailable', 503),
      { kind: 'ERROR', retryable: true, httpStatus: 503 },
    ],
    [
      'ETIMEDOUT',
      sdkError('Error', undefined, 'ETIMEDOUT'),
      { kind: 'ERROR', retryable: true, code: 'ETIMEDOUT' },
    ],
  ])(
    'headObject يصنّف %s تصنيفاً صريحاً (404 وحده = غير موجود)',
    async (_l, error, expected) => {
      const { fake, provider } = setup();
      fake.failures.push({ command: 'HeadObjectCommand', error, times: 1 });
      expect(await provider.headObject('x/y.mp4')).toMatchObject(expected);
    },
  );

  it('verify: اختلاف الحجم يُكتشف من Head دون تنزيل المحتوى', async () => {
    const { fake, provider } = setup();
    await provider.uploadFromFile(smallFile, 'v/n.mp4', {
      contentType: 'video/mp4',
    });
    fake.calls = [];
    const digest = await computeFileDigest(smallFile);

    const res = await provider.verifyStoredObjectSha256('v/n.mp4', {
      ...digest,
      sizeBytes: digest.sizeBytes + 1,
    });
    expect(res).toMatchObject({ ok: false, reason: 'SIZE_MISMATCH' });
    expect(fake.calls).toEqual(['HeadObjectCommand']);
  });

  it('verify لكائن غير موجود → NOT_FOUND (ليس استثناء)', async () => {
    const { provider } = setup();
    const digest = await computeFileDigest(smallFile);
    expect(
      await provider.verifyStoredObjectSha256('v/missing.mp4', digest),
    ).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
  });

  it('getObjectStream يدعم نطاق البايتات، و deleteObject متساوي الأثر', async () => {
    const { fake, provider } = setup();
    await provider.uploadFromFile(smallFile, 'v/o.mp4', {
      contentType: 'video/mp4',
    });

    const chunks: Buffer[] = [];
    for await (const c of await provider.getObjectStream('v/o.mp4', {
      start: 10,
      end: 19,
    }))
      chunks.push(Buffer.from(c));
    expect(
      Buffer.concat(chunks).equals(
        (await fsp.readFile(smallFile)).subarray(10, 20),
      ),
    ).toBe(true);

    await provider.deleteObject('v/o.mp4');
    await provider.deleteObject('v/o.mp4');
    expect(fake.objects.has('v/o.mp4')).toBe(false);
    expect(await provider.headObject('v/o.mp4')).toEqual({ kind: 'NOT_FOUND' });
  });
});

describe('R2StorageProvider — الروابط الموقعة', () => {
  it('رابط GET موقّع بصلاحية 3600 ثانية افتراضياً ويُولَّد بلا شبكة', async () => {
    const provider = new R2StorageProvider(makeConfig(true));
    const { url, expiresAt } =
      await provider.getPresignedGetUrl('videos/p/720p.mp4');

    const u = new URL(url);
    expect(u.hostname).toContain('testaccount.r2.cloudflarestorage.com');
    expect(u.pathname).toContain('videos/p/720p.mp4');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain(FAKE_SECRET);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 3_590_000);
    provider.onModuleDestroy();
  });

  it.each([0, -1, 1.5, 604_801])('صلاحية غير صالحة %p تُرفض', async (ttl) => {
    const provider = new R2StorageProvider(makeConfig(true));
    await expect(
      provider.getPresignedGetUrl('videos/p/720p.mp4', ttl),
    ).rejects.toMatchObject({ code: 'INVALID_TTL' });
  });
});
