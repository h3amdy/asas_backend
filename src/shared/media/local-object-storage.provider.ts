// src/shared/media/local-object-storage.provider.ts
// ═══════════════════════════════════════════════════════════════
// 💾 VIDEO P4-2 & P4-4 — مُكيّف التخزين المحلي للعقد الموحد
// ═══════════════════════════════════════════════════════════════
// - مُكيّف رقيق فوق StorageService الحالي دون أي تعديل عليه: مسارات الصور والصوت
//   والمستندات تبقى تستدعي StorageService مباشرةً كما هي (صفر تغيير سلوكي).
// - النسخ بالتدفق إلى ملف مؤقت ثم rename ذرّي، فلا يظهر ملف ناقص تحت المفتاح أبداً.
// - الملف المصدر لا يُحذف ولا يُنقل (نسخ وليس rename) — حذفه مسؤولية المستدعي.
// ═══════════════════════════════════════════════════════════════

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  type Stats,
  createReadStream,
  createWriteStream,
  promises as fsp,
} from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { StorageService } from './storage.service';
import {
  CopyObjectOptions,
  CopyObjectResult,
  HeadOutcome,
  LocalFileDigest,
  ObjectStorageProvider,
  TransferOptions,
  UploadFromFileOptions,
  UploadResult,
  VerifyResult,
} from './object-storage.interface';
import { assertValidObjectKey, computeFileDigest } from './file-digest.util';
import { StorageOperationError, classifyStorageError } from './storage-errors';

@Injectable()
export class LocalObjectStorageProvider implements ObjectStorageProvider {
  readonly name = 'LOCAL' as const;

  constructor(private readonly storage: StorageService) {}

  /** يحوّل المفتاح إلى مسار مطلق، مع التأكد أنه داخل جذر التخزين */
  private resolveKey(key: string): string {
    assertValidObjectKey(key);
    const base = path.resolve(this.storage.resolvePath(''));
    const target = path.resolve(this.storage.resolvePath(key));
    const rel = path.relative(base, target);
    if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'INVALID_KEY_OUTSIDE_ROOT',
        false,
        undefined,
        'local.key',
      );
    }
    return target;
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    options: UploadFromFileOptions,
  ): Promise<UploadResult> {
    const target = this.resolveKey(key);
    const signal = options.abortSignal;

    let stat: Stats;
    try {
      stat = await fsp.stat(localPath);
    } catch {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_FILE_MISSING',
        false,
        undefined,
        'local.upload',
      );
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_FILE_EMPTY',
        false,
        undefined,
        'local.upload',
      );
    }
    if (path.resolve(localPath) === target) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'SOURCE_EQUALS_TARGET',
        false,
        undefined,
        'local.upload',
      );
    }

    const digest =
      options.digest ?? (await computeFileDigest(localPath, undefined, signal));
    if (digest.sizeBytes !== stat.size) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_FILE_CHANGED',
        false,
        undefined,
        'local.upload',
      );
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.uploading-${randomUUID()}`;
    try {
      await pipeline(
        createReadStream(localPath, { highWaterMark: 1024 * 1024 }),
        createWriteStream(tmp, { flags: 'wx' }),
        { signal },
      );
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      throw classifyStorageError(err, 'local.upload', signal);
    }
    options.onProgress?.(digest.sizeBytes);

    const verify = await this.verifyStoredObjectSha256(key, digest, {
      abortSignal: signal,
    });
    if (!verify.ok) {
      await fsp.rm(target, { force: true }).catch(() => undefined);
      throw new StorageOperationError(
        'INTEGRITY',
        verify.reason ?? 'SHA256_MISMATCH',
        true,
        undefined,
        'local.verify',
      );
    }

    return {
      key,
      sizeBytes: digest.sizeBytes,
      etag: null,
      sha256Hex: digest.sha256Hex,
      verified: true,
    };
  }

  async copyObject(
    sourceKey: string,
    destinationKey: string,
    options: CopyObjectOptions = {},
  ): Promise<CopyObjectResult> {
    const source = this.resolveKey(sourceKey);
    const target = this.resolveKey(destinationKey);
    const signal = options.abortSignal;

    if (source === target) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'SOURCE_EQUALS_TARGET',
        false,
        undefined,
        'local.copy',
      );
    }

    let stat: Stats;
    try {
      stat = await fsp.stat(source);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageOperationError(
          'NOT_FOUND',
          'ENOENT',
          false,
          404,
          'local.copy',
        );
      }
      throw classifyStorageError(err, 'local.copy', signal);
    }
    if (!stat.isFile()) {
      throw new StorageOperationError(
        'NOT_FOUND',
        'SOURCE_NOT_A_FILE',
        false,
        404,
        'local.copy',
      );
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.copying-${randomUUID()}`;
    try {
      await pipeline(
        createReadStream(source, { highWaterMark: 1024 * 1024 }),
        createWriteStream(tmp, { flags: 'wx' }),
        { signal },
      );
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      throw classifyStorageError(err, 'local.copy', signal);
    }

    return {
      key: destinationKey,
      etag: null,
    };
  }

  async verifyStoredObjectSha256(
    key: string,
    expected: LocalFileDigest,
    options: TransferOptions = {},
  ): Promise<VerifyResult> {
    const target = this.resolveKey(key);
    try {
      const actual = await computeFileDigest(
        target,
        options.onProgress,
        options.abortSignal,
      );
      if (actual.sizeBytes !== expected.sizeBytes) {
        return {
          ok: false,
          remoteBytesRead: actual.sizeBytes,
          remoteSha256Hex: actual.sha256Hex,
          reason: 'SIZE_MISMATCH',
        };
      }
      if (actual.sha256Hex !== expected.sha256Hex) {
        return {
          ok: false,
          remoteBytesRead: actual.sizeBytes,
          remoteSha256Hex: actual.sha256Hex,
          reason: 'SHA256_MISMATCH',
        };
      }
      return {
        ok: true,
        remoteBytesRead: actual.sizeBytes,
        remoteSha256Hex: actual.sha256Hex,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          ok: false,
          remoteBytesRead: 0,
          remoteSha256Hex: '',
          reason: 'NOT_FOUND',
        };
      }
      throw classifyStorageError(err, 'local.verify', options.abortSignal);
    }
  }

  async headObject(key: string): Promise<HeadOutcome> {
    const target = this.resolveKey(key);
    try {
      const stat = await fsp.stat(target);
      if (!stat.isFile()) return { kind: 'NOT_FOUND' };
      return { kind: 'FOUND', info: { key, sizeBytes: stat.size, etag: null } };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      if (code === 'ENOENT') return { kind: 'NOT_FOUND' };
      if (code === 'EACCES' || code === 'EPERM') return { kind: 'FORBIDDEN' };
      return { kind: 'ERROR', code, retryable: false };
    }
  }

  async getObjectStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<Readable> {
    const target = this.resolveKey(key);
    await fsp.access(target).catch(() => {
      throw new StorageOperationError(
        'NOT_FOUND',
        'ENOENT',
        false,
        undefined,
        'local.get',
      );
    });
    return createReadStream(
      target,
      range ? { start: range.start, end: range.end } : {},
    );
  }

  async deleteObject(key: string): Promise<void> {
    const target = this.resolveKey(key);
    await fsp.rm(target, { force: true });
  }
}
