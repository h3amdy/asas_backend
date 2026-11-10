// src/shared/media/local-object-storage.provider.spec.ts
// 💾 VIDEO P4-2 — اختبارات المُكيّف المحلي + السجل + أدوات البصمة والمفاتيح + تصنيف الأخطاء
import { createHash, randomBytes } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { StorageService } from './storage.service';
import { LocalObjectStorageProvider } from './local-object-storage.provider';
import { ObjectStorageRegistry } from './object-storage.registry';
import { R2StorageProvider } from './r2-storage.provider';
import { VideoMediaConfig } from './video-media.config';
import {
  assertValidObjectKey,
  computeFileDigest,
  hashReadable,
} from './file-digest.util';
import { StorageOperationError, classifyStorageError } from './storage-errors';

let root: string;
let srcDir: string;
let savedStoragePath: string | undefined;
let provider: LocalObjectStorageProvider;
let source: string;

beforeAll(async () => {
  savedStoragePath = process.env.MEDIA_STORAGE_PATH;
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'local-provider-spec-'));
  srcDir = path.join(root, 'src');
  await fsp.mkdir(srcDir);
  process.env.MEDIA_STORAGE_PATH = path.join(root, 'storage');
  provider = new LocalObjectStorageProvider(new StorageService());
  source = path.join(srcDir, 'video.mp4');
  await fsp.writeFile(source, randomBytes(3 * 1024 * 1024 + 17));
});

afterAll(async () => {
  if (savedStoragePath === undefined) delete process.env.MEDIA_STORAGE_PATH;
  else process.env.MEDIA_STORAGE_PATH = savedStoragePath;
  await fsp.rm(root, { recursive: true, force: true });
});

describe('computeFileDigest / hashReadable', () => {
  it('يطابق SHA-256 المرجعي (hex + base64) والحجم', async () => {
    const buf = await fsp.readFile(source);
    const d = await computeFileDigest(source);
    expect(d.sizeBytes).toBe(buf.length);
    expect(d.sha256Hex).toBe(createHash('sha256').update(buf).digest('hex'));
    expect(d.sha256Base64).toBe(
      createHash('sha256').update(buf).digest('base64'),
    );
  });

  it('hashReadable يحسب البصمة من تدفق متعدد القطع', async () => {
    const parts = [Buffer.from('abc'), Buffer.from('def')];
    const r = await hashReadable(Readable.from(parts));
    expect(r).toEqual({
      bytes: 6,
      sha256Hex: createHash('sha256').update('abcdef').digest('hex'),
    });
  });
});

describe('assertValidObjectKey', () => {
  it.each(['videos/a/b/720p.mp4', 'video-sources/ready/x.mp4', 'a.mp4'])(
    'مقبول: %p',
    (k) => {
      expect(() => assertValidObjectKey(k)).not.toThrow();
    },
  );
  it.each([
    '',
    '/abs.mp4',
    '../x',
    'a/../b',
    'a//b',
    './a',
    'a\\b',
    'a\nb',
    'x'.repeat(1025),
  ])('مرفوض: %p', (k) => {
    expect(() => assertValidObjectKey(k)).toThrow(StorageOperationError);
  });
});

describe('classifyStorageError', () => {
  const e = (props: object) => Object.assign(new Error('x'), props);
  it.each([
    [
      { name: 'NotFound', $metadata: { httpStatusCode: 404 } },
      'NOT_FOUND',
      false,
    ],
    [
      { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } },
      'FORBIDDEN',
      false,
    ],
    [
      { name: 'SignatureDoesNotMatch', $metadata: { httpStatusCode: 403 } },
      'FORBIDDEN',
      false,
    ],
    [
      { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } },
      'CONFIG',
      false,
    ],
    [
      { name: 'BadDigest', $metadata: { httpStatusCode: 400 } },
      'INTEGRITY',
      true,
    ],
    [{ name: 'X', $metadata: { httpStatusCode: 502 } }, 'TRANSIENT', true],
    [{ name: 'X', $metadata: { httpStatusCode: 429 } }, 'TRANSIENT', true],
    [{ name: 'Error', code: 'ECONNRESET' }, 'TRANSIENT', true],
    [{ name: 'TimeoutError' }, 'TRANSIENT', true],
    [{ name: 'AbortError' }, 'ABORTED', false],
    [{ name: 'X', $metadata: { httpStatusCode: 400 } }, 'UNKNOWN', false],
  ])('%j → %s (retryable=%s)', (props, kind, retryable) => {
    const c = classifyStorageError(e(props), 'test');
    expect(c.kind).toBe(kind);
    expect(c.retryable).toBe(retryable);
  });
});

describe('LocalObjectStorageProvider', () => {
  it('يرفع بالنسخ (المصدر يبقى)، ذرّياً بلا ملفات .uploading متبقية، ويتحقق من SHA-256', async () => {
    const digest = await computeFileDigest(source);
    const res = await provider.uploadFromFile(
      source,
      'school-x/asset-1/source.mp4',
      { contentType: 'video/mp4' },
    );

    expect(res).toMatchObject({
      verified: true,
      sizeBytes: digest.sizeBytes,
      sha256Hex: digest.sha256Hex,
      etag: null,
    });
    expect((await computeFileDigest(source)).sha256Hex).toBe(digest.sha256Hex);
    const dir = path.join(root, 'storage', 'school-x', 'asset-1');
    expect(await fsp.readdir(dir)).toEqual(['source.mp4']);
  });

  it('head / verify / range stream / delete', async () => {
    const key = 'school-x/asset-2/source.mp4';
    const digest = await computeFileDigest(source);
    await provider.uploadFromFile(source, key, {
      contentType: 'video/mp4',
      digest,
    });

    expect(await provider.headObject(key)).toEqual({
      kind: 'FOUND',
      info: { key, sizeBytes: digest.sizeBytes, etag: null },
    });
    expect(await provider.verifyStoredObjectSha256(key, digest)).toMatchObject({
      ok: true,
    });
    expect(
      await provider.verifyStoredObjectSha256(key, {
        ...digest,
        sha256Hex: 'f'.repeat(64),
      }),
    ).toMatchObject({
      ok: false,
      reason: 'SHA256_MISMATCH',
    });

    const chunks: Buffer[] = [];
    for await (const c of await provider.getObjectStream(key, {
      start: 100,
      end: 199,
    }))
      chunks.push(c as Buffer);
    expect(
      Buffer.concat(chunks).equals(
        (await fsp.readFile(source)).subarray(100, 200),
      ),
    ).toBe(true);

    await provider.deleteObject(key);
    await provider.deleteObject(key);
    expect(await provider.headObject(key)).toEqual({ kind: 'NOT_FOUND' });
    expect(await provider.verifyStoredObjectSha256(key, digest)).toMatchObject({
      ok: false,
      reason: 'NOT_FOUND',
    });
    await expect(provider.getObjectStream(key)).rejects.toMatchObject({
      kind: 'NOT_FOUND',
    });
  });

  it('يرفض تجاوز المسار والمفاتيح غير الصالحة دون كتابة أي ملف خارج الجذر', async () => {
    for (const key of ['../escape.mp4', 'a/../../escape.mp4', '/etc/passwd']) {
      await expect(
        provider.uploadFromFile(source, key, { contentType: 'video/mp4' }),
      ).rejects.toMatchObject({
        kind: 'INVALID_INPUT',
      });
    }
    await expect(
      fsp.access(path.join(root, 'escape.mp4')),
    ).rejects.toBeTruthy();
  });

  it('يرفض بصمة لا تطابق المحتوى ويحذف النسخة المكتوبة', async () => {
    const real = await computeFileDigest(source);
    const err = await provider
      .uploadFromFile(source, 'school-x/asset-3/source.mp4', {
        contentType: 'video/mp4',
        digest: { ...real, sha256Hex: '0'.repeat(64) },
      })
      .catch((x) => x);
    expect(err).toMatchObject({ kind: 'INTEGRITY', code: 'SHA256_MISMATCH' });
    expect(await provider.headObject('school-x/asset-3/source.mp4')).toEqual({
      kind: 'NOT_FOUND',
    });
    expect((await computeFileDigest(source)).sha256Hex).toBe(real.sha256Hex);
  });

  it('يرفض ملفاً مفقوداً أو فارغاً، ونسخ الملف فوق نفسه', async () => {
    const empty = path.join(srcDir, 'empty.mp4');
    await fsp.writeFile(empty, '');
    await expect(
      provider.uploadFromFile(path.join(srcDir, 'nope.mp4'), 'k/a.mp4', {
        contentType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      code: 'LOCAL_FILE_MISSING',
    });
    await expect(
      provider.uploadFromFile(empty, 'k/a.mp4', { contentType: 'video/mp4' }),
    ).rejects.toMatchObject({
      code: 'LOCAL_FILE_EMPTY',
    });

    const key = 'school-x/asset-4/source.mp4';
    await provider.uploadFromFile(source, key, { contentType: 'video/mp4' });
    const stored = path.join(root, 'storage', key);
    await expect(
      provider.uploadFromFile(stored, key, { contentType: 'video/mp4' }),
    ).rejects.toMatchObject({
      code: 'SOURCE_EQUALS_TARGET',
    });
    expect((await fsp.stat(stored)).size).toBe((await fsp.stat(source)).size);
  });
});

describe('ObjectStorageRegistry', () => {
  it('يختار المزود حسب storage_provider، و null/undefined → LOCAL، وأي قيمة أخرى خطأ صريح', () => {
    const r2 = new R2StorageProvider(new VideoMediaConfig());
    const registry = new ObjectStorageRegistry(provider, r2);
    expect(registry.get('LOCAL')).toBe(provider);
    expect(registry.get(null)).toBe(provider);
    expect(registry.get(undefined)).toBe(provider);
    expect(registry.get('R2')).toBe(r2);
    expect(() => registry.get('S3')).toThrow(StorageOperationError);
    expect(r2.isClientInitialized).toBe(false);
  });
});
