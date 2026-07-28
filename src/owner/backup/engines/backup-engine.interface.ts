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

export interface DatabaseBackupResult extends BackupEngineResult {
  details: {
    /** SHA-256 لملف الـ dump */
    sha256: string;
    /** قائمة storage_keys من الـ snapshot لنسخ الوسائط */
    mediaStorageKeys: string[];
    /**
     * ⚠️ قيد معروف: القائمة تُحفظ كاملة في الذاكرة.
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
  };
}
