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
  /** هل هو مطلوب أم اختياري؟ */
  required: boolean;
}

/**
 * محرك نسخ الإعدادات (DEC-001)
 *
 * ينسخ ملفات الإعدادات المعتمدة فقط (Whitelist):
 * - .env (مطلوب — يحتوي إعدادات التطبيق الأساسية)
 * - nginx config (اختياري — يعتمد على بيئة التشغيل)
 * - pm2 config (اختياري — فقط إذا وُجد في المشروع)
 *
 * لا ينسخ أي ملفات تنفيذية أو كود التطبيق.
 */
@Injectable()
export class ConfigBackupEngine {
  private readonly logger = new Logger(ConfigBackupEngine.name);

  /**
   * بناء قائمة الملفات المعتمدة للنسخ
   * يميّز بين الملفات المطلوبة والاختيارية
   */
  private getConfigFiles(projectRoot: string): ConfigFileEntry[] {
    const files: ConfigFileEntry[] = [
      // .env — مطلوب دائماً
      {
        name: '.env',
        sourcePath: path.join(projectRoot, '.env'),
        required: true,
      },
    ];

    // Nginx — اختياري، يُضبط عبر NGINX_CONFIG_PATH
    const nginxPath = process.env.NGINX_CONFIG_PATH;
    if (nginxPath) {
      files.push({
        name: 'nginx.conf',
        sourcePath: nginxPath,
        required: false,
      });
    }

    // PM2 — اختياري، فقط إذا وُجد فعلاً في المشروع
    const pm2Candidates = ['pm2.config.js', 'ecosystem.config.js'];
    for (const candidate of pm2Candidates) {
      const candidatePath = path.join(projectRoot, candidate);
      try {
        require('fs').accessSync(candidatePath);
        files.push({
          name: candidate,
          sourcePath: candidatePath,
          required: false,
        });
        break;
      } catch {
        // الملف غير موجود — نتخطاه بصمت
      }
    }

    return files;
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
      const failedRequired: string[] = [];
      const skippedOptional: string[] = [];
      let totalSize = BigInt(0);

      for (const { name, sourcePath, required } of filesToCopy) {
        try {
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
            if (required) {
              failedRequired.push(name);
              this.logger.error(
                `Required config file not found: ${name} at ${sourcePath}`,
              );
            } else {
              skippedOptional.push(name);
              this.logger.debug(
                `Optional config file not found (skipped): ${name}`,
              );
            }
          } else if (errCode === 'EACCES') {
            if (required) {
              failedRequired.push(name);
              this.logger.error(
                `Required config file not accessible: ${name} at ${sourcePath}`,
              );
            } else {
              skippedOptional.push(name);
              this.logger.warn(
                `Optional config file not accessible (skipped): ${name}`,
              );
            }
          } else {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            if (required) {
              failedRequired.push(name);
              this.logger.error(`Failed to copy required config ${name}: ${errMsg}`);
            } else {
              skippedOptional.push(name);
              this.logger.warn(`Failed to copy optional config ${name}: ${errMsg}`);
            }
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const success = failedRequired.length === 0;

      this.logger.log(
        `Config backup completed: ${copiedFiles.length}/${filesToCopy.length} files in ${durationMs}ms` +
          (failedRequired.length > 0
            ? ` (${failedRequired.length} required FAILED: ${failedRequired.join(', ')})`
            : '') +
          (skippedOptional.length > 0
            ? ` (${skippedOptional.length} optional skipped: ${skippedOptional.join(', ')})`
            : ''),
      );

      return {
        success,
        outputPath: configDir,
        sizeBytes: totalSize,
        durationMs,
        errorMessage: failedRequired.length > 0
          ? `Required config files missing: ${failedRequired.join(', ')}`
          : undefined,
        details: {
          files: copiedFiles,
          failedRequired,
          skippedOptional,
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
          failedRequired: [],
          skippedOptional: [],
        },
      };
    }
  }
}
