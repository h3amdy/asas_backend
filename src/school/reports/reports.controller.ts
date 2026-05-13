// src/school/reports/reports.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';

/**
 * 📊 Reports Controller
 *
 * GET /school/reports/student-progress/filter-options               → خيارات الفلاتر
 * GET /school/reports/student-progress                              → ADM-073a
 * GET /school/reports/student-progress/students/:studentUuid        → ADM-073b
 * GET /school/reports/student-progress/students/:studentUuid/subjects/:subjectUuid → ADM-073c
 */
@Controller('school/reports/student-progress')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class ReportsController {
    constructor(private readonly service: ReportsService) { }

    // ── Endpoint 0: خيارات الفلاتر ──
    @Get('filter-options')
    getFilterOptions(@Req() req: any) {
        return this.service.getFilterOptions(req.schoolContext.id);
    }

    // ── Endpoint 1: تقرير إنجاز الطلاب (ADM-073a) ──
    @Get()
    getStudentProgressReport(
        @Req() req: any,
        @Query('yearUuid') yearUuid?: string,
        @Query('gradeUuid') gradeUuid?: string,
        @Query('sectionUuid') sectionUuid?: string,
        @Query('subjectUuid') subjectUuid?: string,
        @Query('period') period?: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string,
    ) {
        return this.service.getStudentProgressReport(req.schoolContext.id, {
            yearUuid,
            gradeUuid,
            sectionUuid,
            subjectUuid,
            period: period as any ?? 'full_semester',
            page: page ? parseInt(page, 10) : 1,
            pageSize: pageSize ? parseInt(pageSize, 10) : 50,
        });
    }

    // ── Endpoint 2: تفاصيل إنجاز طالب (ADM-073b) ──
    @Get('students/:studentUuid')
    getStudentProgressDetail(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('period') period?: string,
    ) {
        return this.service.getStudentProgressDetail(req.schoolContext.id, studentUuid, {
            yearUuid,
            period: period as any ?? 'full_semester',
        });
    }

    // ── Endpoint 3: إنجاز طالب في مادة (ADM-073c) ──
    @Get('students/:studentUuid/subjects/:subjectUuid')
    getStudentSubjectProgress(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Param('subjectUuid') subjectUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('period') period?: string,
    ) {
        return this.service.getStudentSubjectProgress(
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
