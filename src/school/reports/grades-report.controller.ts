// src/school/reports/grades-report.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';

/**
 * 📊 Grades Report Controller — ADM-074
 *
 * GET /school/reports/student-grades/filter-options                            → خيارات الفلاتر (♻️ مشترك)
 * GET /school/reports/student-grades                                           → ADM-074a
 * GET /school/reports/student-grades/students/:studentUuid                     → ADM-074b
 * GET /school/reports/student-grades/students/:studentUuid/subjects/:subjectUuid → ADM-074c
 *
 * مراجعة الإجابات: ♻️ نفس endpoint (073d) — بدون إعادة
 */
@Controller('school/reports/student-grades')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class GradesReportController {
    constructor(private readonly service: ReportsService) { }

    // ── خيارات الفلاتر (♻️ نفس endpoint 073) ──
    @Get('filter-options')
    getFilterOptions(@Req() req: any) {
        return this.service.getFilterOptions(req.schoolContext.id);
    }

    // ── Endpoint 1: تقرير درجات الطلاب (ADM-074a) ──
    @Get()
    getStudentGradesReport(
        @Req() req: any,
        @Query('yearUuid') yearUuid?: string,
        @Query('gradeUuid') gradeUuid?: string,
        @Query('sectionUuid') sectionUuid?: string,
        @Query('subjectUuid') subjectUuid?: string,
        @Query('period') period?: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string,
    ) {
        return this.service.getStudentGradesReport(req.schoolContext.id, {
            yearUuid,
            gradeUuid,
            sectionUuid,
            subjectUuid,
            period: period as any ?? 'full_semester',
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 50,
        });
    }

    // ── Endpoint 2: تفاصيل درجات طالب (ADM-074b) ──
    @Get('students/:studentUuid')
    getStudentGradesDetail(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('period') period?: string,
    ) {
        return this.service.getStudentGradesDetail(req.schoolContext.id, studentUuid, {
            yearUuid,
            period: period as any ?? 'full_semester',
        });
    }

    // ── Endpoint 3: درجات طالب في مادة (ADM-074c) ──
    @Get('students/:studentUuid/subjects/:subjectUuid')
    getStudentSubjectGrades(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Param('subjectUuid') subjectUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('period') period?: string,
    ) {
        return this.service.getStudentSubjectGrades(
            req.schoolContext.id,
            studentUuid,
            subjectUuid,
            {
                yearUuid,
                period: period as any ?? 'full_semester',
            },
        );
    }
}
