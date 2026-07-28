// src/owner/backup/engines/media-backup.engine.ts

import { Injectable, Logger } from '@nestjs/common';
import { MediaBackupResult } from './backup-engine.interface';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * محرك نسخ الوسائط (DEC-008 Consistency)
 *
 * ينسخ ملفات الوسائط بناءً على القائمة المستخرجة من pg_dump
 * وليس من قاعدة البيانات الحية — لضمان التناسق.
 *
 * الحالات:
 * - SUCCESS: كل الملفات المتوقعة نُسخت
 * - PARTIAL_SUCCESS: بعض الملفات مفقودة من القرص
 */
@Injectable()
export class MediaBackupEngine {
  private readonly logger = new Logger(MediaBackupEngine.name);

  /**
   * نسخ ملفات الوسائط
   * @param workDir مجلد العمل المؤقت
   * @param mediaBasePath المسار الأساسي للوسائط (/var/data/asas/storage)
   * @param storageKeys قائمة storage_keys المستخرجة من الـ dump
   */
  async execute(
    workDir: string,
    mediaBasePath: string,
    storageKeys: string[],
  ): Promise<MediaBackupResult> {
    const startTime = Date.now();
    const mediaDir = path.join(workDir, 'media');
    const resolvedBase = path.resolve(mediaBasePath);

    try {
      await fsp.mkdir(mediaDir, { recursive: true });

      const filesExpected = storageKeys.length;
      let filesCopied = 0;
      let totalSize = BigInt(0);
      const missingStorageKeys: string[] = [];

      this.logger.log(
        `Starting media backup: ${filesExpected} files expected`,
      );

      for (const storageKey of storageKeys) {
        const sourcePath = path.resolve(mediaBasePath, storageKey);

        // ⚠️ حماية أمنية ضد Path Traversal
        // إذا كان storageKey يحتوي ../ فسيخرج من مجلد الوسائط
        if (!sourcePath.startsWith(resolvedBase)) {
          this.logger.warn(
            `Path traversal detected, skipping: ${storageKey}`,
          );
          missingStorageKeys.push(storageKey);
          continue;
        }

        const destPath = path.join(mediaDir, storageKey);

        try {
          // إنشاء مجلد الوجهة
          await fsp.mkdir(path.dirname(destPath), { recursive: true });

          // نسخ الملف مباشرة — بدون access() منفصلة (توفير I/O)
          await fsp.copyFile(sourcePath, destPath);

          // حساب الحجم
          const stats = await fsp.stat(sourcePath);
          totalSize += BigInt(stats.size);

          filesCopied++;
        } catch (error: unknown) {
          const errCode =
            error && typeof error === 'object' && 'code' in error
              ? (error as { code: string }).code
              : undefined;

          if (errCode === 'ENOENT') {
            missingStorageKeys.push(storageKey);
          } else {
            missingStorageKeys.push(storageKey);
            const errMsg =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to copy media file ${storageKey}: ${errMsg}`,
            );
          }
        }

        // تسجيل التقدم كل 500 ملف (بدلاً من كل ملف مفقود)
        const processed = filesCopied + missingStorageKeys.length;
        if (processed % 500 === 0) {
          this.logger.log(
            `Media backup progress: ${processed}/${filesExpected} (${missingStorageKeys.length} missing)`,
          );
        }
      }

      const durationMs = Date.now() - startTime;
      const sizeMB = Number(totalSize / BigInt(1048576));

      // ملخص واحد بدلاً من تحذير لكل ملف مفقود
      this.logger.log(
        `Media backup completed: ${filesCopied}/${filesExpected} files (${sizeMB} MB) in ${durationMs}ms`,
      );
      if (missingStorageKeys.length > 0) {
        this.logger.warn(
          `${missingStorageKeys.length} media files were missing from disk`,
        );
      }

      return {
        success: true,
        outputPath: mediaDir,
        sizeBytes: totalSize,
        durationMs,
        details: {
          filesExpected,
          filesCopied,
          missingStorageKeys,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Media backup failed: ${errorMsg}`);

      return {
        success: false,
        outputPath: '',
        sizeBytes: BigInt(0),
        durationMs,
        errorMessage: errorMsg,
        details: {
          filesExpected: storageKeys.length,
          filesCopied: 0,
          missingStorageKeys: [],
        },
      };
    }
  }
}
