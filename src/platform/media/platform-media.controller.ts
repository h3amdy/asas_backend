// src/platform/media/platform-media.controller.ts
import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { StorageService } from '../../shared/media/storage.service';
import { assertNotR2DirectStreamAsset } from '../../shared/media/video-delivery.helper';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformMediaService } from './platform-media.service';

interface PlatformMediaRequest {
  user?: {
    sub?: string;
    id?: number | string;
  };
}

/**
 * 📥 Platform Media Download & Delivery Controller
 *
 * GET /platform/media/:uuid/status        → Processing status & variants readiness
 * GET /platform/media/:uuid/download-url  → Presigned R2 GET URL (60/min Throttle)
 * GET /platform/media/:uuid/meta          → Sanitized asset metadata
 * GET /platform/media/:uuid               → Local file download or 409 USE_DOWNLOAD_URL for R2
 */
@Controller('platform/media')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformMediaController {
  constructor(
    private readonly mediaService: PlatformMediaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * 📊 GET /platform/media/:uuid/status
   */
  @Get(':uuid/status')
  async getStatus(@Param('uuid') uuid: string) {
    const asset = await this.mediaService.getAsset(uuid);
    return this.mediaService.getAssetStatus(uuid, asset);
  }

  /**
   * 🔗 GET /platform/media/:uuid/download-url?variant=360p
   */
  @Get(':uuid/download-url')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 60 },
    long: { ttl: 3600000, limit: 600 },
  })
  async getDownloadUrl(
    @Param('uuid') uuid: string,
    @Query('variant') variant: string | undefined,
    @Req() req: PlatformMediaRequest,
  ) {
    const asset = await this.mediaService.getAsset(uuid);
    const actorLabel =
      typeof req?.user?.sub === 'string' && req.user.sub
        ? req.user.sub
        : String(req?.user?.id ?? 'platform-user');

    return this.mediaService.getDownloadUrl(uuid, variant, actorLabel, asset);
  }

  /**
   * 📋 GET /platform/media/:uuid/meta
   */
  @Get(':uuid/meta')
  async getMeta(@Param('uuid') uuid: string) {
    const asset = await this.mediaService.getAsset(uuid);
    return this.mediaService.getAssetMeta(uuid, asset);
  }

  /**
   * 📥 GET /platform/media/:uuid
   */
  @Get(':uuid')
  async download(
    @Param('uuid') uuid: string,
    @Query('variant') variant: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const asset = await this.mediaService.getAsset(uuid);

    // حارس W-049: أصول R2 تعيد 409 USE_DOWNLOAD_URL
    assertNotR2DirectStreamAsset(asset, '/platform/media');

    const defaultVariant =
      asset.kind === 'IMAGE'
        ? 'medium'
        : asset.kind === 'DOCUMENT'
          ? 'original'
          : 'low';
    const selectedVariant = variant || defaultVariant;

    const resolved = await this.mediaService.resolveVariantStorageKey(
      uuid,
      selectedVariant,
      asset,
    );

    if (ifNoneMatch && ifNoneMatch === resolved.etag) {
      res.status(304).end();
      return;
    }

    const exists = await this.storage.fileExists(resolved.storageKey);
    if (!exists) {
      throw new NotFoundException('FILE_NOT_FOUND');
    }

    const fileSize = await this.storage.getFileSize(resolved.storageKey);

    res.setHeader('ETag', resolved.etag);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', resolved.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

        if (start >= fileSize) {
          res
            .status(416)
            .setHeader('Content-Range', `bytes */${fileSize}`)
            .end();
          return;
        }

        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);

        const stream = this.storage.getReadStream(
          resolved.storageKey,
          start,
          end,
        );
        stream.pipe(res);
        return;
      }
    }

    res.setHeader('Content-Length', fileSize);
    const stream = this.storage.getReadStream(resolved.storageKey);
    stream.pipe(res);
  }
}
