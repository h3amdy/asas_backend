// src/platform/media/platform-media-from-url.service.ts
import {
    Injectable, Logger,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { MediaProcessingService } from '../../shared/media/media-processing.service';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

enum MediaKind { IMAGE = 'IMAGE', AUDIO = 'AUDIO' }

/**
 * 🌐 خدمة استيراد الوسائط من URL خارجي
 * 
 * السيرفر (UK) ينزّل الملف من الرابط → يخزّنه → يرجع mediaAssetUuid
 * يحل مشكلة حجب DNS في بعض المناطق (مثل اليمن)
 */
@Injectable()
export class PlatformMediaFromUrlService {
    private readonly logger = new Logger(PlatformMediaFromUrlService.name);

    /** الحد الأقصى لحجم الملف (20MB) */
    private readonly MAX_FILE_SIZE = 20 * 1024 * 1024;

    /** timeout للتنزيل (30 ثانية) */
    private readonly DOWNLOAD_TIMEOUT_MS = 30_000;

    /** الحد الأقصى لعدد redirects */
    private readonly MAX_REDIRECTS = 5;

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
        private readonly processing: MediaProcessingService,
    ) {}

    /**
     * تنزيل ملف من URL → إنشاء MediaAsset → إرجاع UUID
     */
    async createFromUrl(
        url: string,
        kind: string,
        platformUserId: number,
    ): Promise<{ media_asset_uuid: string; processing_status: string }> {
        const mediaKind = kind as MediaKind;

        // ── 1. التحقق من URL ──
        this.validateUrl(url);
        await this.validateNotPrivateIp(url);

        // ── 2. تنزيل الملف ──
        const tempPath = path.join(
            this.storage.getTempPath(`url-import-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        );

        let contentType: string;
        try {
            contentType = await this.downloadFile(url, tempPath);
        } catch (err) {
            this.cleanupTempFile(tempPath);
            this.logger.error(`Failed to download from URL: ${url}`, err);
            throw new BadRequestException(
                `فشل تنزيل الملف من الرابط: ${err.message || err}`,
            );
        }

        try {
            // ── 3. التحقق من الحجم ──
            const stat = await fs.promises.stat(tempPath);
            if (stat.size > this.MAX_FILE_SIZE) {
                throw new BadRequestException(
                    `الملف كبير جداً (${(stat.size / 1024 / 1024).toFixed(1)}MB). الحد الأقصى ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
                );
            }
            if (stat.size === 0) {
                throw new BadRequestException('الملف فارغ');
            }

            // ── 4. التحقق من content-type ──
            const resolvedContentType = this.resolveContentType(contentType, url, mediaKind);
            if (!this.isContentTypeValidForKind(resolvedContentType, mediaKind)) {
                throw new BadRequestException(
                    `نوع الملف (${resolvedContentType}) لا يتوافق مع النوع المطلوب (${mediaKind})`,
                );
            }

            // ── 5. إنشاء MediaAsset ──
            const asset = await this.prisma.mediaAsset.create({
                data: {
                    kind: mediaKind,
                    ownerType: 'PLATFORM',
                    schoolId: null,
                    contentType: resolvedContentType,
                    sizeBytes: BigInt(stat.size),
                    processingStatus: 'PENDING',
                },
            });

            // ── 6. نقل للتخزين النهائي ──
            const ext = this.getExtFromContentType(resolvedContentType);
            const storageKey = this.storage.buildStorageKey(
                'platform', asset.uuid, 'original', ext,
            );

            // نقل يدوي (لأن الملف ليس في مسار temp القياسي)
            const finalPath = this.storage.resolvePath(storageKey);
            this.ensureDir(path.dirname(finalPath));
            await fs.promises.copyFile(tempPath, finalPath);

            await this.prisma.mediaAsset.update({
                where: { id: asset.id },
                data: {
                    storageKey,
                    updatedAt: new Date(),
                },
            });

            // ── 7. تشغيل pipeline المعالجة ──
            this.processing.processAsset(
                asset.id,
                'platform',
                asset.uuid,
                storageKey,
                mediaKind,
                resolvedContentType,
            ).catch(err => {
                this.logger.error(`Background processing failed for ${asset.uuid}:`, err);
            });

            this.logger.log(
                `✅ Media imported from URL: ${url} → ${asset.uuid} (${(stat.size / 1024).toFixed(0)}KB)`,
            );

            return {
                media_asset_uuid: asset.uuid,
                processing_status: 'PROCESSING',
            };
        } finally {
            // ── تنظيف الملف المؤقت دائماً ──
            this.cleanupTempFile(tempPath);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  التحقق من URL (SSRF Protection)
    // ═══════════════════════════════════════════════════════════

    private validateUrl(url: string): void {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            throw new BadRequestException('الرابط غير صالح');
        }

        // السماح فقط بـ HTTPS (أو HTTP للتطوير)
        if (!['https:', 'http:'].includes(parsed.protocol)) {
            throw new BadRequestException('يجب أن يبدأ الرابط بـ https://');
        }

        // منع localhost
        const hostname = parsed.hostname.toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '::1' ||
            hostname === '0.0.0.0'
        ) {
            throw new BadRequestException('لا يمكن استيراد من عنوان محلي');
        }
    }

    /**
     * التحقق أن الـ hostname لا يحل إلى عنوان خاص (RFC1918)
     */
    private async validateNotPrivateIp(url: string): Promise<void> {
        const parsed = new URL(url);
        try {
            const result = await dnsLookup(parsed.hostname);
            const ip = result.address;
            if (this.isPrivateIp(ip)) {
                throw new BadRequestException('لا يمكن استيراد من شبكة خاصة');
            }
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            // DNS lookup failed — سنترك التنزيل يفشل طبيعياً
        }
    }

    private isPrivateIp(ip: string): boolean {
        // IPv4 private ranges
        if (net.isIPv4(ip)) {
            const parts = ip.split('.').map(Number);
            // 10.0.0.0/8
            if (parts[0] === 10) return true;
            // 172.16.0.0/12
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
            // 192.168.0.0/16
            if (parts[0] === 192 && parts[1] === 168) return true;
            // 127.0.0.0/8
            if (parts[0] === 127) return true;
            // 169.254.0.0/16 (link-local)
            if (parts[0] === 169 && parts[1] === 254) return true;
            // 0.0.0.0
            if (parts[0] === 0) return true;
        }
        // IPv6 loopback
        if (ip === '::1') return true;
        return false;
    }

    // ═══════════════════════════════════════════════════════════
    //  تنزيل الملف
    // ═══════════════════════════════════════════════════════════

    /**
     * تنزيل ملف من URL → حفظه في tempPath
     * @returns content-type من الاستجابة
     */
    private downloadFile(url: string, tempPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.doDownload(url, tempPath, 0, resolve, reject);
        });
    }

    private doDownload(
        url: string,
        tempPath: string,
        redirectCount: number,
        resolve: (contentType: string) => void,
        reject: (err: Error) => void,
    ): void {
        if (redirectCount > this.MAX_REDIRECTS) {
            reject(new Error('عدد التحويلات أكثر من المسموح'));
            return;
        }

        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const req = client.get(url, {
            timeout: this.DOWNLOAD_TIMEOUT_MS,
            headers: {
                'User-Agent': 'AsasEducationPlatform/1.0 (https://asas.edu; contact@asas.edu)',
                'Accept': '*/*',
            },
        }, (res) => {
            // Handle redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).href;
                res.destroy();
                // Validate redirect target
                try {
                    this.validateUrl(redirectUrl);
                } catch (err) {
                    reject(err as Error);
                    return;
                }
                this.doDownload(redirectUrl, tempPath, redirectCount + 1, resolve, reject);
                return;
            }

            if (res.statusCode !== 200) {
                res.destroy();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            const contentType = (res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();

            // Stream to file with size limit
            this.ensureDir(path.dirname(tempPath));
            const fileStream = fs.createWriteStream(tempPath);
            let downloadedBytes = 0;

            res.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length;
                if (downloadedBytes > this.MAX_FILE_SIZE) {
                    res.destroy();
                    fileStream.destroy();
                    reject(new Error(`الملف أكبر من ${this.MAX_FILE_SIZE / 1024 / 1024}MB`));
                }
            });

            res.pipe(fileStream);

            fileStream.on('finish', () => {
                resolve(contentType);
            });

            fileStream.on('error', (err) => {
                reject(err);
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('انتهت مهلة التنزيل'));
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════════

    /**
     * حل content-type: إذا كان generic، نخمن من امتداد URL
     */
    private resolveContentType(serverContentType: string, url: string, kind: MediaKind): string {
        if (serverContentType && serverContentType !== 'application/octet-stream') {
            return serverContentType;
        }

        // خمّن من امتداد URL
        try {
            const urlPath = new URL(url).pathname.toLowerCase();
            if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) return 'image/jpeg';
            if (urlPath.endsWith('.png')) return 'image/png';
            if (urlPath.endsWith('.webp')) return 'image/webp';
            if (urlPath.endsWith('.gif')) return 'image/gif';
            if (urlPath.endsWith('.mp3')) return 'audio/mpeg';
            if (urlPath.endsWith('.m4a')) return 'audio/mp4';
            if (urlPath.endsWith('.wav')) return 'audio/wav';
            if (urlPath.endsWith('.ogg')) return 'audio/ogg';
            if (urlPath.endsWith('.aac')) return 'audio/aac';
        } catch {}

        // افتراضي حسب النوع
        return kind === MediaKind.IMAGE ? 'image/jpeg' : 'audio/mpeg';
    }

    private getExtFromContentType(contentType: string): string {
        const map: Record<string, string> = {
            'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
            'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
            'audio/wav': 'wav', 'audio/mp4': 'm4a',
        };
        return map[contentType] || 'bin';
    }

    private isContentTypeValidForKind(contentType: string, kind: MediaKind): boolean {
        const allowedPrefixes: Record<string, string> = {
            IMAGE: 'image/',
            AUDIO: 'audio/',
        };
        const prefix = allowedPrefixes[kind];
        if (!prefix) return false;
        return contentType.startsWith(prefix);
    }

    private cleanupTempFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            this.logger.warn(`Failed to cleanup temp file: ${filePath}`, err);
        }
    }

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
