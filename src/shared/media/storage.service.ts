// src/school/media/storage.service.ts
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface TempFileReconciliationResult {
  reconciled: boolean;
  previousDiskBytes: number;
  currentDiskBytes: number;
}

/**
 * 📁 خدمة التخزين على VPS
 * - مسار التخزين: /storage/{school_uuid}/{asset_uuid}/{variant}.{ext}
 * - المسار المؤقت: /storage/tmp/{session_uuid}.part
 * - قابل للترحيل لاحقاً إلى S3/R2
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly basePath: string;

  constructor() {
    this.basePath = path.resolve(process.env.MEDIA_STORAGE_PATH || './storage');
    this.ensureDir(this.basePath);
    this.ensureDir(path.join(this.basePath, 'tmp'));
    this.ensureDir(path.join(this.basePath, 'tmp', 'video-staging'));
  }

  // ── Paths ──

  getTempPath(sessionUuid: string): string {
    return path.join(this.basePath, 'tmp', `${sessionUuid}.part`);
  }

  getAssetDir(schoolUuid: string, assetUuid: string): string {
    return path.join(this.basePath, schoolUuid, assetUuid);
  }

  getVariantPath(
    schoolUuid: string,
    assetUuid: string,
    variant: string,
    ext: string,
  ): string {
    return path.join(
      this.getAssetDir(schoolUuid, assetUuid),
      `${variant}.${ext}`,
    );
  }

  /** Storage key (relative, stored in DB) */
  buildStorageKey(
    schoolUuid: string,
    assetUuid: string,
    variant: string,
    ext: string,
  ): string {
    return `${schoolUuid}/${assetUuid}/${variant}.${ext}`;
  }

  /** Resolve storage key → absolute path */
  resolvePath(storageKey: string): string {
    return path.join(this.basePath, storageKey);
  }

  // ── File Operations ──

  /** Append bytes to a temp file */
  async appendToTemp(sessionUuid: string, chunk: Buffer): Promise<void> {
    const tempPath = this.getTempPath(sessionUuid);
    await fs.promises.appendFile(tempPath, chunk);
  }

  /**
   * مصالحة حجم الملف المؤقت على القرص مع العداد الملتزم به في قاعدة البيانات (committedBytes).
   * - إذا كان حجم القرص أكبر من committedBytes (بسبب انقطاع العملية أو فشل DB بعد الكتابة):
   *   يُقصّ الذيل غير الملتزم به ذرّياً (truncate + datasync) ليعود الملف مطابقاً لـ committedBytes.
   * - إذا كان حجم القرص أصغر من committedBytes (فقدان بيانات سبق الالتزام بها):
   *   يرمي ConflictException('TEMP_FILE_CORRUPTED') ويمنع قبول أجزاء جديدة أو إكمال الجلسة.
   */
  async reconcileTempFile(
    sessionUuid: string,
    committedBytes: number,
  ): Promise<TempFileReconciliationResult> {
    const tempPath = this.getTempPath(sessionUuid);
    let diskBytes = -1;
    try {
      const stat = await fs.promises.stat(tempPath);
      diskBytes = stat.size;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw e;
      }
    }

    if (diskBytes < 0) {
      if (committedBytes === 0) {
        return {
          reconciled: false,
          previousDiskBytes: 0,
          currentDiskBytes: 0,
        };
      }
      throw new ConflictException({
        error: 'TEMP_FILE_MISSING',
        reason: 'COMMITTED_BYTES_MISSING_ON_DISK',
        committed_bytes: committedBytes,
        actual_file_bytes: 0,
      });
    }

    if (diskBytes === committedBytes) {
      return {
        reconciled: false,
        previousDiskBytes: diskBytes,
        currentDiskBytes: diskBytes,
      };
    }

    if (diskBytes < committedBytes) {
      throw new ConflictException({
        error: 'TEMP_FILE_CORRUPTED',
        reason: 'DISK_SIZE_SMALLER_THAN_COMMITTED',
        committed_bytes: committedBytes,
        actual_file_bytes: diskBytes,
      });
    }

    // diskBytes > committedBytes: قصّ الذيل غير الملتزم به في قاعدة البيانات (Recovery)
    if (committedBytes === 0) {
      await this.deleteTempFile(sessionUuid);
    } else {
      const fh = await fs.promises.open(tempPath, 'r+');
      try {
        await fh.truncate(committedBytes);
        await fh.datasync();
      } finally {
        await fh.close();
      }
    }

    this.logger.warn(
      `مصالحة ملف الرفع المؤقت للجلسة ${sessionUuid}: قصّ الذيل غير الملتزم من ${diskBytes} إلى ${committedBytes} بايت`,
    );

    return {
      reconciled: true,
      previousDiskBytes: diskBytes,
      currentDiskBytes: committedBytes,
    };
  }

  /**
   * كتابة جزء عند إزاحة صريحة (offset) بعد مصالحة حجم الملف الفعلي،
   * مع مزامنة القرص (datasync) والتحقق الفعلي من الحجم الناتج قبل تحديث قاعدة البيانات.
   */
  async writeChunkAtOffset(
    sessionUuid: string,
    chunk: Buffer,
    offset: number,
  ): Promise<number> {
    await this.reconcileTempFile(sessionUuid, offset);

    const tempPath = this.getTempPath(sessionUuid);
    this.ensureDir(path.dirname(tempPath));
    const flags = offset === 0 && !fs.existsSync(tempPath) ? 'w+' : 'r+';
    const fh = await fs.promises.open(tempPath, flags);
    try {
      let written = 0;
      while (written < chunk.length) {
        const { bytesWritten } = await fh.write(
          chunk,
          written,
          chunk.length - written,
          offset + written,
        );
        if (bytesWritten <= 0) {
          throw new ConflictException('CHUNK_WRITE_STALLED');
        }
        written += bytesWritten;
      }
      await fh.datasync();
      const postStat = await fh.stat();
      const expectedNewSize = offset + chunk.length;
      if (postStat.size !== expectedNewSize) {
        throw new ConflictException({
          error: 'CHUNK_WRITE_SIZE_MISMATCH',
          expected_bytes: expectedNewSize,
          actual_file_bytes: postStat.size,
        });
      }
      return postStat.size;
    } finally {
      await fh.close();
    }
  }

  /**
   * التراجع عن كتابة جزء على القرص إذا فشل تحديث قاعدة البيانات بعد الكتابة.
   */
  async rollbackChunkWrite(
    sessionUuid: string,
    previousCommittedBytes: number,
  ): Promise<void> {
    try {
      if (previousCommittedBytes <= 0) {
        await this.deleteTempFile(sessionUuid);
        return;
      }
      const tempPath = this.getTempPath(sessionUuid);
      const fh = await fs.promises.open(tempPath, 'r+');
      try {
        await fh.truncate(previousCommittedBytes);
        await fh.datasync();
      } finally {
        await fh.close();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `تعذّر التراجع عن كتابة الجزء للجلسة ${sessionUuid} إلى الإزاحة ${previousCommittedBytes}: ${msg}`,
      );
    }
  }

  /** Get size of temp file (for validation) */
  async getTempFileSize(sessionUuid: string): Promise<number> {
    const tempPath = this.getTempPath(sessionUuid);
    try {
      const stat = await fs.promises.stat(tempPath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /** Move temp file to final location with a given storage key */
  async moveToFinal(sessionUuid: string, storageKey: string): Promise<void> {
    const tempPath = this.getTempPath(sessionUuid);
    const finalPath = this.resolvePath(storageKey);
    this.ensureDir(path.dirname(finalPath));
    await fs.promises.rename(tempPath, finalPath);
  }

  /** Save buffer to a storage key directly (for processed variants) */
  async saveBuffer(storageKey: string, buffer: Buffer): Promise<void> {
    const finalPath = this.resolvePath(storageKey);
    this.ensureDir(path.dirname(finalPath));
    await fs.promises.writeFile(finalPath, buffer);
  }

  /** Get read stream for serving downloads */
  getReadStream(
    storageKey: string,
    start?: number,
    end?: number,
  ): fs.ReadStream {
    const filePath = this.resolvePath(storageKey);
    const options: { start?: number; end?: number } = {};
    if (start !== undefined) options.start = start;
    if (end !== undefined) options.end = end;
    return fs.createReadStream(filePath, options);
  }

  /** Get file size */
  async getFileSize(storageKey: string): Promise<number> {
    const filePath = this.resolvePath(storageKey);
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  }

  /** Check existence */
  async fileExists(storageKey: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolvePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /** Delete a file */
  async deleteFile(storageKey: string): Promise<void> {
    try {
      await fs.promises.unlink(this.resolvePath(storageKey));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    }
  }

  /** Delete temp file */
  async deleteTempFile(sessionUuid: string): Promise<void> {
    try {
      await fs.promises.unlink(this.getTempPath(sessionUuid));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    }
  }

  /** Delete all files for an asset */
  async deleteAssetDir(schoolUuid: string, assetUuid: string): Promise<void> {
    const dir = this.getAssetDir(schoolUuid, assetUuid);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    }
  }

  // ── Helpers ──

  /** Get the base path (used by DiskSpaceGuardService) */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * مسار video-staging: tmp/video-staging/{assetUuid}/source.{ext}
   * يُستخدم بعد نجاح ffprobe ونقل الملف من tmp/{sessionUuid}.part
   */
  getVideoStagingDir(assetUuid: string): string {
    return path.join(this.basePath, 'tmp', 'video-staging', assetUuid);
  }

  getVideoStagingPath(assetUuid: string, ext: string): string {
    return path.join(this.getVideoStagingDir(assetUuid), `source.${ext}`);
  }

  /**
   * ينقل الملف المؤقت إلى video-staging بشكل ذرّي.
   * tmp/{sessionUuid}.part → tmp/video-staging/{assetUuid}/source.{ext}
   */
  async moveToVideoStaging(
    sessionUuid: string,
    assetUuid: string,
    ext: string,
  ): Promise<string> {
    const tempPath = this.getTempPath(sessionUuid);
    const stagingDir = this.getVideoStagingDir(assetUuid);
    this.ensureDir(stagingDir);
    const stagingPath = this.getVideoStagingPath(assetUuid, ext);
    await fs.promises.rename(tempPath, stagingPath);
    return `tmp/video-staging/${assetUuid}/source.${ext}`;
  }

  /** حذف مجلد video-staging لأصل معين */
  async deleteVideoStagingDir(assetUuid: string): Promise<void> {
    const dir = this.getVideoStagingDir(assetUuid);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.log(`Created storage directory: ${dir}`);
    }
  }
}
