// src/platform/media/platform-media-from-url.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { MediaKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { MediaProcessingService } from '../../shared/media/media-processing.service';
import {
  SafeFetchError,
  safeFetchToFile,
} from '../../shared/media/safe-url-fetcher';
import {
  isSniffCompatibleWithKind,
  normalizeSniffForKind,
  sniffFileMediaType,
} from '../../shared/media/media-magic-bytes';
import * as fs from 'fs';
import * as path from 'path';

/** الأنواع المسموح استيرادها من رابط */
export type FromUrlKind = 'IMAGE' | 'AUDIO';

/**
 * 🌐 خدمة استيراد الوسائط من URL خارجي
 *
 * السيرفر ينزّل الملف من الرابط → يتحقق من نوعه الحقيقي → يخزّنه → يرجع mediaAssetUuid
 * يحل مشكلة حجب المواقع في بعض المناطق (مثل اليمن)
 *
 * MEDIA-R2 B1 (SEC-MEDIA-01): التنزيل يمر حصراً عبر safeFetchToFile
 * (https فقط، حظر العناوين الداخلية لحظة الاتصال، فحص كل تحويل، حد حجم أثناء التدفق)،
 * ونوع الملف يُحدَّد من بايتاته الفعلية (Magic Bytes) وليس من ترويسة الموقع أو امتداد الرابط.
 */
@Injectable()
export class PlatformMediaFromUrlService {
  private readonly logger = new Logger(PlatformMediaFromUrlService.name);

  /** الحد الأقصى لحجم الملف (20MB) */
  private readonly MAX_FILE_SIZE = 20 * 1024 * 1024;

  /** مهلة التنزيل الكاملة بما فيها التحويلات (60 ثانية) */
  private readonly DOWNLOAD_TIMEOUT_MS = 60_000;

  /** الحد الأقصى لعدد التحويلات */
  private readonly MAX_REDIRECTS = 3;

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
    kind: FromUrlKind,
    platformUserId: number,
  ): Promise<{ media_asset_uuid: string; processing_status: string }> {
    const tempPath = this.storage.getTempPath(
      `url-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      // ── 1. التنزيل الآمن ──
      let sizeBytes: number;
      try {
        const result = await safeFetchToFile(url, tempPath, {
          maxBytes: this.MAX_FILE_SIZE,
          timeoutMs: this.DOWNLOAD_TIMEOUT_MS,
          maxRedirects: this.MAX_REDIRECTS,
        });
        sizeBytes = result.sizeBytes;
      } catch (err) {
        if (err instanceof SafeFetchError) {
          // لا نسجّل الرابط كاملاً (قد يحوي رموزاً موقّعة)، فقط المضيف والرمز
          this.logger.warn(
            `from-url rejected: code=${err.code} host=${this.safeHost(url)} user=${platformUserId}`,
          );
          throw new BadRequestException({
            error: `FROM_URL_${err.code}`,
            message: `فشل تنزيل الملف من الرابط: ${err.message}`,
          });
        }
        throw err;
      }

      // ── 2. التحقق من النوع الحقيقي (Magic Bytes) ──
      const sniff = await sniffFileMediaType(tempPath);
      if (!isSniffCompatibleWithKind(sniff, kind)) {
        this.logger.warn(
          `from-url content mismatch: kind=${kind} detected=${sniff?.contentType ?? 'unknown'} host=${this.safeHost(url)}`,
        );
        throw new BadRequestException({
          error: 'FROM_URL_CONTENT_MISMATCH',
          message:
            kind === 'IMAGE'
              ? 'الرابط لا يشير إلى صورة صالحة (JPEG/PNG/WebP/GIF)'
              : 'الرابط لا يشير إلى ملف صوتي صالح (MP3/M4A/AAC/OGG/WAV)',
        });
      }

      // صوت داخل حاوية فيديو (m4a/webm) يُخزَّن كصوت
      const { contentType, ext } = normalizeSniffForKind(sniff!, kind);

      // ── 3. إنشاء MediaAsset ──
      const asset = await this.prisma.mediaAsset.create({
        data: {
          kind: kind as MediaKind,
          ownerType: 'PLATFORM',
          schoolId: null,
          contentType,
          sizeBytes: BigInt(sizeBytes),
          processingStatus: 'PENDING',
        },
      });

      // ── 4. نقل للتخزين النهائي ──
      const storageKey = this.storage.buildStorageKey(
        'platform',
        asset.uuid,
        'original',
        ext,
      );
      const finalPath = this.storage.resolvePath(storageKey);
      await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.promises.copyFile(tempPath, finalPath);

      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          storageKey,
          updatedAt: new Date(),
        },
      });

      // ── 5. تشغيل pipeline المعالجة ──
      this.processing
        .processAsset(
          asset.id,
          'platform',
          asset.uuid,
          storageKey,
          kind as MediaKind,
          contentType,
        )
        .catch((err) => {
          this.logger.error(
            `Background processing failed for ${asset.uuid}:`,
            err,
          );
        });

      this.logger.log(
        `✅ Media imported from URL: host=${this.safeHost(url)} → ${asset.uuid} (${(sizeBytes / 1024).toFixed(0)}KB, ${contentType})`,
      );

      return {
        media_asset_uuid: asset.uuid,
        processing_status: 'PROCESSING',
      };
    } finally {
      // ── تنظيف الملف المؤقت دائماً ──
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private safeHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid';
    }
  }
}
