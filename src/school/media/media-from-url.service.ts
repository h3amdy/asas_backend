// src/school/media/media-from-url.service.ts
// الموجة C: استيراد وسائط المدرسة من الروابط عبر الخادم
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

export type FromUrlKind = 'IMAGE' | 'AUDIO';

@Injectable()
export class SchoolMediaFromUrlService {
  private readonly logger = new Logger(SchoolMediaFromUrlService.name);
  private readonly MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  private readonly DOWNLOAD_TIMEOUT_MS = 60_000;
  private readonly MAX_REDIRECTS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly processing: MediaProcessingService,
  ) {}

  async createFromUrl(
    url: string,
    kind: FromUrlKind,
    schoolId: number,
    schoolUuid: string,
    userId: number,
  ): Promise<{ media_asset_uuid: string; processing_status: string }> {
    const tempPath = this.storage.getTempPath(
      `school-url-import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      // 1. تنزيل آمن عبر SafeUrlFetcher (SSRF-safe)
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
          this.logger.warn(
            `from-url rejected: code=${err.code} host=${this.safeHost(url)} school=${schoolUuid} user=${userId}`,
          );
          throw new BadRequestException({
            error: `FROM_URL_${err.code}`,
            message: `فشل تنزيل الملف من الرابط: ${err.message}`,
          });
        }
        throw err;
      }

      // 2. فحص Magic Bytes — التأكد من تطابق المحتوى مع النوع المطلوب
      const sniff = await sniffFileMediaType(tempPath);
      if (!isSniffCompatibleWithKind(sniff, kind)) {
        this.logger.warn(
          `from-url content mismatch: kind=${kind} detected=${sniff?.contentType ?? 'unknown'} host=${this.safeHost(url)} school=${schoolUuid}`,
        );
        throw new BadRequestException({
          error: 'FROM_URL_CONTENT_MISMATCH',
          message:
            kind === 'IMAGE'
              ? 'الرابط لا يشير إلى صورة صالحة (JPEG/PNG/WebP/GIF)'
              : 'الرابط لا يشير إلى ملف صوتي صالح (MP3/M4A/AAC/OGG/WAV)',
        });
      }

      const { contentType, ext } = normalizeSniffForKind(sniff!, kind);

      // 3. إنشاء سجل MediaAsset بملكية المدرسة
      const asset = await this.prisma.mediaAsset.create({
        data: {
          kind: kind as MediaKind,
          ownerType: 'SCHOOL',
          schoolId,
          contentType,
          sizeBytes: BigInt(sizeBytes),
          processingStatus: 'PENDING',
        },
      });

      // 4. نقل الملف إلى التخزين النهائي
      const storageKey = this.storage.buildStorageKey(
        schoolUuid,
        asset.uuid,
        'original',
        ext,
      );
      const finalPath = this.storage.resolvePath(storageKey);
      await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.promises.copyFile(tempPath, finalPath);

      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { storageKey, updatedAt: new Date() },
      });

      // 5. معالجة الأصل في الخلفية (تقطيع + R2 تلقائياً إن كان مفعّلاً)
      this.processing
        .processAsset(
          asset.id,
          schoolUuid,
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
        `✅ School media imported from URL: host=${this.safeHost(url)} → ${asset.uuid} (${(sizeBytes / 1024).toFixed(0)}KB, ${contentType}) school=${schoolUuid}`,
      );

      return { media_asset_uuid: asset.uuid, processing_status: 'PROCESSING' };
    } finally {
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

