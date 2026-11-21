// src/school/teacher/reports/teacher-report.controller.ts
import {
    BadRequestException,
    Controller,
    ForbiddenException,
    Get,
    Param,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ReportsService } from '../../reports/reports.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 📊 TCH-RPT-01: Teacher Comprehensive Report Controller
 *
 * GET /school/teacher/reports/comprehensive                                    → التقرير الشامل للمعلم في مادة
 * GET /school/teacher/reports/comprehensive/students/:studentUuid              → تفاصيل طالب (مواد المعلم فقط)
 * GET /school/teacher/reports/comprehensive/students/:studentUuid/subjects/:subjectUuid → تفاصيل طالب في مادة
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

    private async resolveActiveTeacherId(
        schoolId: number,
        userUuid: string,
    ): Promise<number> {
        const user = await this.prisma.user.findFirst({
            where: {
                uuid: userUuid,
                schoolId,
                userType: 'TEACHER',
                isDeleted: false,
                isActive: true,
            },
            include: { teacher: { select: { userId: true } } },
        });
        if (!user?.teacher) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }
        return user.teacher.userId;
    }

    private async resolveStudentCurrentSection(
        schoolId: number,
        studentUuid: string,
    ): Promise<{ studentId: number; sectionId: number; gradeId: number } | null> {
        const studentUser = await this.prisma.user.findFirst({
            where: {
                uuid: studentUuid,
                schoolId,
                userType: 'STUDENT',
                isDeleted: false,
            },
            select: {
                student: {
                    select: {
                        userId: true,
                        enrollments: {
                            where: {
                                isCurrent: true,
                                isDeleted: false,
                                section: {
                                    isDeleted: false,
                                    grade: { schoolId, isDeleted: false },
                                },
                            },
                            select: { sectionId: true, gradeId: true },
                            take: 1,
                        },
                    },
                },
            },
        });
        const enrollment = studentUser?.student?.enrollments?.[0];
        if (!studentUser?.student || !enrollment) {
            return null;
        }
        return {
            studentId: studentUser.student.userId,
            sectionId: enrollment.sectionId,
            gradeId: enrollment.gradeId,
        };
    }

    // ── خيارات الفلاتر (فصول دراسية + سنوات + صفوف/شعب/مواد المعلم فقط) ──
    @Get('filter-options')
    async getFilterOptions(@Req() req: any) {
        const schoolId = req.schoolContext.id;
        const teacherId = await this.resolveActiveTeacherId(schoolId, req.user.sub);

        const [filterOptions, assignments] = await Promise.all([
            this.reportsService.getFilterOptions(schoolId),
            this.prisma.subjectSectionTeacher.findMany({
                where: {
                    teacherId,
                    isDeleted: false,
                    isActive: true,
                    subjectSection: {
                        isDeleted: false,
                        subject: { schoolId, isDeleted: false, isActive: true },
                        section: {
                            isDeleted: false,
                            isActive: true,
                            grade: { schoolId, isDeleted: false, isActive: true },
                        },
                    },
                },
                select: {
                    subjectSection: {
                        select: {
                            section: {
                                select: {
                                    uuid: true,
                                    grade: { select: { uuid: true } },
                                },
                            },
                            subject: {
                                select: {
                                    uuid: true,
                                    grade: { select: { uuid: true } },
                                },
                            },
                        },
                    },
                },
            }),
        ]);

        const allowedGradeUuids = new Set<string>();
        const allowedSectionUuids = new Set<string>();
        const allowedSubjectUuids = new Set<string>();

        for (const a of assignments) {
            allowedSectionUuids.add(a.subjectSection.section.uuid);
            allowedGradeUuids.add(a.subjectSection.section.grade.uuid);
            allowedGradeUuids.add(a.subjectSection.subject.grade.uuid);
            allowedSubjectUuids.add(a.subjectSection.subject.uuid);
        }

        return {
            ...filterOptions,
            grades: filterOptions.grades.filter((g) => allowedGradeUuids.has(g.uuid)),
            sections: filterOptions.sections.filter((s) => allowedSectionUuids.has(s.uuid)),
            subjects: filterOptions.subjects.filter((s) => allowedSubjectUuids.has(s.uuid)),
        };
    }

    @Get('comprehensive')
    async getComprehensiveReport(
        @Req() req: any,
        @Query('subjectUuid') subjectUuid: string,
        @Query('termUuid') termUuid?: string,
        @Query('period') period?: string,
        @Query('sectionUuid') sectionUuid?: string,
    ) {
        const normalizedSubjectUuid = subjectUuid?.trim();
        if (!normalizedSubjectUuid) {
            throw new BadRequestException('SUBJECT_UUID_REQUIRED');
        }

        const schoolId = req.schoolContext.id;
        const teacherId = await this.resolveActiveTeacherId(schoolId, req.user.sub);

        // 2. جلب الشُعب المسندة لهذا المعلم في هذه المادة
        const assignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    subject: { uuid: normalizedSubjectUuid, schoolId, isDeleted: false },
                    section: { isDeleted: false, grade: { schoolId, isDeleted: false } },
                },
            },
            include: {
                subjectSection: {
                    include: {
                        subject: { select: { grade: { select: { uuid: true } } } },
                        section: { select: { id: true, uuid: true } },
                    },
                },
            },
        });

        if (assignments.length === 0) {
            throw new ForbiddenException('المادة غير مسندة لك');
        }

        // 3. استخراج sectionIds + gradeUuid
        // فلترة اختيارية بشعبة واحدة — يجب أن تكون من شُعب المعلم
        let scoped = assignments;
        const normalizedSectionUuid = sectionUuid?.trim();
        if (normalizedSectionUuid) {
            scoped = assignments.filter(
                (a) => a.subjectSection.section.uuid === normalizedSectionUuid,
            );
            if (scoped.length === 0) {
                throw new ForbiddenException('الشعبة غير مسندة لك في هذه المادة');
            }
        }
        const sectionIds = scoped.map((a) => a.subjectSection.section.id);
        const gradeUuid = assignments[0].subjectSection.subject.grade.uuid;

        // 4. استدعاء التقرير الشامل مع الفلاتر
        return this.reportsService.getComprehensiveReport(schoolId, {
            termUuid,
            gradeUuid,
            subjectUuid: normalizedSubjectUuid,
            sectionIds,
            period: (period as any) ?? 'full_semester',
            page: 1,
            pageSize: 9999, // كل الطلاب (بدون pagination سيرفرية)
        });
    }

    // ── تفاصيل الأداء الشامل لطالب (مواد المعلم المسندة في شعبة الطالب فقط) ──
    @Get('comprehensive/students/:studentUuid')
    async getStudentComprehensiveDetail(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Query('subjectUuid') subjectUuid?: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('termUuid') termUuid?: string,
        @Query('period') period?: string,
    ) {
        const schoolId = req.schoolContext.id;
        const teacherId = await this.resolveActiveTeacherId(schoolId, req.user.sub);
        const studentCtx = await this.resolveStudentCurrentSection(schoolId, studentUuid);
        if (!studentCtx) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        const normalizedSubjectUuid = subjectUuid?.trim();
        const assignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    sectionId: studentCtx.sectionId,
                    section: { isDeleted: false, grade: { schoolId, isDeleted: false } },
                    subject: {
                        schoolId,
                        isDeleted: false,
                        isActive: true,
                        ...(normalizedSubjectUuid ? { uuid: normalizedSubjectUuid } : {}),
                    },
                },
            },
            select: { subjectSection: { select: { subjectId: true } } },
        });
        if (assignments.length === 0) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }
        const allowedSubjectIds = Array.from(
            new Set(assignments.map((a) => a.subjectSection.subjectId)),
        );

        return this.reportsService.getStudentComprehensiveDetail(
            schoolId,
            studentUuid,
            {
                yearUuid,
                termUuid,
                period: (period as any) ?? 'full_semester',
            },
            { allowedSubjectIds },
        );
    }

    // ── تفاصيل أداء طالب في مادة (الدروس) ──
    @Get('comprehensive/students/:studentUuid/subjects/:subjectUuid')
    async getStudentSubjectComprehensive(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Param('subjectUuid') subjectUuid: string,
        @Query('yearUuid') yearUuid?: string,
        @Query('termUuid') termUuid?: string,
        @Query('period') period?: string,
    ) {
        const schoolId = req.schoolContext.id;
        const teacherId = await this.resolveActiveTeacherId(schoolId, req.user.sub);
        const studentCtx = await this.resolveStudentCurrentSection(schoolId, studentUuid);
        if (!studentCtx) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    sectionId: studentCtx.sectionId,
                    section: { isDeleted: false, grade: { schoolId, isDeleted: false } },
                    subject: { uuid: subjectUuid, schoolId, isDeleted: false },
                },
            },
            select: { teacherId: true },
        });
        if (!assignment) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        return this.reportsService.getStudentSubjectComprehensive(
            schoolId,
            studentUuid,
            subjectUuid,
            {
                yearUuid,
                termUuid,
                period: (period as any) ?? 'full_semester',
            },
        );
    }

    // ── مراجعة إجابات طالب في درس (سياق المعلم — DUP-R3-01 / SEC-TCH-02) ──
    // يُسمح فقط إذا كان المعلم مسنداً لمادة هذا الدرس ولشعبة الطالب الحالية وكان الدرس مستهدفاً للشعبة،
    // مع توحيد رفض 403 قبل فحص وجود الدرس لمنع تسريب وجود الطلاب أو الدروس (404 vs 403 Oracle).
    @Get('comprehensive/students/:studentUuid/lessons/:lessonUuid/review')
    async getStudentLessonReview(
        @Req() req: any,
        @Param('studentUuid') studentUuid: string,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        const schoolId = req.schoolContext.id;
        const teacherId = await this.resolveActiveTeacherId(schoolId, req.user.sub);
        const studentCtx = await this.resolveStudentCurrentSection(schoolId, studentUuid);
        if (!studentCtx) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        const sectionAssignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    sectionId: studentCtx.sectionId,
                    subject: { schoolId, isDeleted: false },
                    section: { isDeleted: false, grade: { schoolId, isDeleted: false } },
                },
            },
            select: { subjectSection: { select: { subjectId: true } } },
        });
        if (sectionAssignments.length === 0) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }
        const assignedSubjectIds = Array.from(
            new Set(sectionAssignments.map((a) => a.subjectSection.subjectId)),
        );

        const lesson = await this.prisma.lesson.findFirst({
            where: {
                uuid: lessonUuid,
                schoolId,
                isDeleted: false,
                subjectId: { in: assignedSubjectIds },
            },
            select: { id: true },
        });
        if (!lesson) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        const lessonTarget = await this.prisma.lessonTarget.findFirst({
            where: {
                lessonId: lesson.id,
                sectionId: studentCtx.sectionId,
            },
            select: { id: true },
        });
        if (!lessonTarget) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        return this.reportsService.getStudentLessonReview(schoolId, studentUuid, lessonUuid);
    }
}
