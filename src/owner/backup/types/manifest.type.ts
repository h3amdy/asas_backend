// src/owner/backup/types/manifest.type.ts

/**
 * هيكل manifest.json داخل حزمة النسخة الاحتياطية
 * يمثل بطاقة هوية النسخة — مكتفية ذاتياً
 */
export interface BackupManifest {
  /** UUID النسخة */
  backupId: string;

  /** إصدار صيغة الحزمة (للتوافق المستقبلي) */
  backupFormatVersion: string;

  /** تاريخ الإنشاء */
  createdAt: string;

  /** إصدار تطبيق أساس */
  systemVersion: string;

  /** إصدار مخطط قاعدة البيانات (Prisma migration) */
  databaseSchemaVersion: string | null;

  /** نوع النسخة */
  backupType: 'FULL';

  /** مصدر التشغيل */
  triggerType: 'MANUAL' | 'SCHEDULED' | 'PRE_RESTORE';

  /** تصنيف النسخة */
  category: 'NORMAL' | 'SYSTEM_SAFETY';

  /** مكونات النسخة */
  components: {
    database: ManifestDatabaseComponent | null;
    media: ManifestMediaComponent | null;
    config: ManifestConfigComponent | null;
  };

  /** تقرير التناسق (DEC-008) */
  consistency: ManifestConsistency;

  /** checksums لكل ملف داخل الأرشيف */
  checksums: Record<string, string>;
}

export interface ManifestDatabaseComponent {
  included: true;
  engine: 'pg_dump';
  format: 'sql.gz';
  file: string;
  sizeBytes: number;
  sha256: string;
}

export interface ManifestMediaComponent {
  included: true;
  directory: string;
  filesExpected: number;
  filesCopied: number;
  sizeBytes: number;
}

export interface ManifestConfigComponent {
  included: true;
  directory: string;
  files: string[];
  sizeBytes: number;
}

export interface ManifestConsistency {
  databaseSnapshot: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  missingStorageKeys: string[];
}
