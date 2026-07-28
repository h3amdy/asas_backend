// src/owner/backup/storage/local-storage.provider.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  StorageProvider,
  STORAGE_DIRS,
} from './storage-provider.interface';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** المسار الافتراضي — يقرأ من البيئة أو يستعمل ./backups */
function getDefaultStoragePath(): string {
  return path.resolve(process.env.BACKUP_STORAGE_PATH || './backups');
}

/**
 * مزود التخزين المحلي (DEC-004 — MVP)
 *
 * يخزن النسخ الاحتياطية في نظام الملفات المحلي:
 * BACKUP_STORAGE_PATH/
 * ├── completed/   ← النسخ الناجحة
 * ├── temp/        ← ملفات مؤقتة أثناء الإنشاء
 * └── failed/      ← نسخ فشلت (للتشخيص)
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider, OnModuleInit {
  private readonly logger = new Logger(LocalStorageProvider.name);

  readonly name = 'LOCAL';

  /**
   * تهيئة بنية المجلدات عند بدء تشغيل التطبيق
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.initializeStorage(getDefaultStoragePath());
    } catch (error: any) {
      this.logger.warn(
        `Failed to initialize default storage: ${error.message}`,
      );
    }
  }

  /**
   * التأكد من جاهزية بنية المجلدات
   */
  async initializeStorage(basePath: string): Promise<void> {
    for (const dir of Object.values(STORAGE_DIRS)) {
      const fullPath = path.join(basePath, dir);
      await this.ensureDirectory(fullPath);
    }
    this.logger.log(`Storage initialized at: ${basePath}`);
  }

  async canWrite(basePath: string): Promise<boolean> {
    try {
      const testFile = path.join(basePath, '.write-test');
      await fsp.writeFile(testFile, 'test');
      await fsp.unlink(testFile);
      return true;
    } catch {
      return false;
    }
  }

  async getAvailableSpace(basePath: string): Promise<bigint> {
    try {
      // df --output=avail -B1 <path> → يعطي المساحة المتاحة بالبايت
      const { stdout } = await execFileAsync('df', [
        '--output=avail',
        '-B1',
        basePath,
      ]);
      const lines = stdout.trim().split('\n');
      // السطر الثاني يحتوي الرقم
      const availableStr = lines[lines.length - 1].trim();
      return BigInt(availableStr);
    } catch (error) {
      this.logger.warn(
        `Failed to get disk space for ${basePath}: ${error.message}`,
      );
      return BigInt(0);
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    await fsp.mkdir(dirPath, { recursive: true });
  }

  async moveFile(source: string, destination: string): Promise<void> {
    await this.ensureDirectory(path.dirname(destination));
    try {
      // rename أسرع وatomic — لكن يعمل فقط على نفس filesystem
      await fsp.rename(source, destination);
    } catch (error) {
      if (error.code === 'EXDEV') {
        // المصدر والوجهة على أنظمة ملفات مختلفة → fallback: copy + delete
        this.logger.debug(
          `Cross-device move detected, using copy+delete fallback`,
        );
        await fsp.copyFile(source, destination);
        await fsp.unlink(source);
      } else {
        throw error;
      }
    }
    this.logger.debug(`Moved: ${source} → ${destination}`);
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await this.ensureDirectory(path.dirname(destination));
    await fsp.copyFile(source, destination);
    this.logger.debug(`Copied: ${source} → ${destination}`);
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fsp.unlink(filePath);
      this.logger.debug(`Deleted file: ${filePath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // الملف غير موجود أصلاً — ليس خطأ
    }
  }

  /**
   * حذف مجلد بكل محتوياته
   * ⚠️ يُستخدم فقط للمجلدات المؤقتة (temp/) — لا للبيانات الأصلية
   */
  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      await fsp.rm(dirPath, { recursive: true, force: true });
      this.logger.debug(`Deleted directory: ${dirPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getFileSize(filePath: string): Promise<bigint> {
    const stats = await fsp.stat(filePath);
    return BigInt(stats.size);
  }

  createReadStream(filePath: string): NodeJS.ReadableStream {
    return fs.createReadStream(filePath);
  }

  async listFiles(dirPath: string): Promise<string[]> {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
}
