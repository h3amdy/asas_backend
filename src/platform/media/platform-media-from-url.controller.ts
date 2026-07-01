// src/platform/media/platform-media-from-url.controller.ts
import {
    Controller, Post, Body, Req,
    UseGuards,
    UnauthorizedException, NotFoundException,
} from '@nestjs/common';
import { PlatformMediaFromUrlService } from './platform-media-from-url.service';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 🌐 Platform Media From-URL Controller
 *
 * POST /platform/media/from-url → تنزيل ملف من URL وإنشاء MediaAsset
 */
@Controller('platform/media')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformMediaFromUrlController {
    constructor(
        private readonly fromUrlService: PlatformMediaFromUrlService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * استيراد وسيط من URL خارجي
     *
     * Body: { url: string, kind: "IMAGE" | "AUDIO" }
     * Response: { media_asset_uuid: string, processing_status: string }
     */
    @Post('from-url')
    async createFromUrl(
        @Body() body: { url: string; kind: string },
        @Req() req: any,
    ) {
        const user = await this.resolvePlatformUserId(req);
        return this.fromUrlService.createFromUrl(body.url, body.kind, user.id);
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
