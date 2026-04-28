// src/platform/media/platform-media-upload.controller.ts
import {
    Controller, Post, Get, Put, Param, Body, Req,
    UseGuards, Headers,
    UnauthorizedException, NotFoundException, BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformMediaUploadService } from './platform-media-upload.service';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 📤 Platform Media Upload Controller (Chunked + Resume)
 *
 * POST   /platform/media-upload/sessions              → Init session
 * GET    /platform/media-upload/sessions/:uuid         → Probe/Resume
 * PUT    /platform/media-upload/sessions/:uuid/chunks  → Upload chunk
 * POST   /platform/media-upload/sessions/:uuid/complete → Complete
 * POST   /platform/media-upload/sessions/:uuid/cancel   → Cancel
 */
@Controller('platform/media-upload')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformMediaUploadController {
    constructor(
        private readonly uploadService: PlatformMediaUploadService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * ① Start upload session
     */
    @Post('sessions')
    async initSession(@Body() dto: any, @Req() req: any) {
        const user = await this.resolvePlatformUserId(req);
        return this.uploadService.initSession(dto, user.id);
    }

    /**
     * ② Probe session (for resume)
     */
    @Get('sessions/:uuid')
    async probeSession(@Param('uuid') uuid: string) {
        return this.uploadService.probeSession(uuid);
    }

    /**
     * ③ Upload chunk (binary body with Content-Range header)
     */
    @Put('sessions/:uuid/chunks')
    async uploadChunk(
        @Param('uuid') uuid: string,
        @Headers('content-range') contentRange: string,
        @Req() req: RawBodyRequest<Request>,
    ) {
        const chunk = req.rawBody ?? req.body;
        if (!chunk || !Buffer.isBuffer(chunk) || chunk.length === 0) {
            throw new BadRequestException('EMPTY_CHUNK');
        }
        return this.uploadService.uploadChunk(uuid, contentRange, chunk);
    }

    /**
     * ④ Complete upload session
     */
    @Post('sessions/:uuid/complete')
    async completeSession(@Param('uuid') uuid: string) {
        return this.uploadService.completeSession(uuid);
    }

    /**
     * ⑤ Cancel upload session
     */
    @Post('sessions/:uuid/cancel')
    async cancelSession(@Param('uuid') uuid: string) {
        return this.uploadService.cancelSession(uuid);
    }

    // ── Helper ──

    /** Resolve numeric platform user ID from JWT subject (uuid) */
    private async resolvePlatformUserId(req: any): Promise<{ id: number }> {
        const userUuid = req.user?.sub;

        if (!userUuid) {
            throw new UnauthorizedException('USER_UUID_NOT_IN_TOKEN');
        }

        const user = await this.prisma.platformUser.findUnique({
            where: { uuid: userUuid },
            select: { id: true },
        });

        if (!user) {
            throw new NotFoundException('PLATFORM_USER_NOT_FOUND');
        }

        return user;
    }
}
