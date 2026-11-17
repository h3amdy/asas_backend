// src/shared/media/media-processing.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { VideoMediaConfig } from './video-media.config';
import { R2StorageProvider } from './r2-storage.provider';
import { MediaKind, ProcessingStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { computeFileDigest } from './file-digest.util';

/**
 * المعرّف الثابت للمنصة في storage keys — يُستخدم بدلاً من UUID المدرسة.
 * يظهر كأول جزء في المفتاح: `platform/{assetUuid}/{variant}.{ext}`
 */
export const PLATFORM_OWNER_ID = 'platform';

/**
 * يحدد نوع المالك بناءً على معرّف المدرسة.
 * `'platform'` → PLATFORM، أي UUID آخر → SCHOOL.
 */
export function resolveOwnerType(
  schoolUuid: string,
): 'PLATFORM' | 'SCHOOL' {
  return schoolUuid === PLATFORM_OWNER_ID ? 'PLATFORM' : 'SCHOOL';
}

/**
 * 🔄 خدمة معالجة الوسائط (Variant Generation Pipeline)
 *
 * Image → small (200px) / medium (600px) / original
 * Audio → low (opus 64kbps) / original
 *
 * B6: بعد المعالجة المحلية، إذا كان resolveTargetProvider === 'R2':
 *   → رفع كل variants إلى R2 (مع تحقق SHA-256 تلقائي)
 *   → تحديث storageProvider: 'R2' في DB
 *   → عند فشل الرفع أو تحديث DB: تنظيف R2 → يبقى LOCAL (fail-safe)
 *
 * يتم استدعاؤها بعد complete() لجلسة الرفع
 */
@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: VideoMediaConfig,
    private readonly r2Storage: R2StorageProvider,
  ) {}

  /**
   * Process an uploaded file: generate variants + update MediaAsset
   *
   * B6: بعد إنشاء variants محلياً، يُحدَّد الهدف (LOCAL أو R2) عبر resolveTargetProvider.
   * إذا كان R2 → رفع كل variant → تحقق → تحديث storageProvider.
   * فشل R2 لا يمنع حفظ الوسائط محلياً (fail-safe).
   */
  async processAsset(
    mediaAssetId: number,
    schoolUuid: string,
    assetUuid: string,
    originalStorageKey: string,
    kind: MediaKind,
    contentType: string,
  ): Promise<void> {
    this.logger.log(`Processing asset ${assetUuid} (${kind})`);

    try {
      // Mark as PROCESSING
      await this.prisma.mediaAsset.update({
        where: { id: mediaAssetId },
        data: { processingStatus: ProcessingStatus.PROCESSING },
      });

      let variants: Record<string, any> = {};

      if (kind === MediaKind.IMAGE) {
        variants = await this.processImage(
          schoolUuid,
          assetUuid,
          originalStorageKey,
        );
      } else if (kind === MediaKind.AUDIO) {
        variants = await this.processAudio(
          schoolUuid,
          assetUuid,
          originalStorageKey,
          contentType,
        );
      } else if (kind === MediaKind.DOCUMENT) {
        variants = await this.processDocument(
          schoolUuid,
          assetUuid,
          originalStorageKey,
          contentType,
        );
      }

      // Get processed original variant info
      const processedOriginal = variants['original'];

      // ── B6: رفع إلى R2 إذا كان الهدف R2 ──
      const ownerType = resolveOwnerType(schoolUuid);
      const targetProvider = this.config.resolveTargetProvider(kind, ownerType);
      let storageProvider: 'LOCAL' | 'R2' = 'LOCAL';
      const uploadedR2Keys: string[] = [];

      if (targetProvider === 'R2') {
        try {
          // جمع نتائج الرفع لإثراء variants بـ sha256 بعد نجاح الكل
          const uploadResults: Record<string, { sha256Hex: string }> = {};
          for (const [variantName, variantMeta] of Object.entries(variants)) {
            const localPath = this.storage.resolvePath(variantMeta.storage_key);
            const result = await this.r2Storage.uploadFromFile(localPath, variantMeta.storage_key, {
              contentType: variantMeta.content_type,
            });
            uploadedR2Keys.push(variantMeta.storage_key);
            uploadResults[variantName] = result;
            this.logger.debug(
              `R2 upload OK: ${assetUuid}/${variantName} → ${variantMeta.storage_key}`,
            );
          }

          // إثراء كل variant بحالة التحقق — مطلوب لـ resolveFlatR2Variant في download-url
          const verifiedAt = new Date().toISOString();
          for (const [variantName, variantMeta] of Object.entries(variants)) {
            variantMeta.status = 'VERIFIED';
            variantMeta.sha256 =
              variantMeta.sha256 ?? uploadResults[variantName]?.sha256Hex;
            variantMeta.verified_at = verifiedAt;
          }

          storageProvider = 'R2';
        } catch (r2Error) {
          const msg = r2Error instanceof Error ? r2Error.message : String(r2Error);
          this.logger.warn(
            `R2 upload failed for ${assetUuid} (${kind}), falling back to LOCAL: ${msg}`,
          );
          await this.cleanupR2Keys(uploadedR2Keys);
          // يبقى LOCAL — fail-safe
        }
      }

      // Update MediaAsset with variants + final metadata + storageProvider
      try {
        await this.prisma.mediaAsset.update({
          where: { id: mediaAssetId },
          data: {
            storageKey: processedOriginal.storage_key,
            contentType: processedOriginal.content_type,
            preferredVariant: 'original',
            variantsJson: JSON.stringify(variants),
            sizeBytes: BigInt(processedOriginal.size_bytes),
            etag: processedOriginal.etag,
            storageProvider,
            processingStatus: ProcessingStatus.DONE,
            rowVersion: { increment: 1 },
            updatedAt: new Date(),
          },
        });
      } catch (dbError) {
        // فشل تحديث DB بعد نجاح رفع R2 → تنظيف R2 لمنع orphan objects
        if (storageProvider === 'R2' && uploadedR2Keys.length > 0) {
          this.logger.error(
            `DB update failed after successful R2 upload for ${assetUuid}. Cleaning up ${uploadedR2Keys.length} R2 objects.`,
          );
          await this.cleanupR2Keys(uploadedR2Keys);
        }
        throw dbError; // يُلتقط بالـ catch الخارجي → يُسجّل ERROR
      }

      this.logger.log(
        `Asset ${assetUuid} processed successfully (${storageProvider}). Variants: ${Object.keys(variants).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(`Error processing asset ${assetUuid}:`, error);

      await this.prisma.mediaAsset.update({
        where: { id: mediaAssetId },
        data: {
          processingStatus: ProcessingStatus.ERROR,
          updatedAt: new Date(),
        },
      });
    }
  }

  // ── Image Processing ──

  private async processImage(
    schoolUuid: string,
    assetUuid: string,
    originalStorageKey: string,
  ): Promise<Record<string, any>> {
    // Dynamic import sharp (ESM)
    const sharp = (await import('sharp')).default;
    const originalPath = this.storage.resolvePath(originalStorageKey);
    const originalBuffer = await fs.promises.readFile(originalPath);

    const variants: Record<string, any> = {};

    // Get original metadata
    const metadata = await sharp(originalBuffer).metadata();

    // 1) Original (convert to WebP for efficiency)
    const originalWebpKey = this.storage.buildStorageKey(
      schoolUuid,
      assetUuid,
      'original',
      'webp',
    );
    const originalWebp = await sharp(originalBuffer)
      .webp({ quality: 90 })
      .toBuffer();
    await this.storage.saveBuffer(originalWebpKey, originalWebp);
    variants['original'] = {
      storage_key: originalWebpKey,
      etag: this.generateEtag(originalWebp),
      size_bytes: originalWebp.length,
      content_type: 'image/webp',
      width: metadata.width,
      height: metadata.height,
    };

    // 2) Medium (600px width)
    const mediumWidth = 600;
    if (metadata.width && metadata.width > mediumWidth) {
      const mediumKey = this.storage.buildStorageKey(
        schoolUuid,
        assetUuid,
        'medium',
        'webp',
      );
      const mediumBuf = await sharp(originalBuffer)
        .resize(mediumWidth)
        .webp({ quality: 80 })
        .toBuffer();
      const mediumMeta = await sharp(mediumBuf).metadata();
      await this.storage.saveBuffer(mediumKey, mediumBuf);
      variants['medium'] = {
        storage_key: mediumKey,
        etag: this.generateEtag(mediumBuf),
        size_bytes: mediumBuf.length,
        content_type: 'image/webp',
        width: mediumMeta.width,
        height: mediumMeta.height,
      };
    } else {
      // إذا الصورة أصغر من 600px، medium = original
      variants['medium'] = { ...variants['original'] };
    }

    // 3) Small (200px width)
    const smallWidth = 200;
    const smallKey = this.storage.buildStorageKey(
      schoolUuid,
      assetUuid,
      'small',
      'webp',
    );
    const smallBuf = await sharp(originalBuffer)
      .resize(smallWidth)
      .webp({ quality: 70 })
      .toBuffer();
    const smallMeta = await sharp(smallBuf).metadata();
    await this.storage.saveBuffer(smallKey, smallBuf);
    variants['small'] = {
      storage_key: smallKey,
      etag: this.generateEtag(smallBuf),
      size_bytes: smallBuf.length,
      content_type: 'image/webp',
      width: smallMeta.width,
      height: smallMeta.height,
    };

    // 🧹 حذف الملف الأصلي (JPEG/PNG) بعد التحويل لـ WebP
    if (originalStorageKey !== originalWebpKey) {
      await this.storage.deleteFile(originalStorageKey);
    }

    return variants;
  }

  // ── Audio Processing ──

  /**
   * SEC-MEDIA-07: لا readFile — البصمة تُحسب بالتدفق والنقل نسخ ملفات على القرص
   * (الذاكرة ثابتة مهما كان حجم الملف حتى 50MB).
   */
  private async processAudio(
    schoolUuid: string,
    assetUuid: string,
    originalStorageKey: string,
    contentType: string,
  ): Promise<Record<string, any>> {
    const original = await this.placeOriginalStreaming(
      schoolUuid,
      assetUuid,
      originalStorageKey,
      contentType,
    );

    // Low quality variant
    // TODO(MVP): حالياً = نسخة من original. لاحقاً: ffmpeg → Opus 64kbps
    return {
      original,
      low: { ...original },
    };
  }

  // ── Document Processing ──

  private async processDocument(
    schoolUuid: string,
    assetUuid: string,
    originalStorageKey: string,
    contentType: string,
  ): Promise<Record<string, any>> {
    // Documents (PDFs) are kept as-is — no conversion needed
    const original = await this.placeOriginalStreaming(
      schoolUuid,
      assetUuid,
      originalStorageKey,
      contentType,
    );
    return { original };
  }

  /**
   * ينقل الملف الأصلي إلى مفتاحه النهائي (نسخ على القرص) ويحسب بصمته بالتدفق.
   * قيمة etag مطابقة للسابق: أول 32 محرفاً من SHA-256.
   */
  private async placeOriginalStreaming(
    schoolUuid: string,
    assetUuid: string,
    originalStorageKey: string,
    contentType: string,
  ): Promise<Record<string, any>> {
    const ext = this.getExtFromContentType(contentType);
    const originalKey = this.storage.buildStorageKey(
      schoolUuid,
      assetUuid,
      'original',
      ext,
    );
    const sourcePath = this.storage.resolvePath(originalStorageKey);

    if (originalStorageKey !== originalKey) {
      const targetPath = this.storage.resolvePath(originalKey);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.copyFile(sourcePath, targetPath);
    }

    const digest = await computeFileDigest(
      this.storage.resolvePath(originalKey),
    );
    return {
      storage_key: originalKey,
      etag: `"${digest.sha256Hex.substring(0, 32)}"`,
      sha256: digest.sha256Hex,
      size_bytes: digest.sizeBytes,
      content_type: contentType,
    };
  }

  // ── Helpers ──

  /** Generate deterministic ETag from file content (sha256) */
  private generateEtag(buffer: Buffer): string {
    const hash = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex')
      .substring(0, 32);
    return `"${hash}"`;
  }

  private getExtFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/mpeg': 'mp3',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/opus': 'opus',
      'audio/wav': 'wav',
      'audio/mp4': 'm4a',
      'application/pdf': 'pdf',
    };
    return (
      map[contentType] || (contentType.startsWith('image/') ? 'webp' : 'bin')
    );
  }

  /**
   * تنظيف مفاتيح R2 التي رُفعت جزئياً عند فشل العملية.
   * لا يرمي خطأ — يسجّل الفشل فقط لأن التنظيف best-effort.
   */
  private async cleanupR2Keys(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.r2Storage.deleteObject(key);
        this.logger.debug(`R2 cleanup: deleted ${key}`);
      } catch (cleanupErr) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        this.logger.error(
          `R2 cleanup failed for key ${key}: ${msg}. This may leave an orphan object in R2.`,
        );
      }
    }
  }
}
