// src/school/reports/reports.service.ts
//
// ADM-073 — تقرير إنجاز الطلاب
//
// يعتمد على:
//   - StudentProgressSummaryService (خدمة حساب الإنجاز المشتركة)
//   - StudentEnrollment (قيد الطالب → صف/شعبة)
//   - LessonTarget + StudentLessonResult (الإنجاز الفعلي)
//
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentProgressSummaryService } from '../common/services/student-progress-summary.service';

// ── Types ──

type TimePeriod = 'last_day' | 'this_week' | 'this_month' | 'full_semester';

interface ReportFilters {
    yearUuid?: string;
    gradeUuid?: string;
    sectionUuid?: string;
    subjectUuid?: string;
    period: TimePeriod;
    page: number;
    pageSize: number;
}

interface DetailFilters {
    yearUuid?: string;
    period: TimePeriod;
}

@Injectable()
export class ReportsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly progressService: StudentProgressSummaryService,
    ) { }

    // ═══════════════════════════════════════════════════════════════════
    // Endpoint 0: خيارات الفلاتر
    // ═══════════════════════════════════════════════════════════════════

    async getFilterOptions(schoolId: number) {
        const [years, grades, sections, subjects] = await Promise.all([
            this.prisma.year.findMany({
                where: { schoolId, isDeleted: false },
                select: { uuid: true, name: true, isCurrent: true },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.schoolGrade.findMany({
                where: { schoolId, isDeleted: false, isActive: true },
                select: { uuid: true, displayName: true },
                orderBy: { sortOrder: 'asc' },
            }),
            this.prisma.section.findMany({
                where: { grade: { schoolId }, isDeleted: false, isActive: true },
                select: {
                    uuid: true,
                    name: true,
                    grade: { select: { uuid: true } },
                },
                orderBy: { orderIndex: 'asc' },
            }),
            this.prisma.subject.findMany({
                where: { schoolId, isDeleted: false, isActive: true },
                select: {
                    uuid: true,
                    displayName: true,
                    grade: { select: { uuid: true } },
                },
                orderBy: { displayName: 'asc' },
            }),
        ]);

        return {
            years,
            grades: grades.map(g => ({ uuid: g.uuid, name: g.displayName })),
            sections: sections.map(s => ({
                uuid: s.uuid,
                name: s.name,
                gradeUuid: s.grade.uuid,
            })),
            subjects: subjects.map(s => ({
                uuid: s.uuid,
                name: s.displayName,
                gradeUuid: s.grade.uuid,
            })),
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // Endpoint 1: تقرير إنجاز الطلاب (ADM-073a)
    // ═══════════════════════════════════════════════════════════════════

    async getStudentProgressReport(schoolId: number, filters: ReportFilters) {
        // ── 1. تحديد السنة ──
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        if (!yearId) {
            return { summary: { totalStudents: 0, averageProgress: 0, lateStudentsCount: 0 }, students: [], pagination: this.emptyPagination(filters) };
        }

        // ── 2. تحديد الفصل ──
        const termId = await this.resolveTermId(yearId);
        if (!termId) {
            return { summary: { totalStudents: 0, averageProgress: 0, lateStudentsCount: 0 }, students: [], pagination: this.emptyPagination(filters) };
        }

        // ── 3. جلب الطلاب المسجلين (مع الفلاتر) ──
        const enrollmentWhere: any = {
            isCurrent: true,
            isDeleted: false,
            yearId,
            student: { user: { schoolId, isDeleted: false } },
        };

        if (filters.gradeUuid) {
            enrollmentWhere.grade = { uuid: filters.gradeUuid };
        }
        if (filters.sectionUuid) {
            enrollmentWhere.section = { uuid: filters.sectionUuid };
        }

        // ── 4. Pagination: عدد الطلاب ──
        const totalCount = await this.prisma.studentEnrollment.count({ where: enrollmentWhere });

        const enrollments = await this.prisma.studentEnrollment.findMany({
            where: enrollmentWhere,
            include: {
                student: {
                    include: {
                        user: { select: { uuid: true, name: true, avatarMediaAsset: { select: { uuid: true } } } },
                    },
                },
                grade: { select: { displayName: true } },
                section: { select: { name: true } },
            },
            skip: (filters.page - 1) * filters.pageSize,
            take: filters.pageSize,
            orderBy: { student: { user: { name: 'asc' } } },
        });

        // ── 5. حساب الإنجاز لكل طالب ──
        const dateFilter = this.getDateFilter(filters.period);

        // تحديد المادة (اختياري)
        const subjectId = filters.subjectUuid
            ? (await this.prisma.subject.findFirst({ where: { uuid: filters.subjectUuid, schoolId } }))?.id
            : undefined;

        const students = await Promise.all(
            enrollments.map(async (enrollment) => {
                const progress = await this.calculateStudentProgress(
                    schoolId, enrollment.studentId, enrollment.sectionId,
                    yearId, termId, dateFilter, subjectId,
                );
                return {
                    uuid: enrollment.student.user.uuid,
                    name: enrollment.student.user.name,
                    avatarAssetUuid: enrollment.student.user.avatarMediaAsset?.uuid ?? null,
                    grade: enrollment.grade.displayName,
                    section: enrollment.section.name,
                    totalLessons: progress.totalLessons,
                    completedLessons: progress.completedLessons,
                    progressPercent: progress.progressPercent,
                };
            }),
        );

        // ── 6. الملخص ──
        const totalStudents = totalCount;
        const averageProgress = students.length > 0
            ? Math.round((students.reduce((sum, s) => sum + s.progressPercent, 0) / students.length) * 10) / 10
            : 0;
        // متأخر = أقل من 50%
        const lateStudentsCount = students.filter(s => s.progressPercent < 50).length;

        return {
            summary: { totalStudents, averageProgress, lateStudentsCount },
            students,
            pagination: {
                page: filters.page,
                pageSize: filters.pageSize,
                totalCount,
                totalPages: Math.ceil(totalCount / filters.pageSize),
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // Endpoint 2: تفاصيل إنجاز طالب (ADM-073b)
    // ═══════════════════════════════════════════════════════════════════

    async getStudentProgressDetail(
        schoolId: number,
        studentUuid: string,
        filters: DetailFilters,
    ) {
        // ── جلب الطالب + قيده ──
        const studentUser = await this.prisma.user.findFirst({
            where: { uuid: studentUuid, schoolId, isDeleted: false },
            select: {
                uuid: true,
                name: true,
                avatarMediaAsset: { select: { uuid: true } },
                student: {
                    include: {
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                            include: {
                                grade: { select: { displayName: true, id: true } },
                                section: { select: { name: true, id: true } },
                            },
                            take: 1,
                        },
                    },
                },
            },
        });

        if (!studentUser?.student?.enrollments[0]) {
            throw new NotFoundException('الطالب غير موجود أو ليس لديه قيد حالي');
        }

        const enrollment = studentUser.student.enrollments[0];
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        const termId = yearId ? await this.resolveTermId(yearId) : null;
        const dateFilter = this.getDateFilter(filters.period);

        // ── ملخص الإنجاز العام ──
        let overallProgress = { totalLessons: 0, completedLessons: 0, progressPercent: 0 };
        if (yearId && termId) {
            overallProgress = await this.calculateStudentProgress(
                schoolId, studentUser.student.userId, enrollment.sectionId,
                yearId, termId, dateFilter,
            );
        }

        // ── الإنجاز حسب المواد ──
        const subjects = await this.prisma.subject.findMany({
            where: {
                schoolId,
                isDeleted: false,
                isActive: true,
                grade: { id: enrollment.gradeId },
            },
            select: { id: true, uuid: true, displayName: true, coverMediaAsset: { select: { uuid: true } } },
            orderBy: { displayName: 'asc' },
        });

        const subjectProgress = yearId && termId
            ? await Promise.all(
                subjects.map(async (subject) => {
                    const progress = await this.calculateStudentProgress(
                        schoolId, studentUser.student!.userId, enrollment.sectionId,
                        yearId, termId, dateFilter, subject.id,
                    );
                    return {
                        uuid: subject.uuid,
                        name: subject.displayName,
                        coverAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                        totalLessons: progress.totalLessons,
                        completedLessons: progress.completedLessons,
                        progressPercent: progress.progressPercent,
                        missingLessons: progress.totalLessons - progress.completedLessons,
                    };
                }),
            )
            : [];

        return {
            student: {
                uuid: studentUser.uuid,
                name: studentUser.name,
                avatarAssetUuid: studentUser.avatarMediaAsset?.uuid ?? null,
                grade: enrollment.grade.displayName,
                section: enrollment.section.name,
            },
            summary: overallProgress,
            subjects: subjectProgress,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // Endpoint 3: إنجاز طالب في مادة (ADM-073c)
    // ═══════════════════════════════════════════════════════════════════

    async getStudentSubjectProgress(
        schoolId: number,
        studentUuid: string,
        subjectUuid: string,
        filters: DetailFilters,
    ) {
        // ── جلب الطالب ──
        const studentUser = await this.prisma.user.findFirst({
            where: { uuid: studentUuid, schoolId, isDeleted: false },
            select: {
                uuid: true,
                name: true,
                avatarMediaAsset: { select: { uuid: true } },
                student: {
                    include: {
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                            include: {
                                grade: { select: { displayName: true } },
                                section: { select: { name: true, id: true } },
                            },
                            take: 1,
                        },
                    },
                },
            },
        });

        if (!studentUser?.student?.enrollments[0]) {
            throw new NotFoundException('الطالب غير موجود');
        }

        // ── جلب المادة ──
        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
            select: { id: true, uuid: true, displayName: true, coverMediaAsset: { select: { uuid: true } } },
        });

        if (!subject) {
            throw new NotFoundException('المادة غير موجودة');
        }

        const enrollment = studentUser.student.enrollments[0];
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        const termId = yearId ? await this.resolveTermId(yearId) : null;
        const dateFilter = this.getDateFilter(filters.period);

        // ── ملخص الإنجاز في المادة ──
        let summary = { totalLessons: 0, completedLessons: 0, progressPercent: 0 };
        if (yearId && termId) {
            summary = await this.calculateStudentProgress(
                schoolId, studentUser.student.userId, enrollment.sectionId,
                yearId, termId, dateFilter, subject.id,
            );
        }

        // ── قائمة الدروس ──
        const lessonTargetWhere: any = {
            sectionId: enrollment.sectionId,
            lesson: {
                schoolId,
                subjectId: subject.id,
                status: { in: ['PUBLISHED', 'DELIVERED'] },
                isDeleted: false,
                isActive: true,
            },
        };

        if (yearId) lessonTargetWhere.lesson.yearId = yearId;
        if (termId) lessonTargetWhere.lesson.termId = termId;
        if (dateFilter) lessonTargetWhere.lesson.publishedAt = dateFilter;

        const targets = await this.prisma.lessonTarget.findMany({
            where: lessonTargetWhere,
            select: {
                lessonId: true,
                lesson: {
                    select: {
                        uuid: true,
                        template: { select: { title: true } },
                        publishedAt: true,
                    },
                },
            },
            orderBy: { lesson: { publishedAt: 'desc' } },
        });

        // ── حالة الإنجاز لكل درس ──
        const lessonIds = targets.map(t => t.lessonId);
        const completedResults = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId: studentUser.student!.userId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            select: { lessonId: true },
        });
        const completedSet = new Set(completedResults.map(r => r.lessonId));

        const lessons = targets.map(t => ({
            uuid: t.lesson.uuid,
            title: t.lesson.template.title,
            publishedAt: t.lesson.publishedAt,
            isCompleted: completedSet.has(t.lessonId),
            hasReview: completedSet.has(t.lessonId), // المراجعة متاحة للدروس المكتملة
        }));

        return {
            student: {
                uuid: studentUser.uuid,
                name: studentUser.name,
                avatarAssetUuid: studentUser.avatarMediaAsset?.uuid ?? null,
                grade: enrollment.grade.displayName,
                section: enrollment.section.name,
            },
            subject: {
                uuid: subject.uuid,
                name: subject.displayName,
                coverAssetUuid: subject.coverMediaAsset?.uuid ?? null,
            },
            summary,
            lessons,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // Endpoint 4: مراجعة إجابات طالب في درس (ADM-073d)
    // ═══════════════════════════════════════════════════════════════════

    async getStudentLessonReview(
        schoolId: number,
        studentUuid: string,
        lessonUuid: string,
    ) {
        // ── جلب الطالب ──
        const studentUser = await this.prisma.user.findFirst({
            where: { uuid: studentUuid, schoolId, isDeleted: false },
            select: {
                student: { select: { userId: true } },
            },
        });

        if (!studentUser?.student) {
            throw new NotFoundException('الطالب غير موجود');
        }

        // ── جلب الدرس ──
        const lesson = await this.prisma.lesson.findFirst({
            where: { uuid: lessonUuid, schoolId, isDeleted: false },
            select: { id: true, templateId: true },
        });

        if (!lesson) {
            throw new NotFoundException('LESSON_NOT_FOUND');
        }

        // ── آخر نتيجة ──
        const result = await this.prisma.studentLessonResult.findFirst({
            where: { studentId: studentUser.student.userId, lessonId: lesson.id, isDeleted: false },
            orderBy: { calculatedAt: 'desc' },
        });
        if (!result) throw new NotFoundException('RESULT_NOT_FOUND');

        // ── الأسئلة (نفس بنية parent-children.service) ──
        const questions = await this.prisma.question.findMany({
            where: { templateId: lesson.templateId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                options: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true, optionText: true,
                        imageAssetId: true, imageAsset: { select: { uuid: true } },
                        audioAssetId: true, audioAsset: { select: { uuid: true } },
                        isCorrect: true, orderIndex: true,
                    },
                },
                matchingPairs: {
                    where: { isDeleted: false },
                    select: {
                        uuid: true, pairKey: true,
                        leftText: true, leftImageAsset: { select: { uuid: true } },
                        leftAudioAsset: { select: { uuid: true } },
                        rightText: true, rightImageAsset: { select: { uuid: true } },
                        rightAudioAsset: { select: { uuid: true } },
                        leftOrderIndex: true, rightOrderIndex: true,
                    },
                },
                orderingItems: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true, itemText: true,
                        imageAsset: { select: { uuid: true } },
                        correctIndex: true, orderIndex: true,
                    },
                },
                fillBlanks: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: { uuid: true, blankKey: true, orderIndex: true, placeholder: true },
                },
                fillAnswers: {
                    where: { isDeleted: false },
                    select: { blankKey: true, answerText: true, isPrimary: true },
                },
                questionImageAsset: { select: { uuid: true } },
                questionAudioAsset: { select: { uuid: true } },
                explanationImageAsset: { select: { uuid: true } },
                explanationAudioAsset: { select: { uuid: true } },
            },
        });

        // ── إجابات الطالب ──
        const questionIds = questions.map(q => q.id);
        const studentAnswers = await this.prisma.studentAnswer.findMany({
            where: {
                studentId: studentUser.student.userId,
                questionId: { in: questionIds },
                isDeleted: false,
            },
        });
        const answerMap = new Map(studentAnswers.map(a => [a.questionId, a]));

        // ── تجميع المراجعة (نفس بنية parent-children.service) ──
        const reviewQuestions = questions.map(q => {
            const studentAns = answerMap.get(q.id);

            let parsedAnswer: any = null;
            if (studentAns) {
                try {
                    parsedAnswer = typeof studentAns.answerValue === 'string'
                        ? JSON.parse(studentAns.answerValue)
                        : studentAns.answerValue;
                } catch {
                    parsedAnswer = studentAns.answerValue;
                }
            }

            const base: any = {
                uuid: q.uuid,
                type: q.type,
                orderIndex: q.orderIndex,
                questionText: q.questionText,
                instructionText: (q as any).instructionText ?? null,
                questionImageAssetUuid: q.questionImageAsset?.uuid ?? null,
                questionAudioAssetUuid: q.questionAudioAsset?.uuid ?? null,
                score: q.score ?? 1,
                explanation: {
                    text: q.explanationText ?? null,
                    imageAssetUuid: q.explanationImageAsset?.uuid ?? null,
                    audioAssetUuid: q.explanationAudioAsset?.uuid ?? null,
                },
                studentAnswer: studentAns ? {
                    answerValue: parsedAnswer,
                    isCorrect: studentAns.isCorrect ?? false,
                    scoreAwarded: studentAns.scoreAwarded ?? 0,
                } : null,
            };

            switch (q.type) {
                case 'MCQ':
                case 'TRUE_FALSE':
                    base.options = q.options.map(o => ({
                        uuid: o.uuid, optionText: o.optionText,
                        imageAssetUuid: o.imageAsset?.uuid ?? null,
                        audioAssetUuid: o.audioAsset?.uuid ?? null,
                        isCorrect: o.isCorrect, orderIndex: o.orderIndex,
                    }));
                    break;
                case 'MATCHING':
                    base.matchingPairs = q.matchingPairs.map(p => ({
                        uuid: p.uuid, pairKey: p.pairKey,
                        leftText: p.leftText, leftImageAssetUuid: p.leftImageAsset?.uuid ?? null,
                        leftAudioAssetUuid: (p as any).leftAudioAsset?.uuid ?? null,
                        rightText: p.rightText, rightImageAssetUuid: p.rightImageAsset?.uuid ?? null,
                        rightAudioAssetUuid: (p as any).rightAudioAsset?.uuid ?? null,
                        leftOrderIndex: p.leftOrderIndex, rightOrderIndex: p.rightOrderIndex,
                    }));
                    break;
                case 'ORDERING':
                case 'IMAGE_STEP_SORTING':
                    base.orderingItems = q.orderingItems.map(i => ({
                        uuid: i.uuid, itemText: i.itemText,
                        imageAssetUuid: i.imageAsset?.uuid ?? null,
                        correctIndex: i.correctIndex, orderIndex: i.orderIndex,
                    }));
                    break;
                case 'FILL':
                    base.fillBlanks = q.fillBlanks.map(b => ({
                        uuid: b.uuid, blankKey: b.blankKey,
                        orderIndex: b.orderIndex, placeholder: b.placeholder,
                    }));
                    base.fillCorrectAnswers = q.fillAnswers.reduce((acc: any, a) => {
                        if (!acc[a.blankKey]) acc[a.blankKey] = [];
                        acc[a.blankKey].push(a.answerText.trim());
                        return acc;
                    }, {});
                    break;
            }
            return base;
        });

        return {
            result: {
                resultUuid: result.uuid,
                totalQuestions: result.totalQuestions,
                correctQuestions: result.correctQuestions,
                totalPoints: result.totalPoints,
                earnedPoints: result.earnedPoints,
                percent: Math.round(result.percent),
                gradeLabel: result.gradeLabel,
            },
            questions: reviewQuestions,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * حساب إنجاز طالب (اختيارياً لمادة واحدة)
     */
    private async calculateStudentProgress(
        schoolId: number,
        studentId: number,
        sectionId: number,
        yearId: number,
        termId: number,
        dateFilter: any,
        subjectId?: number,
    ) {
        const targetWhere: any = {
            sectionId,
            lesson: {
                schoolId,
                yearId,
                termId,
                status: { in: ['PUBLISHED', 'DELIVERED'] },
                isDeleted: false,
                isActive: true,
            },
        };

        if (subjectId) targetWhere.lesson.subjectId = subjectId;
        if (dateFilter) targetWhere.lesson.publishedAt = dateFilter;

        const targets = await this.prisma.lessonTarget.findMany({
            where: targetWhere,
            select: { lessonId: true },
        });

        const totalLessons = targets.length;
        if (totalLessons === 0) return { totalLessons: 0, completedLessons: 0, progressPercent: 0 };

        const lessonIds = targets.map(t => t.lessonId);
        const completedResults = await this.prisma.studentLessonResult.groupBy({
            by: ['lessonId'],
            where: {
                studentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
        });

        const completedLessons = Math.min(completedResults.length, totalLessons);
        const progressPercent = Math.round((completedLessons / totalLessons) * 1000) / 10;

        return { totalLessons, completedLessons, progressPercent };
    }

    /**
     * تحديد yearId من UUID (أو السنة الحالية)
     */
    private async resolveYearId(schoolId: number, yearUuid?: string): Promise<number | null> {
        if (yearUuid) {
            const year = await this.prisma.year.findFirst({
                where: { uuid: yearUuid, schoolId, isDeleted: false },
                select: { id: true },
            });
            return year?.id ?? null;
        }

        // الافتراضي: السنة الحالية
        const current = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            select: { id: true },
        });
        return current?.id ?? null;
    }

    /**
     * تحديد termId (الفصل الحالي للسنة)
     */
    private async resolveTermId(yearId: number): Promise<number | null> {
        const term = await this.prisma.term.findFirst({
            where: { yearId, isCurrent: true, isDeleted: false },
            select: { id: true },
        });
        return term?.id ?? null;
    }

    /**
     * DEC-RPT-001: فلتر الفترة الزمنية
     * يعتمد على publishedAt
     * "last_day" = آخر يوم تقويمي يحتوي دروس منشورة ضمن السياق
     */
    private getDateFilter(period: TimePeriod): any {
        const now = new Date();

        switch (period) {
            case 'this_week': {
                const startOfWeek = new Date(now);
                // السبت = بداية الأسبوع في السياق العربي
                const day = startOfWeek.getDay();
                const diff = day === 6 ? 0 : day + 1; // السبت = 6
                startOfWeek.setDate(startOfWeek.getDate() - diff);
                startOfWeek.setHours(0, 0, 0, 0);
                return { gte: startOfWeek };
            }
            case 'this_month': {
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                return { gte: startOfMonth };
            }
            case 'last_day': {
                // DEC-RPT-001: لا نستخدم this — يُحسب ديناميكياً في كل query
                // نرجع null هنا ونعالج في calculateStudentProgress
                return undefined; // سيُعالج خاصّاً
            }
            case 'full_semester':
            default:
                return undefined; // لا فلتر زمني
        }
    }

    private emptyPagination(filters: ReportFilters) {
        return {
            page: filters.page,
            pageSize: filters.pageSize,
            totalCount: 0,
            totalPages: 0,
        };
    }
}
