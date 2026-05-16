// src/school/reports/comprehensive-report.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';

/**
 * 📊 Comprehensive Performance Report Controller — ADM-075 / ADM-076
 *
 * GET /school/reports/comprehensive/filter-options                              → خيارات الفلاتر (♻️)
 * GET /school/reports/comprehensive                                            → التقرير الشامل
 * GET /school/reports/comprehensive/students/:studentUuid                      → ADM-076a تفاصيل طالب
 * GET /school/reports/comprehensive/students/:studentUuid/subjects/:subjectUuid → ADM-076b طالب + مادة
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

    // ── ADM-076a: تفاصيل الأداء الشامل لطالب (كل المواد) ──
    @Get('students/:studentUuid')
    getStudentComprehensiveDetail(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('termUuid') termUuid?: string,
        @Query('period') period?: string,
    ) {
        return this.service.getStudentComprehensiveDetail(
            req.schoolContext.id,
            studentUuid,
            {
                yearUuid,
                termUuid,
                period: period as any ?? 'full_semester',
            },
        );
    }

    // ── ADM-076b: تفاصيل الأداء الشامل لطالب في مادة (الدروس) ──
    @Get('students/:studentUuid/subjects/:subjectUuid')
    getStudentSubjectComprehensive(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Param('subjectUuid') subjectUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('termUuid') termUuid?: string,
        @Query('period') period?: string,
    ) {
        return this.service.getStudentSubjectComprehensive(
            req.schoolContext.id,
            studentUuid,
            subjectUuid,
            {
                yearUuid,
                termUuid,
                period: period as any ?? 'full_semester',
            },
        );
    }
}

