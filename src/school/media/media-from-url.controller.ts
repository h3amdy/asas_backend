// src/school/media/media-from-url.controller.ts
// الموجة C: استيراد وسائط المدرسة من الروابط عبر الخادم
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { SchoolFromUrlDto } from './dto/from-url.dto';
import { SchoolMediaFromUrlService } from './media-from-url.service';

interface AuthenticatedSchoolRequest {
  schoolContext: {
    id: number;
    uuid: string;
  };
  user?: {
    sub?: string;
    ut?: string;
  };
}

/**
 * 📥 الموجة C — استيراد وسائط المدرسة من رابط خارجي عبر الخادم.
 *
 * الفائدة: الخادم (خارج اليمن) يتجاوز حجب المواقع، ويوفّر باقة المعلم
 * (لا يحتاج المعلم لتنزيل الملف ثم إعادة رفعه).
 *
 * POST /school/media/from-url  { url, kind }
 * → 201 { media_asset_uuid, processing_status }
 */
@Controller('school/media')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
export class SchoolMediaFromUrlController {
  constructor(
    private readonly fromUrlService: SchoolMediaFromUrlService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('from-url')
  @HttpCode(201)
  @Roles('OWNER', 'ADMIN', 'TEACHER')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60_000, limit: 60 },
    long: { ttl: 3_600_000, limit: 600 },
  })
  async createFromUrl(
    @Body() body: SchoolFromUrlDto,
    @Req() req: AuthenticatedSchoolRequest,
  ) {
    const userId = await this.resolveUserId(req);
    return this.fromUrlService.createFromUrl(
      body.url,
      body.kind,
      req.schoolContext.id,
      req.schoolContext.uuid,
      userId,
    );
  }

  private async resolveUserId(
    req: AuthenticatedSchoolRequest,
  ): Promise<number> {
    const userUuid = req.user?.sub;
    if (!userUuid) throw new UnauthorizedException('USER_UUID_NOT_IN_TOKEN');

    const user = await this.prisma.user.findUnique({
      where: { uuid: userUuid },
      select: { id: true },
    });

    if (!user) throw new UnauthorizedException('USER_NOT_FOUND');
    return user.id;
  }
}

