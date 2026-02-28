// src/school/media/media.controller.ts
import {
    Controller, Get, Param, Query, Req, Res, UseGuards,
    NotFoundException, Headers, StreamableFile,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { MediaService } from './media.service';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { StorageService } from './storage.service';

/**
 * 📥 Media Download Controller
 *
 * GET /school/media/:uuid          → Download file (variant, Range, ETag)
 * GET /school/media/:uuid/meta     → Asset metadata
 */
@Controller('school/media')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard)
export class MediaController {
    constructor(
        private readonly mediaService: MediaService,
        private readonly storage: StorageService,
    ) { }

    /**
     * 📥 Download media file
     * - Supports Range header (206 Partial Content)
     * - Supports If-None-Match (304 Not Modified)
     * - Default variant: medium (IMAGE) / low (AUDIO)
     */
    @Get(':uuid')
    async download(
        @Param('uuid') uuid: string,
        @Query('variant') variant: string | undefined,
        @Headers('range') rangeHeader: string | undefined,
        @Headers('if-none-match') ifNoneMatch: string | undefined,
        @Req() req: any,
        @Res() res: Response,
    ) {
        const schoolId = req.schoolContext.id;

        // Determine default variant from asset kind
        const asset = await this.mediaService.getAsset(uuid, schoolId);
        const defaultVariant = asset.kind === 'IMAGE' ? 'medium' : 'low';
        const selectedVariant = variant || defaultVariant;

        // Resolve variant storage key
        const resolved = await this.mediaService.resolveVariantStorageKey(uuid, schoolId, selectedVariant);

        // Check If-None-Match
        if (ifNoneMatch && ifNoneMatch === resolved.etag) {
            res.status(304).end();
            return;
        }

        // Check file exists
        const exists = await this.storage.fileExists(resolved.storageKey);
        if (!exists) {
            throw new NotFoundException('FILE_NOT_FOUND');
        }

        const fileSize = await this.storage.getFileSize(resolved.storageKey);

        // Common headers
        res.setHeader('ETag', resolved.etag);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', resolved.contentType);
        res.setHeader('Cache-Control', 'private, max-age=86400');

        // Range support
        if (rangeHeader) {
            const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

                if (start >= fileSize) {
                    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
                    return;
                }

                const chunkSize = end - start + 1;

                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                res.setHeader('Content-Length', chunkSize);

                const stream = this.storage.getReadStream(resolved.storageKey, start, end);
                stream.pipe(res);
                return;
            }
        }

        // Full download (200)
        res.setHeader('Content-Length', fileSize);
        const stream = this.storage.getReadStream(resolved.storageKey);
        stream.pipe(res);
    }

    /**
     * 📋 Get asset metadata
     */
    @Get(':uuid/meta')
    async getMeta(@Param('uuid') uuid: string, @Req() req: any) {
        const schoolId = req.schoolContext.id;
        return this.mediaService.getAssetMeta(uuid, schoolId);
    }
}
