// src/school/media/media-upload.controller.ts
// VIDEO P4-3: تمرير المستخدم الحالي (W-063) ونوعه من JWT (ut)، و 202 لإكمال الفيديو فقط.
import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Req,
  Res,
  UseGuards,
  Headers,
  HttpStatus,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaUploadService } from './media-upload.service';
import { InitUploadSessionDto } from './dto/init-upload-session.dto';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

interface AuthenticatedSchoolRequest extends Request {
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
 * 📤 Media Upload Controller (Chunked + Resume)
 *
 * POST   /school/media-upload/sessions              → Init session
 * GET    /school/media-upload/sessions/:uuid         → Probe/Resume
 * PUT    /school/media-upload/sessions/:uuid/chunks  → Upload chunk
 * POST   /school/media-upload/sessions/:uuid/complete → Complete (VIDEO → 202)
 * POST   /school/media-upload/sessions/:uuid/cancel   → Cancel
 *
 * صلاحية رفع VIDEO (TEACHER مسند فعلياً فقط) تُفحص في MediaAccessPolicyService.
 */
@Controller('school/media-upload')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT')
export class MediaUploadController {
  constructor(
    private readonly uploadService: MediaUploadService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ① Start upload session
   */
  @Post('sessions')
  async initSession(
    @Body() dto: InitUploadSessionDto,
    @Req() req: AuthenticatedSchoolRequest,
  ) {
    const schoolId = req.schoolContext.id;
    const schoolUuid = req.schoolContext.uuid;
    const user = await this.resolveUserId(req);
    // نفس المصدر الذي يعتمده RolesGuard — بلا قيمة افتراضية
    const role = req.user?.ut;
    if (!role) {
      throw new UnauthorizedException('USER_TYPE_NOT_IN_TOKEN');
    }

    return this.uploadService.initSession(dto, schoolId, schoolUuid, {
      userId: user.id,
      role,
    });
  }

  /**
   * ② Probe session (for resume)
   */
  @Get('sessions/:uuid')
  async probeSession(
    @Param('uuid') uuid: string,
    @Req() req: AuthenticatedSchoolRequest,
  ) {
    const user = await this.resolveUserId(req);
    return this.uploadService.probeSession(uuid, req.schoolContext.id, user.id);
  }

  /**
   * ③ Upload chunk (binary body with Content-Range header)
   */
  @Put('sessions/:uuid/chunks')
  async uploadChunk(
    @Param('uuid') uuid: string,
    @Headers('content-range') contentRange: string,
    @Req() req: RawBodyRequest<AuthenticatedSchoolRequest>,
  ) {
    const schoolId = req.schoolContext.id;
    const rawChunk: unknown = req.rawBody ?? req.body;
    if (!rawChunk || !Buffer.isBuffer(rawChunk) || rawChunk.length === 0) {
      throw new BadRequestException('EMPTY_CHUNK');
    }
    const user = await this.resolveUserId(req);
    return this.uploadService.uploadChunk(
      uuid,
      schoolId,
      contentRange,
      rawChunk,
      user.id,
    );
  }

  /**
   * ④ Complete upload session
   */
  @Post('sessions/:uuid/complete')
  async completeSession(
    @Param('uuid') uuid: string,
    @Req() req: AuthenticatedSchoolRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.resolveUserId(req);
    const result = await this.uploadService.completeSession(
      uuid,
      req.schoolContext.id,
      req.schoolContext.uuid,
      user.id,
    );
    // VIDEO: 202 Accepted (المعالجة غير متزامنة لدى العامل) — بقية الأنواع كما هي (201)
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
    @Req() req: AuthenticatedSchoolRequest,
  ) {
    const user = await this.resolveUserId(req);
    return this.uploadService.cancelSession(
      uuid,
      req.schoolContext.id,
      user.id,
    );
  }

  // ── Helper ──

  /** Resolve numeric user ID from JWT subject (uuid) */
  private async resolveUserId(
    req: AuthenticatedSchoolRequest,
  ): Promise<{ id: number }> {
    const userUuid = req.user?.sub;

    if (!userUuid) {
      throw new UnauthorizedException('USER_UUID_NOT_IN_TOKEN');
    }

    const user = await this.prisma.user.findUnique({
      where: { uuid: userUuid },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    return user;
  }
}
