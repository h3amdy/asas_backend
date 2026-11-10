// src/shared/media/object-storage.interface.ts
// ═══════════════════════════════════════════════════════════════
// 🗄️ VIDEO P4-2 & P4-4 — العقد الموحد لمزودي التخزين (LOCAL / R2)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §2.2, §7)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════
//
// مبدأ التصميم:
// - StorageService الحالي (صور/صوت/مستندات) لا يُعدَّل إطلاقاً، ويبقى المصدر الوحيد
//   لمسارات LOCAL. LocalObjectStorageProvider مجرد مُكيّف رقيق فوقه.
// - R2StorageProvider يُضاف بجانبه للفيديو فقط (storage_provider = 'R2').
// - العقد يعمل بمسارات ملفات محلية وتدفقات (Streams) فقط — لا Buffer للفيديو،
//   ولا readFile، حتى لا يُحمَّل ملف بحجم 150MB إلى الذاكرة.
// ═══════════════════════════════════════════════════════════════

import { Readable } from 'stream';

/** قيم عمود media_assets.storage_provider (المهاجرة M2) */
export type StorageProviderName = 'LOCAL' | 'R2';

/** بصمة ملف محلي محسوبة بالتدفق */
export interface LocalFileDigest {
  sizeBytes: number;
  /** SHA-256 بصيغة hex (64 محرفاً) — الصيغة المخزنة في variants_json */
  sha256Hex: string;
  /** SHA-256 بصيغة base64 — الصيغة التي يتوقعها ترويس ChecksumSHA256 في S3/R2 */
  sha256Base64: string;
}

export interface UploadFromFileOptions {
  contentType: string;
  /** إن لم تُمرَّر تُحسب بالتدفق قبل الرفع */
  digest?: LocalFileDigest;
  /** إلغاء الرفع (يُستخدم عند فقدان قفل العامل في P4-4) */
  abortSignal?: AbortSignal;
  /** يُستدعى مع كل تقدم فعلي في البايتات (مراقبة التجمد في P4-4) */
  onProgress?: (transferredBytes: number) => void;
}

export interface StoredObjectInfo {
  key: string;
  sizeBytes: number;
  etag: string | null;
}

export interface UploadResult extends StoredObjectInfo {
  /** البصمة المحلية التي رُفعت وتحقق منها المزود */
  sha256Hex: string;
  /** هل تم التحقق التدفقي الكامل من المحتوى المخزن (GetObject → SHA-256)؟ */
  verified: boolean;
}

export interface CopyObjectOptions {
  abortSignal?: AbortSignal;
}

export interface CopyObjectResult {
  key: string;
  etag: string | null;
}

export interface VerifyResult {
  ok: boolean;
  remoteBytesRead: number;
  remoteSha256Hex: string;
  /** سبب الفشل إن وُجد (بلا أي أسرار) */
  reason?: 'SIZE_MISMATCH' | 'SHA256_MISMATCH' | 'NOT_FOUND';
}

/** نتيجة فحص وجود كائن — تصنيف صريح وليس مجرد boolean (تمهيداً لـ §9.2 في P4-6) */
export type HeadOutcome =
  | { kind: 'FOUND'; info: StoredObjectInfo }
  | { kind: 'NOT_FOUND' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'ERROR'; code: string; retryable: boolean; httpStatus?: number };

export interface TransferOptions {
  abortSignal?: AbortSignal;
  onProgress?: (transferredBytes: number) => void;
}

/**
 * تصنيف حسم مصير عملية كتابة خارجية وفق معيار v1.7:
 * - settled: true فقط عند استجابة نجاح نهائية مؤكدة أو إلغاء مؤكد قبل تثبيت الكائن.
 * - settled: false عند أي انقطاع اتصال أو انتهاء مهلة أو إجهاض محلي غير مؤكد أو خطأ 5xx.
 */
export type WriteSettlementOutcome =
  | {
      settled: true;
      reason: 'DEFINITIVE_SUCCESS' | 'DEFINITIVE_ABORT_OR_PRE_COMMIT_REJECT';
    }
  | {
      settled: false;
      reason: 'AMBIGUOUS_OUTCOME';
    };

export interface ObjectStorageProvider {
  readonly name: StorageProviderName;

  /** يرفع ملفاً محلياً بالتدفق إلى المفتاح المحدد، ثم يتحقق من سلامته. لا يحذف الملف المحلي أبداً. */
  uploadFromFile(
    localPath: string,
    key: string,
    options: UploadFromFileOptions,
  ): Promise<UploadResult>;

  /** ينسخ كائناً مخزناً من مفتاح مصدر إلى مفتاح هدف داخل نفس المزود (لـ MOVE_SOURCE). */
  copyObject(
    sourceKey: string,
    destinationKey: string,
    options?: CopyObjectOptions,
  ): Promise<CopyObjectResult>;

  /** يقرأ الكائن المخزن بالتدفق ويحسب SHA-256 ويقارنه بالبصمة المتوقعة. */
  verifyStoredObjectSha256(
    key: string,
    expected: LocalFileDigest,
    options?: TransferOptions,
  ): Promise<VerifyResult>;

  /** فحص الوجود مع تصنيف صريح للأخطاء. */
  headObject(key: string): Promise<HeadOutcome>;

  /** تدفق قراءة للكائن (اختياري: نطاق بايتات). */
  getObjectStream(
    key: string,
    range?: { start: number; end?: number },
  ): Promise<Readable>;

  /** حذف كائن واحد. غياب الكائن لا يُعد خطأً. */
  deleteObject(key: string): Promise<void>;
}
