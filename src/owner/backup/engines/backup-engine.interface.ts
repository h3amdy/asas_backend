// src/owner/backup/engines/backup-engine.interface.ts

/**
 * واجهة محرك النسخ الاحتياطي (DEC-009)
 *
 * أساس هو Orchestrator — كل محرك مسؤول عن مكون واحد فقط.
 * في MVP: PgDumpEngine, MediaBackupEngine, ConfigBackupEngine
 */

export interface BackupEngineResult {
  success: boolean;
  /** مسار المخرجات الرئيسية (ملف أو مجلد حسب نوع المحرك) */
  outputPath: string;
  /** الحجم بالبايت */
  sizeBytes: bigint;
  /** مدة التنفيذ بالمللي ثانية */
  durationMs: number;
  /** تفاصيل إضافية حسب المحرك */
  details?: Record<string, unknown>;
  /** رسالة الخطأ في حالة الفشل */
  errorMessage?: string;
}

/**
 * بيانات ملف وسائط مُخزّن في R2 — تُسجّل في r2_manifest.json داخل الأرشيف
 * لتمكين التحقق عند الاستعادة بدون الحاجة لنسخ الملفات محلياً.
 */
export interface R2ManifestEntry {
  /** مفتاح التخزين في R2 (مثال: owner-uuid/image/uuid.webp) */
  storageKey: string;
  /** نوع الوسائط (IMAGE, VIDEO, DOCUMENT, …) */
  kind: string;
  /** UUID الخاص بالـ media asset */
  assetUuid: string;
}

export interface DatabaseBackupResult extends BackupEngineResult {
  details: {
    /** SHA-256 لملف الـ dump */
    sha256: string;
    /** قائمة storage_keys المحلية فقط (LOCAL) لنسخها في الأرشيف */
    mediaStorageKeys: string[];
    /** قائمة ملفات R2 — لا تُنسخ بل تُسجّل في r2_manifest.json */
    r2MediaKeys: R2ManifestEntry[];
    /**
     * ⚠️ قيد معروف: القوائم تُحفظ كاملة في الذاكرة.
     * إذا تجاوز عدد الملفات مئات الآلاف، يجب الانتقال إلى
     * Stream/Iterator أو ملف مؤقت.
     */
  };
}

export interface MediaBackupResult extends BackupEngineResult {
  details: {
    filesExpected: number;
    filesCopied: number;
    /** مفاتيح التخزين المفقودة من القرص */
    missingStorageKeys: string[];
  };
}

export interface ConfigBackupResult extends BackupEngineResult {
  details: {
    files: string[];
    /** ملفات مطلوبة فشل نسخها */
    failedRequired?: string[];
    /** ملفات اختيارية تم تخطيها */
    skippedOptional?: string[];
  };
}
