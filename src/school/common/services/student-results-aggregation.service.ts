// src/school/common/services/student-results-aggregation.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StudentProgressSummaryService } from './student-progress-summary.service';

/**
 * 📊 خدمة تجميع النتائج الأكاديمية (مستقلة)
 *
 * تُستخدم من:
 *   - PAR-030/031: نتائج ابن (ولي الأمر)
 *   - PAR-032: نتائج دروس مادة (ولي الأمر)
 *   - التقارير / Admin Reports (مستقبلاً)
 *
 * القرارات المعمارية (chat_3.md):
 *   DEC-RESULTS-02: مصدر الحقيقة = StudentLessonResult فقط
 *   DEC-RESULTS-03: المعدل العام = average(subjectScorePercent) — غير مرجّح
 *   DEC-RESULTS-04: نتيجة المادة = average(lessonResultPercent)
 *   DEC-RESULTS-05: آخر محاولة فقط (Latest Attempt)
 *   DEC-RESULTS-06: نطاق = السنة + الفصل الحالي (مع fallback)
 *   DEC-RESULTS-07: PAR-032 يعرض فقط الدروس التي لها نتائج فعلية
 */

// ══════════════════════════════════════════════════════
//  Interfaces
// ══════════════════════════════════════════════════════

export interface SubjectResultSummary {
    subjectId: number;
    subjectUuid: string;
    displayName: string;
    shortName: string | null;
    coverMediaAssetUuid: string | null;
    scorePercent: number;
    gradeLabel: string;
    lessonsWithResults: number;
    totalLessonsAvailable: number;
}

export interface ChildResultsOverview {
    overallScorePercent: number;
    overallGradeLabel: string;
    subjectCount: number;
    termName: string | null;
    isFallbackTerm: boolean;
    subjects: SubjectResultSummary[];
}

export interface LessonResultDetail {
    lessonUuid: string;
    title: string;
    scorePercent: number;
    gradeLabel: string;
    questionCount: number;
    correctCount: number;
    attemptCount: number;
    completedAt: Date;
}

export interface SubjectResultsDetail {
    subjectName: string;
    subjectUuid: string;
    subjectScorePercent: number;
    subjectGradeLabel: string;
    termName: string | null;
    isFallbackTerm: boolean;
    lessons: LessonResultDetail[];
}

@Injectable()
export class StudentResultsAggregationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly progressService: StudentProgressSummaryService,
    ) { }

    // ══════════════════════════════════════════════════════
    //  PAR-030 + PAR-031: نتائج ابن (ملخص عام + مواد)
    // ══════════════════════════════════════════════════════

    /**
     * تجميع نتائج طالب عبر جميع مواده
     *
     * @param schoolId - معرف المدرسة
     * @param studentId - معرف الطالب (userId)
     * @param sectionId - معرف الشعبة
     */
    async aggregateChildResults(
        schoolId: number,
        studentId: number,
        sectionId: number,
    ): Promise<ChildResultsOverview> {
        // 1. حل السياق الأكاديمي
        const context = await this.progressService.resolveAcademicContext(schoolId);

        const EMPTY: ChildResultsOverview = {
            overallScorePercent: 0,
            overallGradeLabel: '',
            subjectCount: 0,
            termName: context?.termName ?? null,
            isFallbackTerm: context?.isFallback ?? false,
            subjects: [],
        };

        if (!context) return EMPTY;

        // 2. جلب كل الدروس المستهدفة لشعبة الطالب
        const targets = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId,
                lesson: {
                    schoolId,
                    yearId: context.yearId,
                    termId: context.termId,
                    status: { in: ['PUBLISHED', 'DELIVERED'] },
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                lesson: {
                    select: {
                        id: true,
                        uuid: true,
                        subjectId: true,
                        subject: {
                            select: {
                                id: true,
                                uuid: true,
                                displayName: true,
                                shortName: true,
                                coverMediaAsset: { select: { uuid: true } },
                            },
                        },
                    },
                },
            },
        });

        if (targets.length === 0) return { ...EMPTY, termName: context.termName, isFallbackTerm: context.isFallback };

        // 3. جلب كل نتائج الطالب (DEC-RESULTS-02: StudentLessonResult فقط)
        const lessonIds = targets.map(t => t.lesson.id);
        const allResults = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            orderBy: { createdAt: 'desc' }, // DEC-RESULTS-05: Latest first
            select: {
                lessonId: true,
                percent: true,
                gradeLabel: true,
                createdAt: true,
            },
        });

        // 4. DEC-RESULTS-05: آخر محاولة فقط لكل درس
        const latestByLesson = new Map<number, {
            percent: number;
            gradeLabel: string;
            attemptCount: number;
            completedAt: Date;
        }>();
        const attemptCounts = new Map<number, number>();

        for (const r of allResults) {
            attemptCounts.set(r.lessonId, (attemptCounts.get(r.lessonId) ?? 0) + 1);
            if (!latestByLesson.has(r.lessonId)) {
                // أول ظهور = آخر محاولة (مرتب DESC)
                latestByLesson.set(r.lessonId, {
                    percent: r.percent,
                    gradeLabel: r.gradeLabel,
                    attemptCount: 0, // سيُحدّث لاحقاً
                    completedAt: r.createdAt,
                });
            }
        }
        for (const [lessonId, count] of attemptCounts) {
            const entry = latestByLesson.get(lessonId);
            if (entry) entry.attemptCount = count;
        }

        // 5. تجميع حسب المادة
        const subjectMap = new Map<number, {
            subject: typeof targets[0]['lesson']['subject'];
            totalAvailable: number;
            lessonPercents: number[];
        }>();

        for (const t of targets) {
            const subjectId = t.lesson.subjectId;
            if (!subjectMap.has(subjectId)) {
                subjectMap.set(subjectId, {
                    subject: t.lesson.subject,
                    totalAvailable: 0,
                    lessonPercents: [],
                });
            }
            const entry = subjectMap.get(subjectId)!;
            entry.totalAvailable++;

            const result = latestByLesson.get(t.lesson.id);
            if (result) {
                entry.lessonPercents.push(result.percent);
            }
        }

        // 6. بناء النتائج
        const subjects: SubjectResultSummary[] = [];

        for (const [, entry] of subjectMap) {
            if (entry.lessonPercents.length === 0) continue; // DEC-RESULTS-07: مواد بدون نتائج لا تظهر

            // DEC-RESULTS-04: نتيجة المادة = average(lessonPercents)
            const scorePercent = Math.round(
                (entry.lessonPercents.reduce((a, b) => a + b, 0) / entry.lessonPercents.length) * 10,
            ) / 10;

            subjects.push({
                subjectId: entry.subject.id,
                subjectUuid: entry.subject.uuid,
                displayName: entry.subject.displayName,
                shortName: entry.subject.shortName,
                coverMediaAssetUuid: entry.subject.coverMediaAsset?.uuid ?? null,
                scorePercent,
                gradeLabel: this.computeGradeLabel(scorePercent),
                lessonsWithResults: entry.lessonPercents.length,
                totalLessonsAvailable: entry.totalAvailable,
            });
        }

        // ترتيب أبجدي
        subjects.sort((a, b) => a.displayName.localeCompare(b.displayName));

        // 7. DEC-RESULTS-03: المعدل العام = average(subjectScorePercent)
        const overallScorePercent = subjects.length > 0
            ? Math.round(
                (subjects.reduce((sum, s) => sum + s.scorePercent, 0) / subjects.length) * 10,
            ) / 10
            : 0;

        return {
            overallScorePercent,
            overallGradeLabel: this.computeGradeLabel(overallScorePercent),
            subjectCount: subjects.length,
            termName: context.termName,
            isFallbackTerm: context.isFallback,
            subjects,
        };
    }

    // ══════════════════════════════════════════════════════
    //  PAR-032: نتائج دروس مادة معيّنة
    // ══════════════════════════════════════════════════════

    /**
     * تجميع نتائج طالب في مادة واحدة
     */
    async aggregateSubjectResults(
        schoolId: number,
        studentId: number,
        sectionId: number,
        subjectId: number,
    ): Promise<SubjectResultsDetail | null> {
        // 1. حل السياق الأكاديمي
        const context = await this.progressService.resolveAcademicContext(schoolId);
        if (!context) return null;

        // 2. جلب المادة
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
            select: { uuid: true, displayName: true },
        });
        if (!subject) return null;

        // 3. جلب دروس المادة المستهدفة
        const targets = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId,
                lesson: {
                    schoolId,
                    subjectId,
                    yearId: context.yearId,
                    termId: context.termId,
                    status: { in: ['PUBLISHED', 'DELIVERED'] },
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                lesson: {
                    select: {
                        id: true,
                        uuid: true,
                        template: {
                            select: {
                                title: true,
                                orderIndex: true,
                            },
                        },
                    },
                },
            },
        });

        if (targets.length === 0) {
            return {
                subjectName: subject.displayName,
                subjectUuid: subject.uuid,
                subjectScorePercent: 0,
                subjectGradeLabel: '',
                termName: context.termName,
                isFallbackTerm: context.isFallback,
                lessons: [],
            };
        }

        // 4. جلب كل نتائج الطالب لدروس هذه المادة
        const lessonIds = targets.map(t => t.lesson.id);
        const allResults = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            orderBy: { createdAt: 'desc' },
            select: {
                lessonId: true,
                percent: true,
                gradeLabel: true,
                totalQuestions: true,
                correctQuestions: true,
                createdAt: true,
            },
        });

        // 5. آخر محاولة لكل درس + عدد المحاولات
        const latestByLesson = new Map<number, {
            percent: number;
            gradeLabel: string;
            totalQuestions: number;
            correctQuestions: number;
            completedAt: Date;
            attemptCount: number;
        }>();
        const attemptCounts = new Map<number, number>();

        for (const r of allResults) {
            attemptCounts.set(r.lessonId, (attemptCounts.get(r.lessonId) ?? 0) + 1);
            if (!latestByLesson.has(r.lessonId)) {
                latestByLesson.set(r.lessonId, {
                    percent: r.percent,
                    gradeLabel: r.gradeLabel,
                    totalQuestions: r.totalQuestions,
                    correctQuestions: r.correctQuestions,
                    completedAt: r.createdAt,
                    attemptCount: 0,
                });
            }
        }
        for (const [lessonId, count] of attemptCounts) {
            const entry = latestByLesson.get(lessonId);
            if (entry) entry.attemptCount = count;
        }

        // 6. بناء قائمة الدروس (DEC-RESULTS-07: فقط التي لها نتائج)
        // ترتيب حسب curriculum order
        const lessonUuidMap = new Map<number, { uuid: string; title: string; orderIndex: number }>();
        for (const t of targets) {
            lessonUuidMap.set(t.lesson.id, {
                uuid: t.lesson.uuid,
                title: t.lesson.template.title,
                orderIndex: t.lesson.template.orderIndex,
            });
        }

        const lessons: LessonResultDetail[] = [];
        for (const [lessonId, result] of latestByLesson) {
            const info = lessonUuidMap.get(lessonId);
            if (!info) continue;

            lessons.push({
                lessonUuid: info.uuid,
                title: info.title,
                scorePercent: Math.round(result.percent * 10) / 10,
                gradeLabel: result.gradeLabel,
                questionCount: result.totalQuestions,
                correctCount: result.correctQuestions,
                attemptCount: result.attemptCount,
                completedAt: result.completedAt,
            });
        }

        // ترتيب حسب curriculum order
        lessons.sort((a, b) => {
            const aOrder = lessonUuidMap.get([...latestByLesson.entries()].find(([, v]) => v.completedAt === a.completedAt)?.[0] ?? 0)?.orderIndex ?? 0;
            const bOrder = lessonUuidMap.get([...latestByLesson.entries()].find(([, v]) => v.completedAt === b.completedAt)?.[0] ?? 0)?.orderIndex ?? 0;
            return aOrder - bOrder;
        });

        // 7. نتيجة المادة الإجمالية
        const subjectScorePercent = lessons.length > 0
            ? Math.round(
                (lessons.reduce((sum, l) => sum + l.scorePercent, 0) / lessons.length) * 10,
            ) / 10
            : 0;

        return {
            subjectName: subject.displayName,
            subjectUuid: subject.uuid,
            subjectScorePercent,
            subjectGradeLabel: this.computeGradeLabel(subjectScorePercent),
            termName: context.termName,
            isFallbackTerm: context.isFallback,
            lessons,
        };
    }

    // ══════════════════════════════════════════════════════
    //  Helpers
    // ══════════════════════════════════════════════════════

    /**
     * حساب التقدير من النسبة المئوية
     *
     * يمكن تخصيصها لاحقاً حسب المدرسة
     */
    private computeGradeLabel(percent: number): string {
        if (percent >= 90) return 'ممتاز';
        if (percent >= 80) return 'جيد جداً';
        if (percent >= 70) return 'جيد';
        if (percent >= 60) return 'مقبول';
        return 'ضعيف';
    }
}
