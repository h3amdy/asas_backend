// src/platform/media/platform-media-upload.controller.ts
// VIDEO P4-3: توحيد DTO (W-058)، تمرير هوية ودور مستخدم المنصة (W-063)، وإعادة 202 للفيديو.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { InitUploadSessionDto } from '../../school/media/dto/init-upload-session.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import {
  PlatformMediaUploadService,
  type PlatformUploadActor,
} from './platform-media-upload.service';

interface AuthenticatedPlatformRequest extends Request {
  user?: {
    sub?: string;
    role?: string;
  };
}

/**
 * 📤 Platform Media Upload Controller (Chunked + Resume)
 *
 * POST   /platform/media-upload/sessions              → Init session
 * GET    /platform/media-upload/sessions/:uuid         → Probe/Resume
 * PUT    /platform/media-upload/sessions/:uuid/chunks  → Upload chunk
 * POST   /platform/media-upload/sessions/:uuid/complete → Complete (VIDEO → 202)
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
  async initSession(
    @Body() dto: InitUploadSessionDto,
    @Req() req: AuthenticatedPlatformRequest,
  ) {
    const actor = await this.resolvePlatformActor(req);
    return this.uploadService.initSession(dto, actor);
  }

  /**
   * ② Probe session (for resume)
   */
  @Get('sessions/:uuid')
  async probeSession(
    @Param('uuid') uuid: string,
    @Req() req: AuthenticatedPlatformRequest,
  ) {
    const actor = await this.resolvePlatformActor(req);
    return this.uploadService.probeSession(uuid, actor);
  }

  /**
   * ③ Upload chunk (binary body with Content-Range header)
   */
  @Put('sessions/:uuid/chunks')
  async uploadChunk(
    @Param('uuid') uuid: string,
    @Headers('content-range') contentRange: string,
    @Req() req: RawBodyRequest<AuthenticatedPlatformRequest>,
  ) {
    const rawChunk: unknown = req.rawBody ?? req.body;
    if (!rawChunk || !Buffer.isBuffer(rawChunk) || rawChunk.length === 0) {
      throw new BadRequestException('EMPTY_CHUNK');
    }
    const actor = await this.resolvePlatformActor(req);
    return this.uploadService.uploadChunk(uuid, contentRange, rawChunk, actor);
  }

  /**
   * ④ Complete upload session
   */
  @Post('sessions/:uuid/complete')
  async completeSession(
    @Param('uuid') uuid: string,
    @Req() req: AuthenticatedPlatformRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = await this.resolvePlatformActor(req);
    const result = await this.uploadService.completeSession(uuid, actor);
    if ('already_completed' in result) {
      res.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  /**
   * ⑤ Cancel upload session
   */
  @Post('sessions/:uuid/cancel')
  async cancelSession(
    @Param('uuid') uuid: string,
    @Req() req: AuthenticatedPlatformRequest,
  ) {
    const actor = await this.resolvePlatformActor(req);
    return this.uploadService.cancelSession(uuid, actor);
  }

  // ── Helper ──

  /** Resolve numeric platform user ID and role from JWT subject (uuid) */
  private async resolvePlatformActor(
    req: AuthenticatedPlatformRequest,
  ): Promise<PlatformUploadActor> {
    const userUuid = req.user?.sub;
    if (!userUuid) {
      throw new UnauthorizedException('USER_UUID_NOT_IN_TOKEN');
    }

    const user = await this.prisma.platformUser.findUnique({
      where: { uuid: userUuid },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('PLATFORM_USER_NOT_FOUND');
    }

    const role = req.user?.role ?? user.role;
    return { platformUserId: user.id, role };
  }
}
