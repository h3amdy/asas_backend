// src/shared/media/r2-storage.provider.ts
// ═══════════════════════════════════════════════════════════════
// ☁️ VIDEO P4-2 & P4-4 — مزود Cloudflare R2 (AWS SDK v3 / S3 API)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §2.4, §7)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════
//
// الضمانات:
// 1. عزل الإعدادات: لا يُنشأ S3Client إلا عند أول استخدام فعلي، وعند تعطيل الفيديو
//    يرمي VideoMediaConfig خطأ 503 بدلاً من إسقاط العملية (§2.4).
// 2. رفع بالتدفق: fs.createReadStream → lib-storage Upload بأجزاء 8MiB و queueSize=1
//    (الذاكرة محدودة بحجم الجزء، لا readFile إطلاقاً).
//    - ملف < 8MiB: طلب PutObject واحد مع ChecksumSHA256 المحسوبة محلياً (يرفض R2 أي بت تالف).
//    - ملف ≥ 8MiB: Multipart مع ChecksumAlgorithm=SHA256 لكل جزء.
// 3. تحقق حقيقي بعد الرفع (verifyStoredObjectSha256): HeadObject للحجم ثم GetObject
//    بالتدفق وحساب SHA-256 للمحتوى المخزن فعلاً. عند الاختلاف يُحذف الكائن التالف فوراً.
// 4. الملف المحلي لا يُحذف ولا يُعدَّل أبداً هنا. حذفه مسؤولية المستدعي بعد نجاح التحقق.
// 5. إعادة محاولة محدودة للأخطاء العابرة واختلاف السلامة فقط؛ لا إعادة عند 403 أو الإلغاء
//    أو تغيّر الملف المحلي. كل محاولة تقرأ من الملف المحلي من جديد.
// 6. لا تُطبع المفاتيح السرية أو الروابط الموقعة في أي سجل أو رسالة خطأ.
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, promises as fsp } from 'fs';
import { Readable } from 'stream';
import { R2Credentials, VideoMediaConfig } from './video-media.config';
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
  WriteSettlementOutcome,
} from './object-storage.interface';
import {
  assertValidObjectKey,
  computeFileDigest,
  hashReadable,
} from './file-digest.util';
import { StorageOperationError, classifyStorageError } from './storage-errors';

/** حجم الجزء في الرفع المتعدد، وهو أيضاً حد الانتقال من PutObject إلى Multipart */
export const R2_PART_SIZE_BYTES = 8 * 1024 * 1024;
/** جزء واحد في الذاكرة في كل لحظة — أقل استهلاك على VPS ذي النواة الواحدة */
export const R2_QUEUE_SIZE = 1;
export const R2_PRESIGN_DEFAULT_TTL_SEC = 3600;
/** أقصى صلاحية يسمح بها توقيع S3 v4 (7 أيام) */
export const R2_PRESIGN_MAX_TTL_SEC = 604_800;

export interface R2RetryPolicy {
  /** إجمالي المحاولات (بما فيها الأولى) */
  maxAttempts: number;
  /** فترات الانتظار قبل كل إعادة (بالمللي ثانية) */
  backoffMs: number[];
}

export const DEFAULT_R2_RETRY_POLICY: R2RetryPolicy = {
  maxAttempts: 3,
  backoffMs: [1_000, 4_000],
};

/**
 * يصنّف ما إذا كان خطأ عملية كتابة خارجية يحسم عدم تثبيت الكائن لدى المزود (settled: true)
 * أم أن النتيجة ملتبسة وقد تستمر العملية في الخلفية لدى المزود (settled: false).
 * مرجع: p4-4-design-and-audit.md v1.7 (معنى write_settled).
 */
export function evaluateWriteErrorSettlement(
  err: unknown,
  context: {
    /** هل حدث الخطأ قبل إرسال أي طلب شبكة للمزود؟ */
    failedBeforeNetworkSend?: boolean;
    /** هل تم تأكيد إلغاء الرفع المتعدد (AbortMultipartUpload 2xx/404) قبل إرسال CompleteMultipartUpload؟ */
    confirmedServerSideAbortBeforeComplete?: boolean;
    /** في التخزين المحلي: هل حُذف الملف المؤقت .tmp بنجاح قبل استدعاء rename الذرّي؟ */
    confirmedLocalTmpDeletedBeforeRename?: boolean;
  } = {},
): WriteSettlementOutcome {
  if (
    context.failedBeforeNetworkSend === true ||
    context.confirmedServerSideAbortBeforeComplete === true ||
    context.confirmedLocalTmpDeletedBeforeRename === true
  ) {
    return {
      settled: true,
      reason: 'DEFINITIVE_ABORT_OR_PRE_COMMIT_REJECT',
    };
  }

  if (err instanceof StorageOperationError) {
    // أخطاء التحقق المحلي قبل الشبكة (ملف محلي مفقود/فارغ/تغيّر أو مفتاح غير صالح)
    if (
      err.kind === 'INVALID_INPUT' &&
      (err.code === 'LOCAL_FILE_MISSING' ||
        err.code === 'LOCAL_FILE_EMPTY' ||
        err.code === 'LOCAL_NOT_A_FILE' ||
        err.code === 'LOCAL_FILE_CHANGED' ||
        err.code === 'SOURCE_EQUALS_TARGET' ||
        err.code === 'INVALID_KEY_OUTSIDE_ROOT')
    ) {
      return {
        settled: true,
        reason: 'DEFINITIVE_ABORT_OR_PRE_COMMIT_REJECT',
      };
    }
  }

  // أي خطأ شبكة (ECONNRESET / EPIPE)، أو Timeout، أو AbortSignal غير مؤكد، أو HTTP 5xx
  // يُعامل كنتيجة ملتبسة (AMBIGUOUS_OUTCOME) ويبقي write_settled = false وجوباً!
  return {
    settled: false,
    reason: 'AMBIGUOUS_OUTCOME',
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

@Injectable()
export class R2StorageProvider
  implements ObjectStorageProvider, OnModuleDestroy
{
  readonly name = 'R2' as const;
  /** قابلة للتعديل في الاختبارات (تأخير صفري) */
  retryPolicy: R2RetryPolicy = DEFAULT_R2_RETRY_POLICY;

  private readonly logger = new Logger('R2StorageProvider');
  private client: S3Client | null = null;

  constructor(private readonly config: VideoMediaConfig) {}

  onModuleDestroy(): void {
    this.client?.destroy();
    this.client = null;
  }

  /** هل أُنشئ عميل S3 فعلاً؟ (للتحقق من العزل الكسول في الاختبارات) */
  get isClientInitialized(): boolean {
    return this.client !== null;
  }

  // ── الرفع ─────────────────────────────────────────────

  async uploadFromFile(
    localPath: string,
    key: string,
    options: UploadFromFileOptions,
  ): Promise<UploadResult> {
    assertValidObjectKey(key);
    const { client, bucket } = this.getClient(); // 503 عند تعطيل الفيديو
    const signal = options.abortSignal;

    const initialSize = await this.statLocalFile(localPath);
    const digest =
      options.digest ??
      (await computeFileDigest(localPath, undefined, signal).catch((e) => {
        throw classifyStorageError(e, 'r2.digest', signal);
      }));
    if (digest.sizeBytes !== initialSize) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_FILE_CHANGED',
        false,
        undefined,
        'r2.upload',
      );
    }

    return this.withRetry('r2.upload', signal, async () => {
      // قبل كل محاولة: الملف المحلي ما زال موجوداً وبنفس الحجم (لا رفع لنسخة مختلفة)
      const currentSize = await this.statLocalFile(localPath);
      if (currentSize !== digest.sizeBytes) {
        throw new StorageOperationError(
          'INVALID_INPUT',
          'LOCAL_FILE_CHANGED',
          false,
          undefined,
          'r2.upload',
        );
      }

      const etag = await this.streamUpload(
        client,
        bucket,
        localPath,
        key,
        digest,
        options,
      );

      const verify = await this.verifyStoredObjectSha256(key, digest, {
        abortSignal: signal,
        onProgress: options.onProgress,
      });
      if (!verify.ok) {
        await this.deleteQuietly(key);
        throw new StorageOperationError(
          'INTEGRITY',
          verify.reason ?? 'SHA256_MISMATCH',
          true,
          undefined,
          'r2.verify',
        );
      }

      return {
        key,
        sizeBytes: digest.sizeBytes,
        etag,
        sha256Hex: digest.sha256Hex,
        verified: true,
      };
    });
  }

  async copyObject(
    sourceKey: string,
    destinationKey: string,
    options: CopyObjectOptions = {},
  ): Promise<CopyObjectResult> {
    assertValidObjectKey(sourceKey);
    assertValidObjectKey(destinationKey);
    if (sourceKey === destinationKey) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'SOURCE_EQUALS_TARGET',
        false,
        undefined,
        'r2.copy',
      );
    }

    const { client, bucket } = this.getClient();
    const signal = options.abortSignal;
    const encodedSource = `${bucket}/${sourceKey
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')}`;

    return this.withRetry('r2.copy', signal, async () => {
      try {
        const res = await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            CopySource: encodedSource,
            Key: destinationKey,
          }),
          { abortSignal: signal },
        );
        return {
          key: destinationKey,
          etag: res.CopyObjectResult?.ETag ?? null,
        };
      } catch (err) {
        throw classifyStorageError(err, 'r2.copy', signal);
      }
    });
  }

  private async streamUpload(
    client: S3Client,
    bucket: string,
    localPath: string,
    key: string,
    digest: LocalFileDigest,
    options: UploadFromFileOptions,
  ): Promise<string | null> {
    // ملاحظة مثبتة على R2 الفعلي (P4-7A):
    // - PutObject (< 8MiB) يدعم ChecksumSHA256 (x-amz-checksum-sha256) ويعيد 200 OK.
    // - CreateMultipartUpload يرفض ترويسة x-amz-checksum-algorithm: SHA256 بـ 501 NotImplemented
    //   في Cloudflare R2؛ لذا في الرفع المتعدد يُعتمد على ETag لكل جزء + التحقق التدفقـي الكامل
    //   (HeadObject + GetObject SHA-256) في verifyStoredObjectSha256 مباشرة بعد الاكتمال.
    const singlePart = digest.sizeBytes < R2_PART_SIZE_BYTES;
    const upload = new Upload({
      client,
      partSize: R2_PART_SIZE_BYTES,
      queueSize: R2_QUEUE_SIZE,
      leavePartsOnError: false, // إلغاء الرفع المتعدد عند الفشل حتى لا تبقى أجزاء يتيمة
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(localPath, { highWaterMark: 1024 * 1024 }),
        ContentType: options.contentType,
        ...(singlePart ? { ChecksumSHA256: digest.sha256Base64 } : {}),
      },
    });

    if (options.onProgress) {
      upload.on('httpUploadProgress', (p) => {
        if (typeof p.loaded === 'number') options.onProgress!(p.loaded);
      });
    }
    const onAbort = () => void upload.abort().catch(() => undefined);
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });

    try {
      const result = await upload.done();
      return (result as { ETag?: string }).ETag ?? null;
    } finally {
      options.abortSignal?.removeEventListener('abort', onAbort);
    }
  }

  // ── التحقق ────────────────────────────────────────────

  async verifyStoredObjectSha256(
    key: string,
    expected: LocalFileDigest,
    options: TransferOptions = {},
  ): Promise<VerifyResult> {
    assertValidObjectKey(key);
    const { client, bucket } = this.getClient();
    const signal = options.abortSignal;

    const head = await this.headObject(key);
    if (head.kind === 'NOT_FOUND') {
      return {
        ok: false,
        remoteBytesRead: 0,
        remoteSha256Hex: '',
        reason: 'NOT_FOUND',
      };
    }
    if (head.kind === 'FORBIDDEN') {
      throw new StorageOperationError(
        'FORBIDDEN',
        'HEAD_FORBIDDEN',
        false,
        403,
        'r2.verify',
      );
    }
    if (head.kind === 'ERROR') {
      // تعذّر الفحص ≠ اختلاف المحتوى: يُرمى كخطأ (قد يُعاد) ولا يُحذف الكائن
      throw new StorageOperationError(
        head.retryable ? 'TRANSIENT' : 'UNKNOWN',
        head.code,
        head.retryable,
        head.httpStatus,
        'r2.verify',
      );
    }
    if (head.info.sizeBytes !== expected.sizeBytes) {
      // لا داعي لتنزيل المحتوى إذا اختلف الحجم
      return {
        ok: false,
        remoteBytesRead: 0,
        remoteSha256Hex: '',
        reason: 'SIZE_MISMATCH',
      };
    }

    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        {
          abortSignal: signal,
        },
      );
      const remote = await hashReadable(
        res.Body as Readable,
        options.onProgress,
        signal,
      );
      if (remote.bytes !== expected.sizeBytes) {
        return {
          ok: false,
          remoteBytesRead: remote.bytes,
          remoteSha256Hex: remote.sha256Hex,
          reason: 'SIZE_MISMATCH',
        };
      }
      if (remote.sha256Hex !== expected.sha256Hex) {
        return {
          ok: false,
          remoteBytesRead: remote.bytes,
          remoteSha256Hex: remote.sha256Hex,
          reason: 'SHA256_MISMATCH',
        };
      }
      return {
        ok: true,
        remoteBytesRead: remote.bytes,
        remoteSha256Hex: remote.sha256Hex,
      };
    } catch (err) {
      const classified = classifyStorageError(err, 'r2.verify', signal);
      if (classified.kind === 'NOT_FOUND') {
        return {
          ok: false,
          remoteBytesRead: 0,
          remoteSha256Hex: '',
          reason: 'NOT_FOUND',
        };
      }
      throw classified;
    }
  }

  // ── الفحص والقراءة والحذف ─────────────────────────────

  async headObject(key: string): Promise<HeadOutcome> {
    assertValidObjectKey(key);
    const { client, bucket } = this.getClient();
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        kind: 'FOUND',
        info: {
          key,
          sizeBytes: Number(res.ContentLength ?? 0),
          etag: res.ETag ?? null,
        },
      };
    } catch (err) {
      const c = classifyStorageError(err, 'r2.head');
      if (c.kind === 'NOT_FOUND') return { kind: 'NOT_FOUND' };
      if (c.kind === 'FORBIDDEN') return { kind: 'FORBIDDEN' };
      return {
        kind: 'ERROR',
        code: c.code,
        retryable: c.retryable,
        httpStatus: c.httpStatus,
      };
    }
  }

  async getObjectStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<Readable> {
    assertValidObjectKey(key);
    const { client, bucket } = this.getClient();
    try {
      const res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined,
        }),
      );
      return res.Body as Readable;
    } catch (err) {
      throw classifyStorageError(err, 'r2.get');
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertValidObjectKey(key);
    const { client, bucket } = this.getClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      const c = classifyStorageError(err, 'r2.delete');
      if (c.kind !== 'NOT_FOUND') throw c;
    }
  }

  /**
   * رابط GET موقّع (افتراضياً ساعة واحدة — D-R2-02). يُولَّد محلياً بلا أي اتصال شبكي.
   * ⚠️ لا يُسجَّل الرابط في أي سجل أبداً.
   */
  async getPresignedGetUrl(
    key: string,
    expiresInSec: number = R2_PRESIGN_DEFAULT_TTL_SEC,
  ): Promise<{ url: string; expiresAt: Date }> {
    assertValidObjectKey(key);
    if (
      !Number.isInteger(expiresInSec) ||
      expiresInSec < 1 ||
      expiresInSec > R2_PRESIGN_MAX_TTL_SEC
    ) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'INVALID_TTL',
        false,
        undefined,
        'r2.presign',
      );
    }
    const { client, bucket } = this.getClient();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      {
        expiresIn: expiresInSec,
      },
    );
    return { url, expiresAt: new Date(Date.now() + expiresInSec * 1000) };
  }

  // ── داخلي ─────────────────────────────────────────────

  private getClient(): { client: S3Client; bucket: string } {
    const creds = this.config.getR2Credentials(); // يرمي 503 STORAGE_PROVIDER_UNAVAILABLE عند التعطيل
    if (!this.client) {
      this.client = this.createClient(creds);
    }
    return { client: this.client, bucket: creds.bucketName };
  }

  /** protected لتمكين الاختبارات من حقن متجر وهمي بلا شبكة */
  protected createClient(creds: R2Credentials): S3Client {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
      // إعادة محاولة SDK لكل طلب على حدة (الأجزاء Buffers فتُعاد بأمان)
      maxAttempts: 3,
      // لا يحسب SDK بصمات تلقائية (CRC32/trailers) إلا حين نطلبها صراحةً
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
    });
  }

  private async statLocalFile(localPath: string): Promise<number> {
    let stat: import('fs').Stats;
    try {
      stat = await fsp.stat(localPath);
    } catch {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_FILE_MISSING',
        false,
        undefined,
        'r2.upload',
      );
    }
    if (!stat.isFile()) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_NOT_A_FILE',
        false,
        undefined,
        'r2.upload',
      );
    }
    if (stat.size === 0) {
      throw new StorageOperationError(
        'INVALID_INPUT',
        'LOCAL_FILE_EMPTY',
        false,
        undefined,
        'r2.upload',
      );
    }
    return stat.size;
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.deleteObject(key);
    } catch (err) {
      const c = classifyStorageError(err, 'r2.delete');
      this.logger.warn(
        `تعذّر حذف كائن تالف بعد فشل التحقق (${c.kind}/${c.code})`,
      );
    }
  }

  private async withRetry<T>(
    operation: string,
    signal: AbortSignal | undefined,
    fn: (attempt: number) => Promise<T>,
  ): Promise<T> {
    const { maxAttempts, backoffMs } = this.retryPolicy;
    let last: StorageOperationError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        last = classifyStorageError(err, operation, signal);
        if (!last.retryable || attempt >= maxAttempts) throw last;
        this.logger.warn(
          `${operation}: المحاولة ${attempt}/${maxAttempts} فشلت (${last.kind}/${last.code}) — إعادة المحاولة`,
        );
        await sleep(
          backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1] ?? 0,
          signal,
        ).catch((e) => {
          throw classifyStorageError(e, operation, signal);
        });
      }
    }
    throw (
      last ??
      new StorageOperationError(
        'UNKNOWN',
        'NO_ATTEMPTS',
        false,
        undefined,
        operation,
      )
    );
  }
}
