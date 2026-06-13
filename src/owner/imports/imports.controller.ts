// src/owner/imports/imports.controller.ts
import {
    Body, Controller, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { ImportsService } from './imports.service';
import { PreviewStudentsImportDto, PreviewTeachersImportDto } from './dto/import.dto';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';

@Controller('schools/:schoolUuid/imports')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class ImportsController {
    constructor(private readonly importsService: ImportsService) {}

    // ─── Preview Students Import ────────────────────────────────
    @Post('students/preview')
    previewStudents(
        @Param('schoolUuid') schoolUuid: string,
        @Body() dto: PreviewStudentsImportDto,
        @Req() req: any,
    ) {
        return this.importsService.previewStudents(schoolUuid, dto, req.user.sub);
    }

    // ─── Preview Teachers Import ────────────────────────────────
    @Post('teachers/preview')
    previewTeachers(
        @Param('schoolUuid') schoolUuid: string,
        @Body() dto: PreviewTeachersImportDto,
        @Req() req: any,
    ) {
        return this.importsService.previewTeachers(schoolUuid, dto, req.user.sub);
    }

    // ─── Get Import Preview ─────────────────────────────────────
    @Get(':importUuid')
    getImportPreview(
        @Param('schoolUuid') schoolUuid: string,
        @Param('importUuid') importUuid: string,
    ) {
        return this.importsService.getImportPreview(schoolUuid, importUuid);
    }

    // ─── Execute Import ─────────────────────────────────────────
    @Post(':importUuid/execute')
    executeImport(
        @Param('schoolUuid') schoolUuid: string,
        @Param('importUuid') importUuid: string,
    ) {
        return this.importsService.executeImport(schoolUuid, importUuid);
    }

    // ─── Get Credentials ────────────────────────────────────────
    @Get(':importUuid/credentials')
    getCredentials(
        @Param('schoolUuid') schoolUuid: string,
        @Param('importUuid') importUuid: string,
    ) {
        return this.importsService.getCredentials(schoolUuid, importUuid);
    }
}
