// src/shared/media/storage-errors.ts
// ═══════════════════════════════════════════════════════════════
// 🗄️ VIDEO P4-2 — تصنيف صريح لأخطاء التخزين (R2 / LOCAL)
// ═══════════════════════════════════════════════════════════════
// - لا يُدرج أي سر أو رابط موقّع في رسالة الخطأ: فقط العملية + التصنيف + الرمز + حالة HTTP.
// - retryable يحدد هل تعيد طبقة إعادة المحاولة التنفيذ (والعامل لاحقاً في P4-4).
// ═══════════════════════════════════════════════════════════════

export type StorageErrorKind =
  | 'NOT_FOUND' // 404 — الكائن غير موجود
  | 'FORBIDDEN' // 401/403 — مشكلة صلاحيات/مفتاح: لا إعادة محاولة
  | 'CONFIG' // NoSuchBucket وما شابه: خطأ إعدادات لا تحله إعادة المحاولة
  | 'INTEGRITY' // BadDigest أو اختلاف SHA-256/الحجم بعد الرفع
  | 'TRANSIENT' // 5xx / 429 / Timeout / أخطاء الشبكة
  | 'ABORTED' // أُلغيت العملية عبر AbortSignal
  | 'INVALID_INPUT' // مفتاح غير صالح، ملف محلي مفقود/فارغ/تغيّر
  | 'UNKNOWN';

export class StorageOperationError extends Error {
  constructor(
    public readonly kind: StorageErrorKind,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    operation = 'storage',
  ) {
    super(
      `[${operation}] ${kind} (${code}${httpStatus !== undefined ? `, http=${httpStatus}` : ''})`,
    );
    this.name = 'StorageOperationError';
  }
}

/** رموز أخطاء الشبكة العابرة في Node */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const TRANSIENT_ERROR_NAMES = new Set([
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'SlowDown',
  'ServiceUnavailable',
  'InternalError',
  'ThrottlingException',
]);

const FORBIDDEN_ERROR_NAMES = new Set([
  'AccessDenied',
  'Forbidden',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'Unauthorized',
]);

const CONFIG_ERROR_NAMES = new Set(['NoSuchBucket', 'InvalidBucketName']);
const INTEGRITY_ERROR_NAMES = new Set([
  'BadDigest',
  'InvalidDigest',
  'XAmzContentSHA256Mismatch',
]);
const NOT_FOUND_ERROR_NAMES = new Set(['NotFound', 'NoSuchKey']);

interface SdkLikeError {
  name?: string;
  code?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
}

/**
 * يحوّل أي خطأ (SDK / شبكة / Node) إلى StorageOperationError مصنّف.
 * لا يحتفظ بالخطأ الأصلي (cause) عمداً حتى لا تتسرب تفاصيل الطلب إلى السجلات.
 */
export function classifyStorageError(
  err: unknown,
  operation: string,
  signal?: AbortSignal,
): StorageOperationError {
  if (err instanceof StorageOperationError) return err;

  const e = (err ?? {}) as SdkLikeError;
  const status = e.$metadata?.httpStatusCode;
  const name = e.name ?? e.Code ?? 'UnknownError';
  const code = e.code ?? e.Code ?? name;

  if (signal?.aborted || name === 'AbortError') {
    return new StorageOperationError(
      'ABORTED',
      'ABORTED',
      false,
      status,
      operation,
    );
  }
  if (CONFIG_ERROR_NAMES.has(name)) {
    return new StorageOperationError('CONFIG', name, false, status, operation);
  }
  if (status === 404 || NOT_FOUND_ERROR_NAMES.has(name)) {
    return new StorageOperationError(
      'NOT_FOUND',
      name,
      false,
      status,
      operation,
    );
  }
  if (status === 401 || status === 403 || FORBIDDEN_ERROR_NAMES.has(name)) {
    return new StorageOperationError(
      'FORBIDDEN',
      name,
      false,
      status,
      operation,
    );
  }
  if (INTEGRITY_ERROR_NAMES.has(name)) {
    return new StorageOperationError(
      'INTEGRITY',
      name,
      true,
      status,
      operation,
    );
  }
  if (status === 501 || name === 'NotImplemented') {
    return new StorageOperationError(
      'INVALID_INPUT',
      name,
      false,
      status ?? 501,
      operation,
    );
  }
  if (
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 599) ||
    TRANSIENT_ERROR_NAMES.has(name) ||
    TRANSIENT_NETWORK_CODES.has(code)
  ) {
    return new StorageOperationError(
      'TRANSIENT',
      code,
      true,
      status,
      operation,
    );
  }
  return new StorageOperationError('UNKNOWN', name, false, status, operation);
}
