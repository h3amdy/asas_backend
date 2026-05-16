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
    termUuid?: string;
    gradeUuid?: string;
    sectionUuid?: string;
    subjectUuid?: string;
    period: TimePeriod;
    page: number;
    pageSize: number;
}

interface DetailFilters {
    yearUuid?: string;
    termUuid?: string;
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
        const [years, grades, sections, subjects, terms] = await Promise.all([
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
            this.prisma.term.findMany({
                where: { year: { schoolId, isDeleted: false }, isDeleted: false },
                select: {
                    uuid: true,
                    name: true,
                    isCurrent: true,
                    year: { select: { uuid: true } },
                },
                orderBy: { orderIndex: 'asc' },
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
            terms: terms.map(t => ({
                uuid: t.uuid,
                name: t.name,
                isCurrent: t.isCurrent,
                yearUuid: t.year.uuid,
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
        const termId = await this.resolveTermId(yearId, filters.termUuid);
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
        const termId = yearId ? await this.resolveTermId(yearId, filters.termUuid) : null;
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
        const termId = yearId ? await this.resolveTermId(yearId, filters.termUuid) : null;
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
        // ── حل فلتر "آخر يوم" ديناميكياً ──
        let resolvedDateFilter = dateFilter;
        if (dateFilter === '__LAST_DAY__') {
            resolvedDateFilter = await this.resolveLastPublishedDayFilter(
                schoolId, yearId, termId, sectionId, subjectId,
            );
        }

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
        if (resolvedDateFilter) targetWhere.lesson.publishedAt = resolvedDateFilter;

        // DEC-RPT-005: DISTINCT lessonId لتجنب حساب targets مكررة
        const targets = await this.prisma.lessonTarget.groupBy({
            by: ['lessonId'],
            where: targetWhere,
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
    private async resolveTermId(yearId: number, termUuid?: string): Promise<number | null> {
        if (termUuid) {
            const term = await this.prisma.term.findFirst({
                where: { uuid: termUuid, yearId, isDeleted: false },
                select: { id: true },
            });
            return term?.id ?? null;
        }
        // الافتراضي: الفصل الحالي
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
                const day = startOfWeek.getDay(); // 0=Sun, 6=Sat
                const diff = (day + 1) % 7; // السبت(6)→0, الأحد(0)→1, الاثنين(1)→2 ...
                startOfWeek.setDate(startOfWeek.getDate() - diff);
                startOfWeek.setHours(0, 0, 0, 0);
                return { gte: startOfWeek };
            }
            case 'this_month': {
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                return { gte: startOfMonth };
            }
            case 'last_day':
                // يُعالج خاصاً عبر resolveLastPublishedDayFilter
                return '__LAST_DAY__';
            case 'full_semester':
            default:
                return undefined; // لا فلتر زمني
        }
    }

    /**
     * DEC-RPT-004: حساب "آخر يوم" ضمن سياق التقرير الحالي
     * يبحث عن MAX(DATE(publishedAt)) ضمن الفلاتر الحالية
     */
    private async resolveLastPublishedDayFilter(
        schoolId: number,
        yearId: number,
        termId: number,
        sectionId?: number,
        subjectId?: number,
    ): Promise<any> {
        const where: any = {
            schoolId,
            yearId,
            termId,
            status: { in: ['PUBLISHED', 'DELIVERED'] },
            isDeleted: false,
            isActive: true,
        };
        if (subjectId) where.subjectId = subjectId;

        // إذا عندنا section نبحث فقط في الدروس المستهدفة لهذه الشعبة
        if (sectionId) {
            where.targets = { some: { sectionId } };
        }

        const lastLesson = await this.prisma.lesson.findFirst({
            where,
            orderBy: { publishedAt: 'desc' },
            select: { publishedAt: true },
        });

        if (!lastLesson?.publishedAt) return undefined;

        const lastDate = new Date(lastLesson.publishedAt);
        const startOfDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
        const nextDay = new Date(startOfDay);
        nextDay.setDate(nextDay.getDate() + 1);

        return { gte: startOfDay, lt: nextDay };
    }

    private emptyPagination(filters: ReportFilters) {
        return {
            page: filters.page,
            pageSize: filters.pageSize,
            totalCount: 0,
            totalPages: 0,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADM-075: مؤشر الأداء الشامل
    // DEC-PERF-001: performance = (gradePercent / 100) × progressPercent
    // ═══════════════════════════════════════════════════════════════════

    async getComprehensiveReport(schoolId: number, filters: ReportFilters) {
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        if (!yearId) {
            return this.emptyComprehensiveReport(filters);
        }

        const termId = await this.resolveTermId(yearId, filters.termUuid);
        if (!termId) {
            return this.emptyComprehensiveReport(filters);
        }

        // ── جلب الطلاب المسجلين (مع الفلاتر) ──
        const enrollmentWhere: any = {
            isCurrent: true,
            isDeleted: false,
            yearId,
            student: { user: { schoolId, isDeleted: false } },
        };
        if (filters.gradeUuid) enrollmentWhere.grade = { uuid: filters.gradeUuid };
        if (filters.sectionUuid) enrollmentWhere.section = { uuid: filters.sectionUuid };

        const totalCount = await this.prisma.studentEnrollment.count({ where: enrollmentWhere });

        // جلب كل الطلاب (بدون pagination) لحساب الإحصائيات
        const allEnrollments = await this.prisma.studentEnrollment.findMany({
            where: enrollmentWhere,
            include: {
                student: {
                    include: {
                        user: { select: { uuid: true, name: true, avatarMediaAsset: { select: { uuid: true } } } },
                    },
                },
                grade: { select: { uuid: true, displayName: true } },
                section: { select: { uuid: true, name: true } },
            },
            orderBy: { student: { user: { name: 'asc' } } },
        });

        const dateFilter = this.getDateFilter(filters.period);
        const subjectId = filters.subjectUuid
            ? (await this.prisma.subject.findFirst({ where: { uuid: filters.subjectUuid, schoolId } }))?.id
            : undefined;

        // ── حساب الإنجاز + الدرجات + الأداء الشامل لكل طالب ──
        const allStudents = await Promise.all(
            allEnrollments.map(async (enrollment) => {
                const [progress, grades] = await Promise.all([
                    this.calculateStudentProgress(
                        schoolId, enrollment.studentId, enrollment.sectionId,
                        yearId, termId, dateFilter, subjectId,
                    ),
                    this.calculateStudentGrades(
                        schoolId, enrollment.studentId, enrollment.sectionId,
                        yearId, termId, dateFilter, subjectId,
                    ),
                ]);

                // DEC-PERF-001: performance = grade × progress / 100
                const gradePercent = grades.averagePercent ?? 0;
                const progressPercent = progress.progressPercent;
                const performancePercent = Math.round((gradePercent * progressPercent / 100) * 10) / 10;

                return {
                    uuid: enrollment.student.user.uuid,
                    name: enrollment.student.user.name,
                    avatarAssetUuid: enrollment.student.user.avatarMediaAsset?.uuid ?? null,
                    grade: enrollment.grade.displayName,
                    gradeUuid: enrollment.grade.uuid,
                    section: enrollment.section.name,
                    sectionUuid: enrollment.section.uuid,
                    progressPercent,
                    gradePercent: grades.averagePercent,
                    performancePercent,
                    evaluationLabel: this.getEvaluationLabel(performancePercent),
                };
            }),
        );

        // ── Pagination: تُدار محلياً في الواجهة ──
        // الباكند يُعيد كل الطلاب والواجهة تقسمهم على صفحات

        // ── KPIs (من كل الطلاب) ──
        const averageProgress = allStudents.length > 0
            ? Math.round((allStudents.reduce((s, st) => s + st.progressPercent, 0) / allStudents.length) * 10) / 10
            : 0;

        const studentsWithGrades = allStudents.filter(s => s.gradePercent !== null);
        const averageGrade = studentsWithGrades.length > 0
            ? Math.round((studentsWithGrades.reduce((s, st) => s + st.gradePercent!, 0) / studentsWithGrades.length) * 10) / 10
            : null;

        const averagePerformance = allStudents.length > 0
            ? Math.round((allStudents.reduce((s, st) => s + st.performancePercent, 0) / allStudents.length) * 10) / 10
            : 0;

        const weakStudentsCount = allStudents.filter(s => s.performancePercent < 50).length;

        // ── Charts: توزيع التقديرات (من كل الطلاب) ──
        const distributionBuckets = [
            { label: 'ممتاز', min: 90, max: 101, count: 0 },
            { label: 'جيد جداً', min: 80, max: 90, count: 0 },
            { label: 'جيد', min: 70, max: 80, count: 0 },
            { label: 'مقبول', min: 60, max: 70, count: 0 },
            { label: 'ضعيف', min: 0, max: 60, count: 0 },
        ];

        for (const s of allStudents) {
            for (const b of distributionBuckets) {
                if (s.performancePercent >= b.min && s.performancePercent < b.max) {
                    b.count++;
                    break;
                }
            }
        }

        const distribution = distributionBuckets.map(b => ({
            label: b.label,
            count: b.count,
            percent: allStudents.length > 0 ? Math.round((b.count / allStudents.length) * 100) : 0,
        }));

        // ── Charts: أعلى 5 طلاب (من كل الطلاب) ──
        const topStudents = [...allStudents]
            .sort((a, b) => b.performancePercent - a.performancePercent)
            .slice(0, 5)
            .map(s => ({ name: s.name, performancePercent: s.performancePercent }));

        // ── Charts: متوسط الأداء حسب المجموعة (من كل الطلاب) ──
        const groupBySection = !!filters.gradeUuid;
        const groupMap = new Map<string, { progress: number[]; grade: number[]; performance: number[]; label: string }>();

        for (const s of allStudents) {
            const key = groupBySection ? s.sectionUuid : s.gradeUuid;
            const label = groupBySection ? s.section : s.grade;
            if (!groupMap.has(key)) {
                groupMap.set(key, { progress: [], grade: [], performance: [], label });
            }
            const g = groupMap.get(key)!;
            g.progress.push(s.progressPercent);
            g.grade.push(s.gradePercent ?? 0);
            g.performance.push(s.performancePercent);
        }

        const groupChart = Array.from(groupMap.values()).map(g => ({
            label: g.label,
            avgProgress: g.progress.length > 0 ? Math.round(g.progress.reduce((a, b) => a + b, 0) / g.progress.length) : 0,
            avgGrade: g.grade.length > 0 ? Math.round(g.grade.reduce((a, b) => a + b, 0) / g.grade.length) : 0,
            avgPerformance: g.performance.length > 0 ? Math.round(g.performance.reduce((a, b) => a + b, 0) / g.performance.length) : 0,
        }));

        return {
            kpis: {
                totalStudents: totalCount,
                averageProgress,
                averageGrade,
                averagePerformance,
                weakStudentsCount,
            },
            students: allStudents,
            charts: {
                distribution,
                topStudents,
                groupChart,
                groupBySection,
            },
        };
    }

    private getEvaluationLabel(performance: number): string {
        if (performance >= 90) return 'ممتاز';
        if (performance >= 80) return 'جيد جداً';
        if (performance >= 70) return 'جيد';
        if (performance >= 60) return 'مقبول';
        return 'ضعيف';
    }

    private emptyComprehensiveReport(filters: ReportFilters) {
        return {
            kpis: { totalStudents: 0, averageProgress: 0, averageGrade: null, averagePerformance: 0, weakStudentsCount: 0 },
            students: [],
            pagination: this.emptyPagination(filters),
            charts: { distribution: [], topStudents: [], groupChart: [], groupBySection: false },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADM-076a: تفاصيل الأداء الشامل لطالب (كل المواد)
    // ═══════════════════════════════════════════════════════════════════

    async getStudentComprehensiveDetail(
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
        const termId = yearId ? await this.resolveTermId(yearId, filters.termUuid) : null;
        const dateFilter = this.getDateFilter(filters.period);

        // ── المواد المرتبطة بالصف ──
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

        // ── حساب الإنجاز + الدرجات لكل مادة ──
        let totalProgressSum = 0;
        let totalGradeSum = 0;
        let gradedSubjectsCount = 0;
        let overallTotalLessons = 0;
        let overallCompletedLessons = 0;

        const subjectResults = yearId && termId
            ? await Promise.all(
                subjects.map(async (subject) => {
                    const progress = await this.calculateStudentProgress(
                        schoolId, studentUser.student!.userId, enrollment.sectionId,
                        yearId, termId, dateFilter, subject.id,
                    );
                    const grades = await this.calculateStudentGrades(
                        schoolId, studentUser.student!.userId, enrollment.sectionId,
                        yearId, termId, dateFilter, subject.id,
                    );

                    const gradePercent = grades.averagePercent ?? 0;
                    const progressPercent = progress.progressPercent;
                    const performancePercent = Math.round((progressPercent * gradePercent) / 100 * 10) / 10;

                    totalProgressSum += progressPercent;
                    overallTotalLessons += progress.totalLessons;
                    overallCompletedLessons += progress.completedLessons;

                    if (grades.averagePercent !== null) {
                        totalGradeSum += grades.averagePercent;
                        gradedSubjectsCount++;
                    }

                    return {
                        uuid: subject.uuid,
                        name: subject.displayName,
                        coverAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                        progressPercent,
                        totalLessons: progress.totalLessons,
                        completedLessons: progress.completedLessons,
                        gradePercent: grades.averagePercent,
                        performancePercent,
                        evaluationLabel: this.getEvaluationLabel(performancePercent),
                    };
                }),
            )
            : [];

        // ── KPIs الإجمالية ──
        const avgProgress = subjects.length > 0
            ? Math.round((totalProgressSum / subjects.length) * 10) / 10
            : 0;
        const avgGrade = gradedSubjectsCount > 0
            ? Math.round((totalGradeSum / gradedSubjectsCount) * 10) / 10
            : null;
        const avgPerformance = avgGrade !== null
            ? Math.round((avgProgress * avgGrade) / 100 * 10) / 10
            : 0;

        return {
            student: {
                uuid: studentUser.uuid,
                name: studentUser.name,
                avatarAssetUuid: studentUser.avatarMediaAsset?.uuid ?? null,
                grade: enrollment.grade.displayName,
                section: enrollment.section.name,
            },
            overallKpis: {
                performancePercent: avgPerformance,
                gradePercent: avgGrade,
                progressPercent: avgProgress,
                evaluationLabel: this.getEvaluationLabel(avgPerformance),
                totalLessons: overallTotalLessons,
                completedLessons: overallCompletedLessons,
                remainingLessons: overallTotalLessons - overallCompletedLessons,
            },
            subjects: subjectResults,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADM-076b: تفاصيل الأداء الشامل لطالب في مادة (الدروس)
    // ═══════════════════════════════════════════════════════════════════

    async getStudentSubjectComprehensive(
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
            select: { id: true, uuid: true, displayName: true },
        });

        if (!subject) {
            throw new NotFoundException('المادة غير موجودة');
        }

        const enrollment = studentUser.student.enrollments[0];
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        const termId = yearId ? await this.resolveTermId(yearId, filters.termUuid) : null;
        const dateFilter = this.getDateFilter(filters.period);

        // ── ملخص الإنجاز + الدرجات ──
        let summary = { totalLessons: 0, completedLessons: 0, progressPercent: 0 };
        let grades = { averagePercent: null as number | null, earnedPoints: 0, totalPoints: 0, evaluatedLessonsCount: 0 };

        if (yearId && termId) {
            summary = await this.calculateStudentProgress(
                schoolId, studentUser.student.userId, enrollment.sectionId,
                yearId, termId, dateFilter, subject.id,
            );
            grades = await this.calculateStudentGrades(
                schoolId, studentUser.student.userId, enrollment.sectionId,
                yearId, termId, dateFilter, subject.id,
            );
        }

        const gradePercent = grades.averagePercent ?? 0;
        const performancePercent = Math.round((summary.progressPercent * gradePercent) / 100 * 10) / 10;

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
            include: {
                lesson: {
                    include: {
                        template: { select: { title: true } },
                        studentResults: {
                            where: {
                                studentId: studentUser.student.userId,
                                isDeleted: false,
                            },
                            select: { lessonId: true, earnedPoints: true, totalPoints: true, calculatedAt: true },
                            orderBy: { calculatedAt: 'desc' as const },
                            take: 1,
                        },
                    },
                },
            },
        });

        // Sort by publishedAt + remove duplicates
        targets.sort((a, b) => {
            const dateA = a.lesson.publishedAt?.getTime() ?? 0;
            const dateB = b.lesson.publishedAt?.getTime() ?? 0;
            return dateA - dateB;
        });

        const seenLessonIds = new Set<number>();
        const lessons = targets
            .filter(t => {
                if (seenLessonIds.has(t.lessonId)) return false;
                seenLessonIds.add(t.lessonId);
                return true;
            })
            .map(t => {
                const result = t.lesson.studentResults[0];
                const isCompleted = !!result;
                const scorePercent = isCompleted && result.totalPoints > 0
                    ? Math.round((result.earnedPoints / result.totalPoints) * 1000) / 10
                    : null;

                return {
                    uuid: t.lesson.uuid,
                    title: t.lesson.template.title,
                    status: isCompleted ? 'completed' : 'pending',
                    scorePercent,
                    publishedAt: t.lesson.publishedAt,
                };
            });

        return {
            student: {
                uuid: studentUser.uuid,
                name: studentUser.name,
                avatarAssetUuid: studentUser.avatarMediaAsset?.uuid ?? null,
                grade: enrollment.grade.displayName,
                section: enrollment.section.name,
            },
            subjectKpis: {
                subjectName: subject.displayName,
                performancePercent,
                gradePercent: grades.averagePercent,
                progressPercent: summary.progressPercent,
                evaluationLabel: this.getEvaluationLabel(performancePercent),
                totalLessons: summary.totalLessons,
                completedLessons: summary.completedLessons,
                remainingLessons: summary.totalLessons - summary.completedLessons,
            },
            lessons,
        };
    }

    // ═══════════════════════════════════════════════════════════════════

    // ── Endpoint: تقرير درجات الطلاب (ADM-074a) ──

    async getStudentGradesReport(schoolId: number, filters: ReportFilters) {
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        if (!yearId) {
            return { summary: { totalStudents: 0, averageGrade: null, weakStudentsCount: 0 }, students: [], pagination: this.emptyPagination(filters) };
        }

        const termId = await this.resolveTermId(yearId, filters.termUuid);
        if (!termId) {
            return { summary: { totalStudents: 0, averageGrade: null, weakStudentsCount: 0 }, students: [], pagination: this.emptyPagination(filters) };
        }

        // ── جلب الطلاب المسجلين ──
        const enrollmentWhere: any = {
            isCurrent: true,
            isDeleted: false,
            yearId,
            student: { user: { schoolId, isDeleted: false } },
        };
        if (filters.gradeUuid) enrollmentWhere.grade = { uuid: filters.gradeUuid };
        if (filters.sectionUuid) enrollmentWhere.section = { uuid: filters.sectionUuid };

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

        const dateFilter = this.getDateFilter(filters.period);
        const subjectId = filters.subjectUuid
            ? (await this.prisma.subject.findFirst({ where: { uuid: filters.subjectUuid, schoolId } }))?.id
            : undefined;

        const students = await Promise.all(
            enrollments.map(async (enrollment) => {
                const grades = await this.calculateStudentGrades(
                    schoolId, enrollment.studentId, enrollment.sectionId,
                    yearId, termId, dateFilter, subjectId,
                );
                return {
                    uuid: enrollment.student.user.uuid,
                    name: enrollment.student.user.name,
                    avatarAssetUuid: enrollment.student.user.avatarMediaAsset?.uuid ?? null,
                    grade: enrollment.grade.displayName,
                    section: enrollment.section.name,
                    ...grades,
                };
            }),
        );

        // ── الملخص ──
        const studentsWithGrades = students.filter(s => s.averagePercent !== null);
        const averageGrade = studentsWithGrades.length > 0
            ? Math.round((studentsWithGrades.reduce((sum, s) => sum + s.averagePercent!, 0) / studentsWithGrades.length) * 10) / 10
            : null;
        const weakStudentsCount = studentsWithGrades.filter(s => s.averagePercent! < 50).length;

        return {
            summary: { totalStudents: totalCount, averageGrade, weakStudentsCount },
            students,
            pagination: {
                page: filters.page,
                pageSize: filters.pageSize,
                totalCount,
                totalPages: Math.ceil(totalCount / filters.pageSize),
            },
        };
    }

    // ── Endpoint: تفاصيل درجات طالب (ADM-074b) ──

    async getStudentGradesDetail(
        schoolId: number,
        studentUuid: string,
        filters: DetailFilters,
    ) {
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
        const termId = yearId ? await this.resolveTermId(yearId, filters.termUuid) : null;
        const dateFilter = this.getDateFilter(filters.period);

        // ── ملخص الدرجات العام ──
        let overallGrades = { averagePercent: null as number | null, earnedPoints: 0, totalPoints: 0, evaluatedLessonsCount: 0 };
        if (yearId && termId) {
            overallGrades = await this.calculateStudentGrades(
                schoolId, studentUser.student.userId, enrollment.sectionId,
                yearId, termId, dateFilter,
            );
        }

        // ── الدرجات حسب المواد ──
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

        const subjectGrades = yearId && termId
            ? await Promise.all(
                subjects.map(async (subject) => {
                    const grades = await this.calculateStudentGrades(
                        schoolId, studentUser.student!.userId, enrollment.sectionId,
                        yearId, termId, dateFilter, subject.id,
                    );
                    return {
                        uuid: subject.uuid,
                        name: subject.displayName,
                        coverAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                        ...grades,
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
            summary: {
                averagePercent: overallGrades.averagePercent,
                totalSubjects: subjects.length,
                evaluatedLessonsCount: overallGrades.evaluatedLessonsCount,
                earnedPoints: overallGrades.earnedPoints,
                totalPoints: overallGrades.totalPoints,
            },
            subjects: subjectGrades,
        };
    }

    // ── Endpoint: درجات طالب في مادة (ADM-074c) ──

    async getStudentSubjectGrades(
        schoolId: number,
        studentUuid: string,
        subjectUuid: string,
        filters: DetailFilters,
    ) {
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

        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
            select: { id: true, uuid: true, displayName: true, coverMediaAsset: { select: { uuid: true } } },
        });

        if (!subject) {
            throw new NotFoundException('المادة غير موجودة');
        }

        const enrollment = studentUser.student.enrollments[0];
        const yearId = await this.resolveYearId(schoolId, filters.yearUuid);
        const termId = yearId ? await this.resolveTermId(yearId, filters.termUuid) : null;
        const dateFilter = this.getDateFilter(filters.period);

        // ── ملخص الدرجات في المادة ──
        let summary = { averagePercent: null as number | null, earnedPoints: 0, totalPoints: 0, evaluatedLessonsCount: 0 };
        if (yearId && termId) {
            summary = await this.calculateStudentGrades(
                schoolId, studentUser.student.userId, enrollment.sectionId,
                yearId, termId, dateFilter, subject.id,
            );
        }

        // ── قائمة الدروس المنجزة مع درجاتها ──
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

        // ── حل فلتر الفترة ──
        let resolvedDateFilter = dateFilter;
        if (dateFilter === '__LAST_DAY__' && yearId && termId) {
            resolvedDateFilter = await this.resolveLastPublishedDayFilter(
                schoolId, yearId, termId, enrollment.sectionId, subject.id,
            );
        }
        if (resolvedDateFilter && resolvedDateFilter !== '__LAST_DAY__') {
            lessonTargetWhere.lesson.publishedAt = resolvedDateFilter;
        }

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

        // ── Deduplicate by lessonId ──
        const seenLessonIds = new Set<number>();
        const uniqueTargets = targets.filter(t => {
            if (seenLessonIds.has(t.lessonId)) return false;
            seenLessonIds.add(t.lessonId);
            return true;
        });

        // ── جلب نتائج الطالب لهذه الدروس (آخر محاولة لكل درس) ──
        const lessonIds = uniqueTargets.map(t => t.lessonId);
        const results = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId: studentUser.student!.userId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            orderBy: { calculatedAt: 'desc' },
        });

        // DEC-GRD-003: آخر محاولة لكل درس
        const resultMap = new Map<number, typeof results[0]>();
        for (const r of results) {
            if (!resultMap.has(r.lessonId)) {
                resultMap.set(r.lessonId, r);
            }
        }

        const lessons = uniqueTargets.map(t => {
            const result = resultMap.get(t.lessonId);
            return {
                uuid: t.lesson.uuid,
                title: t.lesson.template.title,
                publishedAt: t.lesson.publishedAt,
                isCompleted: !!result,
                completedAt: result?.calculatedAt ?? null,
                totalQuestions: result?.totalQuestions ?? null,
                correctQuestions: result?.correctQuestions ?? null,
                earnedPoints: result?.earnedPoints ?? null,
                totalPoints: result?.totalPoints ?? null,
                percent: result ? Math.round(result.percent) : null,
                hasReview: !!result,
            };
        });

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
    // Helper: حساب درجات طالب (weighted points aggregation)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * DEC-GRD-001: المتوسط من الدروس المنجزة فقط
     * DEC-GRD-002: غير المنجزة لا تدخل بصفر
     * DEC-GRD-003: آخر محاولة (ORDER BY calculatedAt DESC)
     * DEC-GRD-008: weighted points — SUM(earned) / SUM(total)
     */
    private async calculateStudentGrades(
        schoolId: number,
        studentId: number,
        sectionId: number,
        yearId: number,
        termId: number,
        dateFilter: any,
        subjectId?: number,
    ) {
        // ── حل فلتر "آخر يوم" ──
        let resolvedDateFilter = dateFilter;
        if (dateFilter === '__LAST_DAY__') {
            resolvedDateFilter = await this.resolveLastPublishedDayFilter(
                schoolId, yearId, termId, sectionId, subjectId,
            );
        }

        // ── الدروس المستهدفة ──
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
        if (resolvedDateFilter) targetWhere.lesson.publishedAt = resolvedDateFilter;

        const targets = await this.prisma.lessonTarget.groupBy({
            by: ['lessonId'],
            where: targetWhere,
        });

        if (targets.length === 0) {
            return { averagePercent: null, earnedPoints: 0, totalPoints: 0, evaluatedLessonsCount: 0 };
        }

        const lessonIds = targets.map(t => t.lessonId);

        // ── نتائج الطالب ──
        const results = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            select: { lessonId: true, earnedPoints: true, totalPoints: true, calculatedAt: true },
            orderBy: { calculatedAt: 'desc' },
        });

        // DEC-GRD-003: آخر محاولة لكل درس
        const lastResultPerLesson = new Map<number, { earnedPoints: number; totalPoints: number }>();
        for (const r of results) {
            if (!lastResultPerLesson.has(r.lessonId)) {
                lastResultPerLesson.set(r.lessonId, { earnedPoints: r.earnedPoints, totalPoints: r.totalPoints });
            }
        }

        if (lastResultPerLesson.size === 0) {
            return { averagePercent: null, earnedPoints: 0, totalPoints: 0, evaluatedLessonsCount: 0 };
        }

        // DEC-GRD-008: weighted — SUM(earned) / SUM(total)
        let totalEarned = 0;
        let totalMax = 0;
        for (const [, r] of lastResultPerLesson) {
            totalEarned += r.earnedPoints;
            totalMax += r.totalPoints;
        }

        const averagePercent = totalMax > 0
            ? Math.round((totalEarned / totalMax) * 1000) / 10
            : null;

        return {
            averagePercent,
            earnedPoints: Math.round(totalEarned * 10) / 10,
            totalPoints: Math.round(totalMax * 10) / 10,
            evaluatedLessonsCount: lastResultPerLesson.size,
        };
    }
}
