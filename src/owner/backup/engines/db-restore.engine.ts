// src/owner/backup/engines/db-restore.engine.ts

import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fsp from 'fs/promises';

const execFileAsync = promisify(execFile);

/**
 * نتيجة استعادة قاعدة البيانات
 */
export interface DbRestoreResult {
  success: boolean;
  durationMs: number;
  errorMessage?: string;
}

/**
 * محرك استعادة قاعدة البيانات
 *
 * يستخدم psql لاستعادة dump من pg_dump.
 *
 * ⚠️ هذه أخطر عملية في النظام:
 * - تُسقط (DROP) جميع الجداول
 * - تُعيد إنشاءها من الـ dump
 * - لا يمكن التراجع بدون Safety Backup
 *
 * الخطوات:
 * 1. فك ضغط .sql.gz → .sql
 * 2. تنفيذ psql مع الـ dump
 */
@Injectable()
export class DbRestoreEngine {
  private readonly logger = new Logger(DbRestoreEngine.name);

  /**
   * استعادة قاعدة البيانات من dump
   * @param sqlGzPath مسار ملف postgres.sql.gz
   * @param databaseUrl رابط الاتصال بقاعدة البيانات
   */
  async execute(
    sqlGzPath: string,
    databaseUrl: string,
  ): Promise<DbRestoreResult> {
    const startTime = Date.now();

    try {
      // 1. التحقق من وجود الملف
      await fsp.access(sqlGzPath);

      // 2. فك الضغط
      const sqlPath = sqlGzPath.replace('.gz', '');
      this.logger.log('Decompressing database dump...');
      await execFileAsync('gunzip', ['-k', sqlGzPath]);
      // -k يحافظ على الملف الأصلي

      // 3. تنفيذ psql
      this.logger.warn(
        '⚠️ Starting database restore — this will DROP existing tables',
      );

      try {
        await execFileAsync('psql', [databaseUrl, '-f', sqlPath], {
          maxBuffer: 100 * 1024 * 1024, // 100MB buffer للإخراج
        });
      } finally {
        // 4. حذف الملف المفكوك (تنظيف)
        try {
          await fsp.unlink(sqlPath);
        } catch {
          // تجاهل — تنظيف فقط
        }
      }

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Database restore completed in ${durationMs}ms`,
      );

      return {
        success: true,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Database restore failed: ${errorMsg}`);

      return {
        success: false,
        durationMs,
        errorMessage: errorMsg,
      };
    }
  }
}
