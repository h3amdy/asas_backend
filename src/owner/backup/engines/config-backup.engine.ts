// src/owner/backup/engines/config-backup.engine.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigBackupResult } from './backup-engine.interface';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * ملف إعدادات للنسخ
 */
interface ConfigFileEntry {
  /** الاسم المعروض (يُستخدم كاسم الملف في النسخة) */
  name: string;
  /** المسار الكامل للملف المصدر */
  sourcePath: string;
}

/**
 * محرك نسخ الإعدادات (DEC-001)
 *
 * ينسخ ملفات الإعدادات المعتمدة فقط (Whitelist):
 * - .env
 * - nginx.conf (إعدادات Nginx)
 * - pm2.config.js (إعدادات PM2)
 *
 * لا ينسخ أي ملفات تنفيذية أو كود التطبيق.
 */
@Injectable()
export class ConfigBackupEngine {
  private readonly logger = new Logger(ConfigBackupEngine.name);

  /**
   * بناء قائمة الملفات المعتمدة للنسخ
   * مصدر واحد للحقيقة — لا تكرار
   */
  private getConfigFiles(projectRoot: string): ConfigFileEntry[] {
    return [
      {
        name: '.env',
        sourcePath: path.join(projectRoot, '.env'),
      },
      {
        name: 'nginx.conf',
        sourcePath: '/etc/nginx/sites-available/asas',
      },
      {
        name: 'pm2.config.js',
        sourcePath: path.join(projectRoot, 'pm2.config.js'),
      },
    ];
  }

  /**
   * نسخ ملفات الإعدادات
   * @param workDir مجلد العمل المؤقت
   * @param projectRoot مسار مشروع الباكيند
   */
  async execute(
    workDir: string,
    projectRoot: string,
  ): Promise<ConfigBackupResult> {
    const startTime = Date.now();
    const configDir = path.join(workDir, 'config');

    try {
      await fsp.mkdir(configDir, { recursive: true });

      const filesToCopy = this.getConfigFiles(projectRoot);
      const copiedFiles: string[] = [];
      let totalSize = BigInt(0);

      for (const { name, sourcePath } of filesToCopy) {
        try {
          // نسخ مباشرة — بدون access() منفصلة (توفير I/O)
          const destPath = path.join(configDir, name);
          await fsp.copyFile(sourcePath, destPath);

          const stats = await fsp.stat(destPath);
          totalSize += BigInt(stats.size);

          copiedFiles.push(name);
          this.logger.log(`Config file copied: ${name}`);
        } catch (error: unknown) {
          const errCode =
            error && typeof error === 'object' && 'code' in error
              ? (error as { code: string }).code
              : undefined;

          if (errCode === 'ENOENT') {
            this.logger.warn(
              `Config file not found (skipped): ${name} at ${sourcePath}`,
            );
          } else if (errCode === 'EACCES') {
            this.logger.warn(
              `Config file not accessible (skipped): ${name} at ${sourcePath}`,
            );
          } else {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to copy config file ${name}: ${errMsg}`,
            );
          }
          // لا نفشل العملية — نسجل ونكمل
        }
      }

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Config backup completed: ${copiedFiles.length}/${filesToCopy.length} files in ${durationMs}ms`,
      );

      return {
        success: copiedFiles.length > 0,
        outputPath: configDir,
        sizeBytes: totalSize,
        durationMs,
        details: {
          files: copiedFiles,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Config backup failed: ${errorMsg}`);

      return {
        success: false,
        outputPath: '',
        sizeBytes: BigInt(0),
        durationMs,
        errorMessage: errorMsg,
        details: {
          files: [],
        },
      };
    }
  }
}
