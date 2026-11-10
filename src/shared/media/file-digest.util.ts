// src/shared/media/file-digest.util.ts
// 🔐 VIDEO P4-2 — حساب SHA-256 بالتدفق (بلا readFile) + التحقق من مفاتيح الكائنات
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { LocalFileDigest } from './object-storage.interface';
import { StorageOperationError } from './storage-errors';

/** حجم قطعة القراءة: 1MiB — الذاكرة ثابتة مهما كان حجم الملف */
export const DIGEST_READ_CHUNK_BYTES = 1024 * 1024;

function hashingSink(
  hash: ReturnType<typeof createHash>,
  counter: { bytes: number },
  onProgress?: (bytes: number) => void,
): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, callback) {
      hash.update(chunk);
      counter.bytes += chunk.length;
      onProgress?.(counter.bytes);
      callback();
    },
  });
}

/** يحسب حجم الملف وبصمته SHA-256 (hex + base64) بالتدفق. */
export async function computeFileDigest(
  filePath: string,
  onProgress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<LocalFileDigest> {
  const hash = createHash('sha256');
  const counter = { bytes: 0 };
  await pipeline(
    createReadStream(filePath, { highWaterMark: DIGEST_READ_CHUNK_BYTES }),
    hashingSink(hash, counter, onProgress),
    { signal },
  );
  const digest = hash.digest();
  return {
    sizeBytes: counter.bytes,
    sha256Hex: digest.toString('hex'),
    sha256Base64: digest.toString('base64'),
  };
}

/** يستهلك تدفقاً ويحسب عدد بايتاته وبصمته SHA-256 دون تخزينه. */
export async function hashReadable(
  source: Readable,
  onProgress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<{ bytes: number; sha256Hex: string }> {
  const hash = createHash('sha256');
  const counter = { bytes: 0 };
  await pipeline(source, hashingSink(hash, counter, onProgress), { signal });
  return { bytes: counter.bytes, sha256Hex: hash.digest('hex') };
}

/**
 * يرفض مفاتيح الكائنات غير الآمنة قبل أي عملية تخزين:
 * فارغ، أطول من 1024، يبدأ بـ "/"، يحوي "\" أو محارف تحكم، أو مقاطع "" / "." / "..".
 * (يمنع تجاوز المسار Path Traversal في المزود المحلي، ومفاتيح مشوّهة في R2)
 */
export function assertValidObjectKey(key: string): void {
  const invalid = (reason: string) =>
    new StorageOperationError(
      'INVALID_INPUT',
      `INVALID_KEY_${reason}`,
      false,
      undefined,
      'key',
    );

  if (typeof key !== 'string' || key.length === 0) throw invalid('EMPTY');
  if (key.length > 1024) throw invalid('TOO_LONG');
  if (key.startsWith('/')) throw invalid('ABSOLUTE');
  if (key.includes('\\')) throw invalid('BACKSLASH');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key)) throw invalid('CONTROL_CHAR');
  if (key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw invalid('BAD_SEGMENT');
  }
}
