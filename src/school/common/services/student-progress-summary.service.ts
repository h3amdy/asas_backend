// src/school/common/services/student-progress-summary.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 📊 خدمة مشتركة لحساب ملخص إنجاز الطالب
 *
 * تُستخدم من:
 *   - PAR-010: قائمة أبناء ولي الأمر
 *   - STD-011: ملخص الطالب (مستقبلاً)
 *   - التقارير + Dashboard المدير (مستقبلاً)
 *
 * DEC-PAR-010-10: خدمة مشتركة بدلاً من تكرار المنطق في كل domain
 * DEC-PAR-010-02: يعتمد على StudentLessonResult (source of truth)
 * DEC-PAR-010-11: حماية النسبة بـ Math.min(completed, total)
 * DEC-ACADEMIC-CONTEXT-005: Resolved Academic Context مع fallback
 */

export interface ProgressSummary {
    totalLessons: number;
    completedLessons: number;
    progressPercent: number;
    /** اسم الفصل المستخدم — لعرضه في UI إذا كان fallback */
    termName: string | null;
    /** هل الفصل هو الحالي أم fallback؟ */
    isFallbackTerm: boolean;
}

export interface ProgressOptions {
    /** تحديد سنة معيّنة (للتقارير/المدير) — إذا لم يُحدد يُستخدم Resolved Context */
    yearId?: number;
    /** تحديد فصل معيّن (للتقارير/المدير) — إذا لم يُحدد يُستخدم Resolved Context */
    termId?: number;
}

@Injectable()
export class StudentProgressSummaryService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * حساب ملخص إنجاز طالب واحد
     *
     * السلوك الافتراضي (DEC-ACADEMIC-CONTEXT-005):
     * 1. الفصل الحالي النشط (isCurrent=true)
     * 2. آخر فصل يحتوي دروس منشورة (fallback)
     * 3. لا يوجد سياق أكاديمي → أصفار
     *
     * للتقارير/المدير: يمكن تمرير yearId/termId لتحديد فصل معيّن
     *
     * @param schoolId - معرّف المدرسة
     * @param studentId - معرّف الطالب (userId)
     * @param sectionId - معرّف الشعبة (من enrollment)
     * @param options - اختياري: تحديد سنة/فصل معيّن
     */
    async getStudentProgressSummary(
        schoolId: number,
        studentId: number,
        sectionId: number,
        options?: ProgressOptions,
    ): Promise<ProgressSummary> {
        const EMPTY: ProgressSummary = {
            totalLessons: 0,
            completedLessons: 0,
            progressPercent: 0,
            termName: null,
            isFallbackTerm: false,
        };

        // ── تحديد السياق الأكاديمي ──
        const context = options?.yearId && options?.termId
            ? await this.getExplicitContext(options.yearId, options.termId)
            : await this.resolveAcademicContext(schoolId);

        if (!context) return EMPTY;

        // ── الدروس المستهدفة لشعبة الطالب (ضمن السياق المحدد) ──
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
            select: { lessonId: true },
        });

        const totalLessons = targets.length;
        if (totalLessons === 0) return { ...EMPTY, termName: context.termName, isFallbackTerm: context.isFallback };

        // ── الدروس المنجزة (distinct lessonId من StudentLessonResult) ──
        const lessonIds = targets.map(t => t.lessonId);
        const completedResults = await this.prisma.studentLessonResult.groupBy({
            by: ['lessonId'],
            where: {
                studentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
        });

        // ── حماية: لا تتجاوز النسبة 100% (DEC-PAR-010-11) ──
        const completedLessons = Math.min(completedResults.length, totalLessons);
        const progressPercent = Math.round((completedLessons / totalLessons) * 1000) / 10;

        return {
            totalLessons,
            completedLessons,
            progressPercent,
            termName: context.termName,
            isFallbackTerm: context.isFallback,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Academic Context Resolution (DEC-ACADEMIC-CONTEXT-005)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * حل السياق الأكاديمي تلقائياً:
     * 1️⃣ الفصل الحالي النشط
     * 2️⃣ آخر فصل يحتوي دروس (fallback للإجازات/الفترات الانتقالية)
     *
     * ⚠️ public لإعادة الاستخدام من ParentChildrenService (PAR-021)
     */
    async resolveAcademicContext(
        schoolId: number,
    ): Promise<{ yearId: number; termId: number; termName: string; isFallback: boolean } | null> {
        // 1️⃣ محاولة: الفصل الحالي النشط
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
        });

        if (currentYear) {
            const currentTerm = await this.prisma.term.findFirst({
                where: { yearId: currentYear.id, isCurrent: true, isDeleted: false },
            });

            if (currentTerm) {
                return {
                    yearId: currentYear.id,
                    termId: currentTerm.id,
                    termName: currentTerm.name,
                    isFallback: false,
                };
            }
        }

        // 2️⃣ Fallback: آخر فصل يحتوي دروس منشورة في هذه المدرسة
        const latestLesson = await this.prisma.lesson.findFirst({
            where: {
                schoolId,
                status: { in: ['PUBLISHED', 'DELIVERED'] },
                isDeleted: false,
                isActive: true,
            },
            orderBy: { createdAt: 'desc' },
            select: {
                yearId: true,
                termId: true,
                term: { select: { name: true } },
            },
        });

        if (latestLesson) {
            return {
                yearId: latestLesson.yearId,
                termId: latestLesson.termId,
                termName: latestLesson.term.name,
                isFallback: true,
            };
        }

        // 3️⃣ لا يوجد سياق أكاديمي
        return null;
    }

    /**
     * سياق صريح (للتقارير/المدير) — بدون fallback
     */
    private async getExplicitContext(
        yearId: number,
        termId: number,
    ): Promise<{ yearId: number; termId: number; termName: string; isFallback: boolean } | null> {
        const term = await this.prisma.term.findFirst({
            where: { id: termId, yearId, isDeleted: false },
            select: { name: true },
        });
        if (!term) return null;
        return { yearId, termId, termName: term.name, isFallback: false };
    }
}
