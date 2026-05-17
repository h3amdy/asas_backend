// src/school/teacher/reports/teacher-report.controller.ts
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from '../../reports/reports.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 📊 TCH-RPT-01: Teacher Comprehensive Report Controller
 *
 * GET /school/teacher/reports/comprehensive → التقرير الشامل للمعلم في مادة
 *
 * يجلب الشُعب المسندة للمعلم تلقائياً من JWT ويمررها كـ sectionIds
 */
@Controller('school/teacher/reports')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherReportController {
    constructor(
        private readonly reportsService: ReportsService,
        private readonly prisma: PrismaService,
    ) { }

    @Get('comprehensive')
    async getComprehensiveReport(
        @Req() req: any,
        @Query('subjectUuid') subjectUuid: string,
        @Query('termUuid') termUuid?: string,
        @Query('period') period?: string,
    ) {
        const schoolId = req.schoolContext.id;
        const userUuid = req.user.sub;

        // 1. جلب teacherId من JWT
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });

        if (!user?.teacher) {
            return {
                kpis: { totalStudents: 0, averageProgress: 0, averageGrade: null, averagePerformance: 0, weakStudentsCount: 0 },
                students: [],
                charts: { distribution: [], topStudents: [], groupChart: [], groupBySection: true },
            };
        }

        const teacherId = user.teacher.userId;

        // 2. جلب الشُعب المسندة لهذا المعلم في هذه المادة
        const assignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    subject: { uuid: subjectUuid, schoolId, isDeleted: false },
                },
            },
            include: {
                subjectSection: {
                    include: {
                        subject: { select: { grade: { select: { uuid: true } } } },
                        section: { select: { id: true } },
                    },
                },
            },
        });

        if (assignments.length === 0) {
            return {
                kpis: { totalStudents: 0, averageProgress: 0, averageGrade: null, averagePerformance: 0, weakStudentsCount: 0 },
                students: [],
                charts: { distribution: [], topStudents: [], groupChart: [], groupBySection: true },
            };
        }

        // 3. استخراج sectionIds + gradeUuid
        const sectionIds = assignments.map(a => a.subjectSection.section.id);
        const gradeUuid = assignments[0].subjectSection.subject.grade.uuid;

        // 4. استدعاء التقرير الشامل مع الفلاتر
        return this.reportsService.getComprehensiveReport(schoolId, {
            termUuid,
            gradeUuid,
            subjectUuid,
            sectionIds,
            period: (period as any) ?? 'full_semester',
            page: 1,
            pageSize: 9999, // كل الطلاب (بدون pagination سيرفرية)
        });
    }
}
