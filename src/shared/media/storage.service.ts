// src/school/media/storage.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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
        this.basePath = process.env.MEDIA_STORAGE_PATH || '/var/data/asas/storage';
        this.ensureDir(this.basePath);
        this.ensureDir(path.join(this.basePath, 'tmp'));
    }

    // ── Paths ──

    getTempPath(sessionUuid: string): string {
        return path.join(this.basePath, 'tmp', `${sessionUuid}.part`);
    }

    getAssetDir(schoolUuid: string, assetUuid: string): string {
        return path.join(this.basePath, schoolUuid, assetUuid);
    }

    getVariantPath(schoolUuid: string, assetUuid: string, variant: string, ext: string): string {
        return path.join(this.getAssetDir(schoolUuid, assetUuid), `${variant}.${ext}`);
    }

    /** Storage key (relative, stored in DB) */
    buildStorageKey(schoolUuid: string, assetUuid: string, variant: string, ext: string): string {
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
    getReadStream(storageKey: string, start?: number, end?: number): fs.ReadStream {
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
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }
    }

    /** Delete temp file */
    async deleteTempFile(sessionUuid: string): Promise<void> {
        try {
            await fs.promises.unlink(this.getTempPath(sessionUuid));
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }
    }

    /** Delete all files for an asset */
    async deleteAssetDir(schoolUuid: string, assetUuid: string): Promise<void> {
        const dir = this.getAssetDir(schoolUuid, assetUuid);
        try {
            await fs.promises.rm(dir, { recursive: true, force: true });
        } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
        }
    }

    // ── Helpers ──

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            this.logger.log(`Created storage directory: ${dir}`);
        }
    }
}
