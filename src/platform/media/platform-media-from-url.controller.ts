// src/platform/media/platform-media-from-url.controller.ts
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { FromUrlDto } from './dto/from-url.dto';
import { PlatformMediaFromUrlService } from './platform-media-from-url.service';

/** الأدوار المسموح لها باستيراد الوسائط من الروابط (قرار المالك: الاثنان) */
const FROM_URL_ALLOWED_ROLES = ['PLATFORM_ADMIN', 'PLATFORM_TEACHER'] as const;

interface PlatformFromUrlRequest {
  user?: { sub?: string; role?: string };
}

/**
 * 🌐 Platform Media From-URL Controller
 *
 * POST /platform/media/from-url → تنزيل ملف من URL وإنشاء MediaAsset
 *
 * MEDIA-R2 B1 (SEC-MEDIA-01):
 * - DTO صارم (https فقط + IMAGE/AUDIO فقط).
 * - الدور من قائمة مسموحة + الحساب نشط وغير محذوف.
 * - حد طلبات: 60/دقيقة و 600/ساعة لكل عميل.
 */
@Controller('platform/media')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformMediaFromUrlController {
  constructor(
    private readonly fromUrlService: PlatformMediaFromUrlService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Body: { url: string, kind: "IMAGE" | "AUDIO" }
   * Response: { media_asset_uuid: string, processing_status: string }
   */
  @Post('from-url')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60_000, limit: 60 },
    long: { ttl: 3_600_000, limit: 600 },
  })
  async createFromUrl(
    @Body() body: FromUrlDto,
    @Req() req: PlatformFromUrlRequest,
  ) {
    const user = await this.resolveAllowedUser(req);
    return this.fromUrlService.createFromUrl(body.url, body.kind, user.id);
  }

  // ── Helper ──

  /** يتحقق من الدور ومن أن الحساب نشط وغير محذوف، ويعيد معرّفه الرقمي */
  private async resolveAllowedUser(
    req: PlatformFromUrlRequest,
  ): Promise<{ id: number }> {
    const userUuid = req.user?.sub;
    if (!userUuid) {
      throw new UnauthorizedException('USER_UUID_NOT_IN_TOKEN');
    }

    const user = await this.prisma.platformUser.findUnique({
      where: { uuid: userUuid },
      select: { id: true, role: true, isActive: true, isDeleted: true },
    });

    if (!user || user.isDeleted || !user.isActive) {
      throw new UnauthorizedException('PLATFORM_USER_INACTIVE');
    }

    if (!(FROM_URL_ALLOWED_ROLES as readonly string[]).includes(user.role)) {
      throw new ForbiddenException('FROM_URL_ROLE_NOT_ALLOWED');
    }

    return { id: user.id };
  }
}
