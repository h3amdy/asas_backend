// src/owner/backup/engines/pg-dump.engine.ts

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseBackupResult } from './backup-engine.interface';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as readline from 'readline';

const execFileAsync = promisify(execFile);

/**
 * محرك نسخ قاعدة البيانات (DEC-009)
 *
 * يستخدم pg_dump — لا نعيد اختراع ما تقدمه أدوات ناضجة.
 *
 * الخطوات:
 * 1. تنفيذ pg_dump → postgres.sql
 * 2. استخراج قائمة الوسائط من الـ dump بـ Streaming (DEC-008)
 * 3. ضغط بـ gzip → postgres.sql.gz
 * 4. حساب SHA-256
 *
 * ⚠️ قيد معروف: استخراج media keys يعتمد على تنسيق إخراج pg_dump
 * (أسطر COPY + TSV). إذا تغير تنسيق pg_dump مستقبلاً، قد يتطلب تعديل.
 */
@Injectable()
export class PgDumpEngine {
  private readonly logger = new Logger(PgDumpEngine.name);

  /**
   * تنفيذ نسخ قاعدة البيانات
   * @param workDir مجلد العمل المؤقت
   * @param databaseUrl رابط الاتصال بقاعدة البيانات
   */
  async execute(
    workDir: string,
    databaseUrl: string,
  ): Promise<DatabaseBackupResult> {
    const startTime = Date.now();
    const dbDir = path.join(workDir, 'database');
    const sqlFile = path.join(dbDir, 'postgres.sql');
    const gzFile = path.join(dbDir, 'postgres.sql.gz');

    try {
      await fsp.mkdir(dbDir, { recursive: true });

      // 1. pg_dump
      this.logger.log('Starting pg_dump...');
      await execFileAsync('pg_dump', [
        '--dbname', databaseUrl,
        '--format', 'plain',
        '--clean',       // إضافة DROP قبل CREATE — ضروري للاستعادة
        '--if-exists',   // لا خطأ إذا الكائن غير موجود
        '--no-owner',
        '--no-privileges',
        '--file', sqlFile,
      ]);
      this.logger.log('pg_dump completed');

      // 2. استخراج قائمة الوسائط بـ Streaming (DEC-008)
      // يقرأ سطراً بسطر — لا يحمّل الملف كاملاً في الذاكرة
      const mediaStorageKeys =
        await this.extractMediaKeysFromDump(sqlFile);
      this.logger.log(
        `Extracted ${mediaStorageKeys.length} media storage keys from dump`,
      );

      // 3. ضغط بـ gzip
      this.logger.log('Compressing database dump...');
      await execFileAsync('gzip', ['-9', sqlFile]);
      // gzip يحذف الملف الأصلي ويترك .gz

      // 4. حساب SHA-256
      const sha256 = await this.computeSha256(gzFile);

      // 5. حساب الحجم
      const stats = await fsp.stat(gzFile);
      const sizeBytes = BigInt(stats.size);

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Database backup completed in ${durationMs}ms (${Number(sizeBytes / BigInt(1048576))} MB)`,
      );

      return {
        success: true,
        outputPath: gzFile,
        sizeBytes,
        durationMs,
        details: {
          sha256,
          mediaStorageKeys,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Database backup failed: ${errorMsg}`);

      return {
        success: false,
        outputPath: '',
        sizeBytes: BigInt(0),
        durationMs,
        errorMessage: errorMsg,
        details: {
          sha256: '',
          mediaStorageKeys: [],
        },
      };
    }
  }

  /**
   * استخراج قائمة مسارات الوسائط من الـ dump بـ Streaming (DEC-008)
   *
   * يستخدم readline + createReadStream لقراءة الملف سطراً بسطر
   * بدلاً من تحميله كاملاً في الذاكرة — ضروري لملفات dump كبيرة (عشرات GB).
   *
   * يقرأ SQL dump ويستخرج storage_key من جدول media_asset_variants.
   * هذا يضمن أن قائمة الملفات مأخوذة من نفس لحظة الـ snapshot.
   */
  private extractMediaKeysFromDump(
    sqlFilePath: string,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = [];
      let inMediaTable = false;
      let storageKeyIndex = -1;

      const rl = readline.createInterface({
        input: fs.createReadStream(sqlFilePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      rl.on('line', (line: string) => {
        // بداية نسخ بيانات الجدول
        if (
          line.startsWith('COPY') &&
          line.includes('media_asset_variants')
        ) {
          inMediaTable = true;
          // استخراج ترتيب الأعمدة لمعرفة موقع storage_key
          const columnsMatch = line.match(/\(([^)]+)\)/);
          if (columnsMatch) {
            const columns = columnsMatch[1]
              .split(',')
              .map((c) => c.trim());
            storageKeyIndex = columns.indexOf('storage_key');
          }
          return;
        }

        // نهاية بيانات الجدول
        if (inMediaTable && line === '\\.') {
          inMediaTable = false;
          return;
        }

        // استخراج storage_key من كل سطر بيانات
        if (inMediaTable && storageKeyIndex >= 0) {
          const fields = line.split('\t');
          if (fields.length > storageKeyIndex) {
            const key = fields[storageKeyIndex];
            if (key && key !== '\\N') {
              keys.push(key);
            }
          }
        }
      });

      rl.on('close', () => resolve(keys));
      rl.on('error', (err) => {
        this.logger.warn(
          `Failed to extract media keys from dump: ${err.message}`,
        );
        // لا نفشل العملية — نعود بقائمة فارغة
        resolve([]);
      });
    });
  }

  /**
   * حساب SHA-256 لملف (Streaming — لا يحمّل في الذاكرة)
   */
  private computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
