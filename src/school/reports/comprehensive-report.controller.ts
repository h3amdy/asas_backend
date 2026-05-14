// src/school/reports/comprehensive-report.controller.ts
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';

/**
 * 📊 Comprehensive Performance Report Controller — ADM-075
 *
 * GET /school/reports/comprehensive/filter-options  → خيارات الفلاتر (♻️)
 * GET /school/reports/comprehensive                 → التقرير الشامل
 */
@Controller('school/reports/comprehensive')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class ComprehensiveReportController {
    constructor(private readonly service: ReportsService) { }

    // ── خيارات الفلاتر (♻️ نفس endpoint) ──
    @Get('filter-options')
    getFilterOptions(@Req() req: any) {
        return this.service.getFilterOptions(req.schoolContext.id);
    }

    // ── التقرير الشامل ──
    @Get()
    getComprehensiveReport(
        @Req() req: any,
        @Query('yearUuid') yearUuid?: string,
        @Query('termUuid') termUuid?: string,
        @Query('gradeUuid') gradeUuid?: string,
        @Query('sectionUuid') sectionUuid?: string,
        @Query('subjectUuid') subjectUuid?: string,
        @Query('period') period?: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string,
    ) {
        return this.service.getComprehensiveReport(req.schoolContext.id, {
            yearUuid,
            termUuid,
            gradeUuid,
            sectionUuid,
            subjectUuid,
            period: period as any ?? 'full_semester',
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 20,
        });
    }
}
