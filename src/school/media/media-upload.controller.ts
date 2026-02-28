// src/school/media/media-upload.controller.ts
import {
    Controller, Post, Get, Put, Param, Body, Req,
    UseGuards, Headers, RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { MediaUploadService } from './media-upload.service';
import { InitUploadSessionDto } from './dto/init-upload-session.dto';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 📤 Media Upload Controller (Chunked + Resume)
 *
 * POST   /school/media-upload/sessions              → Init session
 * GET    /school/media-upload/sessions/:uuid         → Probe/Resume
 * PUT    /school/media-upload/sessions/:uuid/chunks  → Upload chunk
 * POST   /school/media-upload/sessions/:uuid/complete → Complete
 * POST   /school/media-upload/sessions/:uuid/cancel   → Cancel
 */
@Controller('school/media-upload')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN', 'TEACHER')
export class MediaUploadController {
    constructor(
        private readonly uploadService: MediaUploadService,
        private readonly prisma: PrismaService,
    ) { }

    /**
     * ① Start upload session
     */
    @Post('sessions')
    async initSession(@Body() dto: InitUploadSessionDto, @Req() req: any) {
        const schoolId = req.schoolContext.id;
        const schoolUuid = req.schoolContext.uuid;
        const user = await this.resolveUserId(req);

        return this.uploadService.initSession(dto, schoolId, schoolUuid, user.id);
    }

    /**
     * ② Probe session (for resume)
     */
    @Get('sessions/:uuid')
    async probeSession(@Param('uuid') uuid: string, @Req() req: any) {
        return this.uploadService.probeSession(uuid, req.schoolContext.id);
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
        const schoolId = (req as any).schoolContext.id;
        const chunk = req.body as Buffer;
        return this.uploadService.uploadChunk(uuid, schoolId, contentRange, chunk);
    }

    /**
     * ④ Complete upload session
     */
    @Post('sessions/:uuid/complete')
    async completeSession(@Param('uuid') uuid: string, @Req() req: any) {
        return this.uploadService.completeSession(
            uuid,
            req.schoolContext.id,
            req.schoolContext.uuid,
        );
    }

    /**
     * ⑤ Cancel upload session
     */
    @Post('sessions/:uuid/cancel')
    async cancelSession(@Param('uuid') uuid: string, @Req() req: any) {
        return this.uploadService.cancelSession(uuid, req.schoolContext.id);
    }

    // ── Helper ──

    /** Resolve numeric user ID from JWT subject (uuid) */
    private async resolveUserId(req: any): Promise<{ id: number }> {
        const userUuid = req.user?.sub;

        if (!userUuid) {
            throw new Error('USER_UUID_NOT_IN_TOKEN');
        }

        const user = await this.prisma.user.findUnique({
            where: { uuid: userUuid },
            select: { id: true },
        });

        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        return user;
    }
}
