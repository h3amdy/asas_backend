// src/public/media/public-media.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Headers,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { sendLocalFile } from '../../shared/media/local-file-response.helper';

/**
 * 📥 Public Media Controller
 *
 * GET /public/media/:uuid — Download a public media file (school logos only)
 *
 * ⚠️ No authentication required — but scoped to assets
 * that are actively used as school logos.
 */
@Controller('public/media')
export class PublicMediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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
}
