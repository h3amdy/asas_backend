// src/owner/backup/storage/storage-provider.interface.ts

/**
 * واجهة مزود التخزين (DEC-004)
 *
 * في MVP: Local Storage فقط
 * مستقبلاً: S3, MinIO, Remote Server
 */
export interface StorageProvider {
  /**
   * اسم مزود التخزين (مثل 'LOCAL', 'S3')
   */
  readonly name: string;

  /**
   * فحص صلاحيات الكتابة
   */
  canWrite(basePath: string): Promise<boolean>;

  /**
   * الحصول على المساحة المتاحة (بالبايت)
   */
  getAvailableSpace(basePath: string): Promise<bigint>;

  /**
   * التأكد من وجود المجلد وإنشاؤه إذا لم يكن موجوداً
   */
  ensureDirectory(dirPath: string): Promise<void>;

  /**
   * نقل ملف (atomic move — للتنشيط من temp إلى completed)
   */
  moveFile(source: string, destination: string): Promise<void>;

  /**
   * نسخ ملف
   */
  copyFile(source: string, destination: string): Promise<void>;

  /**
   * حذف ملف
   */
  deleteFile(filePath: string): Promise<void>;

  /**
   * حذف مجلد بكل محتوياته
   */
  deleteDirectory(dirPath: string): Promise<void>;

  /**
   * التحقق من وجود ملف
   */
  fileExists(filePath: string): Promise<boolean>;

  /**
   * الحصول على حجم ملف (بالبايت)
   */
  getFileSize(filePath: string): Promise<bigint>;

  /**
   * قراءة ملف كـ stream (للتحميل)
   */
  createReadStream(filePath: string): NodeJS.ReadableStream;

  /**
   * سرد الملفات في مجلد
   */
  listFiles(dirPath: string): Promise<string[]>;
}

/**
 * ثوابت مسارات التخزين
 */
export const STORAGE_DIRS = {
  /** النسخ الناجحة والمتاحة للاستعادة */
  COMPLETED: 'completed',
  /** ملفات مؤقتة أثناء الإنشاء */
  TEMP: 'temp',
  /** نسخ فشلت — للتشخيص */
  FAILED: 'failed',
} as const;
