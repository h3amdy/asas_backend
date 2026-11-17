// src/public/media/public-media.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Headers,
  NotFoundException,
  ServiceUnavailableException,
  UseGuards,
  Logger,
  Optional,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { sendLocalFile } from '../../shared/media/local-file-response.helper';
import { R2StorageProvider } from '../../shared/media/r2-storage.provider';
import { VideoMediaConfig } from '../../shared/media/video-media.config';
import {
  resolveFlatR2Variant,
  ResolvedFlatVariant,
} from '../../shared/media/video-delivery.helper';
import { PresignedUrlCache } from './presigned-url-cache';

/** نسخ الصور المسموحة للشعارات العامة (تطابق سياسة IMAGE في download-url) */
const PUBLIC_LOGO_VARIANTS = ['original', 'medium', 'small', 'thumb'];

/**
 * 📥 Public Media Controller
 *
 * GET /public/media/:uuid — Download a public media file (school logos only)
 *
 * ⚠️ No authentication required — but scoped to assets
 * that are actively used as school logos.
 * B2: الشعارات المخزّنة في R2 تُوجَّه بـ 302 إلى رابط موقّع (لا تمرّ عبر الخادم).
 */
@Controller('public/media')
export class PublicMediaController {
  private readonly logger = new Logger(PublicMediaController.name);
  private readonly urlCache = new PresignedUrlCache();
  private readonly videoConfig: VideoMediaConfig;
  private readonly r2Storage: R2StorageProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() videoConfig?: VideoMediaConfig,
    @Optional() r2Storage?: R2StorageProvider,
  ) {
    this.videoConfig = videoConfig ?? new VideoMediaConfig();
    this.r2Storage = r2Storage ?? new R2StorageProvider(this.videoConfig);
  }

  @Get(':uuid')
  // SEC-MEDIA-06: حد سخي لكل IP (طلاب مدرسة كاملة قد يشتركون في IP واحد عبر Wi-Fi)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60_000, limit: 300 },
    long: { ttl: 3_600_000, limit: 3_000 },
  })
  async download(
    @Param('uuid') uuid: string,
    @Query('variant') variant: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    // 1. Find the asset
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { uuid, isDeleted: false },
    });
    if (!asset) throw new NotFoundException('ASSET_NOT_FOUND');
    // SEC-MEDIA-03: لا يُنشر للعامة إلا الصور
    if (asset.kind !== 'IMAGE') throw new NotFoundException('ASSET_NOT_PUBLIC');

    // 2. Verify asset is used as a school logo (security check)
    const school = await this.prisma.school.findFirst({
      where: { logoMediaAssetId: asset.id, isDeleted: false },
    });
    if (!school) {
      throw new NotFoundException('ASSET_NOT_PUBLIC');
    }

    // 3. Resolve variant
    const selectedVariant =
      variant || (asset.kind === 'IMAGE' ? 'medium' : 'low');
    if (!asset.variantsJson) throw new NotFoundException('VARIANTS_NOT_READY');

    // B2: الشعار على R2 ← 302 إلى رابط موقّع (مخزّن مؤقتاً)، والخادم لا يمرّر الملف
    if (asset.storageProvider === 'R2') {
      await this.redirectToR2(
        res,
        uuid,
        asset.variantsJson,
        selectedVariant,
        ifNoneMatch,
      );
      return;
    }

    const variants = JSON.parse(asset.variantsJson);
    const variantData =
      variants[selectedVariant] || variants['medium'] || variants['original'];
    if (!variantData) throw new NotFoundException('VARIANT_NOT_FOUND');

    // 4. Check ETag (304 Not Modified)
    if (ifNoneMatch && ifNoneMatch === variantData.etag) {
      res.status(304).end();
      return;
    }

    // 5. Check file exists
    const exists = await this.storage.fileExists(variantData.storage_key);
    if (!exists) throw new NotFoundException('FILE_NOT_FOUND');

    const fileSize = await this.storage.getFileSize(variantData.storage_key);

    // 6. Common headers
    res.setHeader('ETag', variantData.etag);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader(
      'Content-Type',
      variantData.content_type || asset.contentType,
    );
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days — public cache

    // 7. SEC-MEDIA-05: Range مُقلَّص لحجم الملف + pipeline آمن
    await sendLocalFile(res, {
      fileSize,
      rangeHeader,
      openStream: (start, end) =>
        this.storage.getReadStream(variantData.storage_key, start, end),
      logLabel: `public-media:${uuid}`,
    });
  }

  /**
   * B2 — توجيه شعار مخزّن في R2:
   *  - نفس سياسة النسخ في download-url (الافتراضي medium مع fallback إلى original).
   *  - نسخة غير معروفة ← الافتراضي (كسلوك المسار المحلي)، وأي خطأ آخر ← 404 عام.
   *  - 304 عند تطابق ETag، وإلا 302 مع Cache-Control قصير أقل من صلاحية الرابط.
   */
  private async redirectToR2(
    res: Response,
    uuid: string,
    variantsJson: string,
    requestedVariant: string,
    ifNoneMatch: string | undefined,
  ): Promise<void> {
    const variantName = PUBLIC_LOGO_VARIANTS.includes(requestedVariant)
      ? requestedVariant
      : undefined;

    let resolved: ResolvedFlatVariant;
    try {
      resolved = resolveFlatR2Variant('IMAGE', variantsJson, variantName);
    } catch {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }

    if (resolved.etag && ifNoneMatch && ifNoneMatch === resolved.etag) {
      res.status(304).end();
      return;
    }

    const cacheKey = `${uuid}:${resolved.variant}:${resolved.etag ?? resolved.sha256}`;
    let signed = this.urlCache.get(cacheKey);
    if (!signed) {
      try {
        signed = await this.r2Storage.getPresignedGetUrl(
          resolved.storageKey,
          this.videoConfig.r2PresignedGetTtlSeconds,
        );
      } catch (err) {
        // ⚠️ لا نسجّل المفتاح ولا الرابط
        this.logger.error(
          `☁️ [PublicMedia] تعذّر توليد رابط R2 للشعار ${uuid}: ${(err as Error).name}`,
        );
        throw new ServiceUnavailableException('STORAGE_PROVIDER_UNAVAILABLE');
      }
      this.urlCache.set(cacheKey, signed);
    }

    const remainingSec = Math.floor(
      (signed.expiresAt.getTime() - Date.now()) / 1000,
    );
    const maxAge = Math.max(0, Math.min(300, remainingSec - 60));
    if (resolved.etag) res.setHeader('ETag', resolved.etag);
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    res.redirect(302, signed.url);
  }
}
