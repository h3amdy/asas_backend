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
      const cleanDbUrl = this.sanitizeDatabaseUrl(databaseUrl);
      await execFileAsync('pg_dump', [
        '--dbname', cleanDbUrl,
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
      const keysSet = new Set<string>();
      let inMediaTable = false;
      let storageKeyIndex = -1;
      let variantsJsonIndex = -1;

      const rl = readline.createInterface({
        input: fs.createReadStream(sqlFilePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      rl.on('line', (line: string) => {
        // بداية نسخ بيانات الجدول
        if (
          line.startsWith('COPY') &&
          line.includes('media_assets')
        ) {
          inMediaTable = true;
          // استخراج ترتيب الأعمدة لمعرفة موقع storage_key و variants_json
          const columnsMatch = line.match(/\(([^)]+)\)/);
          if (columnsMatch) {
            const columns = columnsMatch[1]
              .split(',')
              .map((c) => c.trim());
            storageKeyIndex = columns.indexOf('storage_key');
            variantsJsonIndex = columns.indexOf('variants_json');
          }
          return;
        }

        // نهاية بيانات الجدول
        if (inMediaTable && line === '\\.') {
          inMediaTable = false;
          return;
        }

        // استخراج storage_key + variants_json من كل سطر بيانات
        if (inMediaTable) {
          const fields = line.split('\t');

          // 1. storage_key الأساسي
          if (storageKeyIndex >= 0 && fields.length > storageKeyIndex) {
            const key = fields[storageKeyIndex];
            if (key && key !== '\\N') {
              keysSet.add(key);
            }
          }

          // 2. استخراج كل storage_key من variants_json
          // بعد المعالجة، الصور تُحذف original.jpg وتُنشأ original.webp + medium.webp + small.webp
          // هذه المسارات موجودة فقط في variants_json وليس في storage_key
          if (variantsJsonIndex >= 0 && fields.length > variantsJsonIndex) {
            const variantsRaw = fields[variantsJsonIndex];
            if (variantsRaw && variantsRaw !== '\\N') {
              try {
                const variants = JSON.parse(variantsRaw);
                for (const variantName of Object.keys(variants)) {
                  const variant = variants[variantName];
                  if (variant?.storage_key) {
                    keysSet.add(variant.storage_key);
                  }
                }
              } catch {
                // تجاهل JSON غير صالح
              }
            }
          }
        }
      });

      rl.on('close', () => resolve(Array.from(keysSet)));
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

  /**
   * تنقية رابط الاتصال من أي Query Parameters (مثل ?schema=public)
   * التي يرفضها libpq/pg_dump/psql
   */
  private sanitizeDatabaseUrl(databaseUrl: string): string {
    try {
      const parsed = new URL(databaseUrl);
      parsed.search = '';
      return parsed.toString();
    } catch {
      return databaseUrl;
    }
  }
}
