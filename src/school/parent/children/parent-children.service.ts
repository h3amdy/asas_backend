// src/school/parent/children/parent-children.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StudentProgressSummaryService } from '../../common/services/student-progress-summary.service';
import { StudentResultsAggregationService } from '../../common/services/student-results-aggregation.service';

/**
 * 👨‍👧‍👦 خدمة أبناء ولي الأمر
 *
 * SRS-PAR-010: قائمة الأبناء مع ملخص الإنجاز
 * SRS-PAR-021: مواد ابن معيّن مع الإنجاز
 * المرجع: doc/srs/parent/SRS-PAR-010-children-list.md
 *          doc/srs/parent/SRS-PAR-020-child-detail.md
 */
@Injectable()
export class ParentChildrenService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly progressService: StudentProgressSummaryService,
        private readonly resultsService: StudentResultsAggregationService,
    ) { }

    /**
     * GET /school/parent/my-children
     * جلب قائمة الأبناء المرتبطين بحساب ولي الأمر مع ملخص الإنجاز
     *
     * السلسلة:
     * Parent → ParentStudent → Student → User + Enrollment(isCurrent)
     *   → StudentProgressSummaryService (الفصل الحالي)
     */
    async getMyChildren(schoolId: number, parentUserUuid: string) {
        // 1. جلب Parent من UUID المستخدم
        const user = await this.prisma.user.findFirst({
            where: {
                uuid: parentUserUuid,
                schoolId,
                userType: 'PARENT',
                isDeleted: false,
            },
            include: { parent: { select: { userId: true } } },
        });

        if (!user || !user.parent) {
            throw new ForbiddenException('USER_IS_NOT_PARENT');
        }

        const parentId = user.parent.userId;

        // 2. جلب الأبناء المرتبطين (مع بيانات القيد) — batch query
        const childLinks = await this.prisma.parentStudent.findMany({
            where: { parentId, isDeleted: false },
            include: {
                student: {
                    include: {
                        user: {
                            select: {
                                uuid: true,
                                name: true,
                                isActive: true,
                                isDeleted: true,
                            },
                        },
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                            include: {
                                grade: { select: { displayName: true } },
                                section: { select: { name: true } },
                            },
                            take: 1,
                        },
                    },
                },
            },
        });

        // 3. فلترة: إخفاء الطلاب المحذوفين
        const validLinks = childLinks.filter(
            link => !link.student.user.isDeleted,
        );

        // 4. حساب الإنجاز لكل ابن (عبر StudentProgressSummaryService)
        const result = await Promise.all(
            validLinks.map(async (link) => {
                const student = link.student;
                const enrollment = student.enrollments[0] ?? null;

                const progress = enrollment
                    ? await this.progressService.getStudentProgressSummary(
                        schoolId,
                        student.userId,
                        enrollment.sectionId,
                    )
                    : { totalLessons: 0, completedLessons: 0, progressPercent: 0, termName: null, isFallbackTerm: false };

                return {
                    uuid: student.user.uuid,
                    name: student.user.name,
                    isActive: student.user.isActive,
                    enrollment: enrollment
                        ? {
                            gradeName: enrollment.grade.displayName,
                            sectionName: enrollment.section.name,
                            status: enrollment.status,
                        }
                        : null,
                    progress,
                };
            }),
        );

        // 5. ترتيب حسب الاسم
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    // ═══════════════════════════════════════════════════════════════════
    // PAR-021 — مواد ابن معيّن مع الإنجاز
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /school/parent/child/:uuid/subjects
     * جلب المواد المرتبطة بابن معيّن مع إنجاز كل مادة
     *
     * السلسلة:
     * Parent → ParentStudent(childUuid) → Student → Enrollment(isCurrent) → sectionId
     *   → SubjectSection → Subject (displayName, coverMediaAsset)
     *   → LessonTarget → Lesson (PUBLISHED|DELIVERED, yearId, termId)
     *   → StudentLessonResult ← المنجزة
     */
    async getChildSubjects(
        schoolId: number,
        parentUserUuid: string,
        childUuid: string,
    ) {
        // 1. التحقق: ولي الأمر + ارتباط الابن
        const { childName, childStudentId, enrollment } =
            await this.verifyParentChildLink(schoolId, parentUserUuid, childUuid);

        if (!enrollment) {
            return {
                childName,
                gradeName: null,
                sectionName: null,
                termName: null,
                isFallbackTerm: false,
                subjects: [],
            };
        }

        // 2. حل السياق الأكاديمي (DEC-ACADEMIC-CONTEXT-005)
        const context = await this.progressService.resolveAcademicContext(schoolId);

        const termName = context?.termName ?? null;
        const isFallbackTerm = context?.isFallback ?? false;

        if (!context) {
            return {
                childName,
                gradeName: enrollment.grade.displayName,
                sectionName: enrollment.section.name,
                termName: null,
                isFallbackTerm: false,
                subjects: [],
            };
        }

        // 3. جلب المواد المرتبطة بالشعبة
        const subjectSections = await this.prisma.subjectSection.findMany({
            where: {
                sectionId: enrollment.sectionId,
                isDeleted: false,
                isActive: true,
                subject: {
                    schoolId,
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                subject: {
                    include: {
                        coverMediaAsset: { select: { uuid: true } },
                    },
                },
            },
        });

        // 4. جلب الدروس المستهدفة للشعبة ضمن السياق الأكاديمي
        const targets = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId: enrollment.sectionId,
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
                    select: { id: true, subjectId: true },
                },
            },
        });

        // 5. جلب الدروس المنجزة للطالب
        const completedResults = await this.prisma.studentLessonResult.findMany({
            where: { studentId: childStudentId, isDeleted: false },
            select: { lessonId: true },
        });
        const completedLessonIds = new Set(completedResults.map(r => r.lessonId));

        // 6. تجميع الإحصائيات حسب subjectId
        const statsMap = new Map<number, { total: number; completed: number; hasNew: boolean }>();

        for (const target of targets) {
            const subjectId = target.lesson.subjectId;
            if (!statsMap.has(subjectId)) {
                statsMap.set(subjectId, { total: 0, completed: 0, hasNew: false });
            }
            const stats = statsMap.get(subjectId)!;
            stats.total++;
            if (completedLessonIds.has(target.lessonId)) {
                stats.completed++;
            } else {
                stats.hasNew = true;
            }
        }

        // 7. تجميع الرد بدون تكرار
        const seen = new Set<string>();
        const subjects: {
            uuid: string;
            displayName: string;
            shortName: string | null;
            coverMediaAssetUuid: string | null;
            totalLessons: number;
            completedLessons: number;
            progressPercent: number;
            hasNewLessons: boolean;
        }[] = [];

        for (const ss of subjectSections) {
            const subject = ss.subject;
            if (!seen.has(subject.uuid)) {
                seen.add(subject.uuid);
                const stats = statsMap.get(subject.id) || { total: 0, completed: 0, hasNew: false };
                const completed = Math.min(stats.completed, stats.total);
                const percent = stats.total > 0
                    ? Math.round((completed / stats.total) * 1000) / 10
                    : 0;

                subjects.push({
                    uuid: subject.uuid,
                    displayName: subject.displayName,
                    shortName: subject.shortName,
                    coverMediaAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                    totalLessons: stats.total,
                    completedLessons: completed,
                    progressPercent: percent,
                    hasNewLessons: stats.hasNew,
                });
            }
        }

        // 8. ترتيب أبجدي
        subjects.sort((a, b) => a.displayName.localeCompare(b.displayName));

        return {
            childName,
            gradeName: enrollment.grade.displayName,
            sectionName: enrollment.section.name,
            termName,
            isFallbackTerm,
            subjects,
        };
    }

   // ═══════════════════════════════════════════════════════════════════
    // PAR-022/023 — دروس مادة لابن معيّن
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /school/parent/child/:childUuid/subject/:subjectUuid/lessons
     * جلب دروس مادة معيّنة لابن — مجمّعة بالوحدات + حالة كل درس
     *
     * DEC-PROGRESSION-ACCESS-01: ترتيب منهجي (Curriculum Order)
     * DEC-PAR-023-02: 3 حالات فقط: COMPLETED, CURRENT, AVAILABLE (بدون LOCKED)
     */
    async getChildSubjectLessons(
        schoolId: number,
        parentUserUuid: string,
        childUuid: string,
        subjectUuid: string,
    ) {
        // 1. التحقق من ارتباط ولي الأمر بالابن
        const { childName, childStudentId, enrollment } =
            await this.verifyParentChildLink(schoolId, parentUserUuid, childUuid);

        if (!enrollment) {
            return {
                subjectName: '',
                subjectUuid,
                termName: null,
                isFallbackTerm: false,
                units: [],
            };
        }

        // 2. جلب المادة
        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
        });

        if (!subject) {
            throw new NotFoundException('SUBJECT_NOT_FOUND');
        }

        // 3. حل السياق الأكاديمي
        const context = await this.progressService.resolveAcademicContext(schoolId);

        if (!context) {
            return {
                subjectName: subject.displayName,
                subjectUuid: subject.uuid,
                termName: null,
                isFallbackTerm: false,
                units: [],
            };
        }

        // 4. جلب الدروس المنشورة والمستهدفة للشعبة ضمن السياق
        const publishedTargets = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId: enrollment.sectionId,
                lesson: {
                    subjectId: subject.id,
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
                        templateId: true,
                        publishedAt: true,
                    },
                },
            },
        });

        // إذا لم يكن هناك أي دروس منشورة، نرجع قائمة فارغة مباشرة
        if (publishedTargets.length === 0) {
            return {
                subjectName: subject.displayName,
                subjectUuid: subject.uuid,
                termName: context.termName,
                isFallbackTerm: context.isFallback,
                units: [],
            };
        }

        // 🔴 التعديل 2: استخراج templateIds بدون تكرار (Deduplication)
        const templateIds = [
            ...new Set(
                publishedTargets
                    .map(t => t.lesson.templateId)
                    .filter((id): id is number => id !== null)
            ),
        ];

        // Map: templateId → lesson (published)
        const publishedMap = new Map<number, { lessonId: number; lessonUuid: string; publishedAt: Date | null }>();
        
        // 🔴 التعديل 3: منع الـ Overwrite العشوائي والاحتفاظ بالنسخة الأحدث
        for (const target of publishedTargets) {
            const templateId = target.lesson.templateId;
            if (templateId) {
                const existing = publishedMap.get(templateId);
                
                if (
                    !existing ||
                    (target.lesson.publishedAt &&
                        existing.publishedAt &&
                        target.lesson.publishedAt > existing.publishedAt)
                ) {
                    publishedMap.set(templateId, {
                        lessonId: target.lesson.id,
                        lessonUuid: target.lesson.uuid,
                        publishedAt: target.lesson.publishedAt,
                    });
                }
            }
        }

        // 5. جلب (templates) المرتبطة بالدروس المنشورة فقط — مرتبة منهجياً
        const publishedTemplates = await this.prisma.lessonTemplate.findMany({
            where: {
                id: { in: templateIds }, 
                schoolId,
                isDeleted: false,
            },
            include: {
                unit: { select: { title: true, orderIndex: true } },
                coverMediaAsset: { select: { uuid: true } },
                _count: {
                    select: {
                        questions: { where: { isDeleted: false } },
                    },
                },
                contents: {
                    where: { isDeleted: false, type: 'AUDIO' },
                    select: { id: true },
                    take: 1,
                },
            },
            // 🔴 التعديل 1: ترتيب مزدوج يضمن عدم اختلاط الدروس بين الوحدات
            orderBy: [
                {
                    unit: { orderIndex: 'asc' },
                },
                {
                    orderIndex: 'asc',
                },
            ],
        });

        // 6. جلب نتائج الطالب
        const lessonIds = publishedTargets.map(t => t.lesson.id);
        const lessonResults = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId: childStudentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            orderBy: { percent: 'desc' },
        });

        // Map: lessonId → best result + attempt count
        const progressMap = new Map<number, {
            bestPercent: number;
            bestGradeLabel: string;
            attemptCount: number;
            completedAt: Date;
        }>();
        const attemptCountMap = new Map<number, number>();

        for (const r of lessonResults) {
            attemptCountMap.set(r.lessonId, (attemptCountMap.get(r.lessonId) ?? 0) + 1);
            if (!progressMap.has(r.lessonId)) {
                progressMap.set(r.lessonId, {
                    bestPercent: r.percent,
                    bestGradeLabel: r.gradeLabel,
                    attemptCount: 0,
                    completedAt: r.createdAt,
                });
            }
        }
        for (const [lessonId, count] of attemptCountMap) {
            const entry = progressMap.get(lessonId);
            if (entry) entry.attemptCount = count;
        }

        // 7. بناء القائمة — ترتيب منهجي للدروس المتاحة فقط
        let foundCurrentPoint = false;

        const lessonsWithState = publishedTemplates.map(template => {
            const published = publishedMap.get(template.id)!; 
            const progress = progressMap.get(published.lessonId);
            const isCompleted = !!progress;

            let status: string;
            if (isCompleted) {
                status = 'COMPLETED';
            } else if (!foundCurrentPoint) {
                status = 'CURRENT';
                foundCurrentPoint = true;
            } else {
                status = 'AVAILABLE';
            }

            return {
                uuid: published.lessonUuid, 
                title: template.title,
                orderIndex: template.orderIndex,
                // 🔴 التعديل 4: رسالة واضحة في حال عدم وجود وحدة
                unitTitle: template.unit?.title ?? 'بدون وحدة',
                unitOrder: template.unit?.orderIndex ?? 0,
                questionCount: template._count.questions,
                hasAudio: template.contents.length > 0,
                coverMediaAssetUuid: template.coverMediaAsset?.uuid ?? null,
                status,
                progress: progress
                    ? {
                        bestPercent: progress.bestPercent,
                        bestGradeLabel: progress.bestGradeLabel,
                        attemptCount: progress.attemptCount,
                        completedAt: progress.completedAt,
                    }
                    : null,
            };
        });

        // 8. تجميع حسب الوحدات
        const unitsMap = new Map<string, {
            title: string;
            orderIndex: number;
            lessons: typeof lessonsWithState;
        }>();

        for (const lesson of lessonsWithState) {
            const key = `${lesson.unitOrder}_${lesson.unitTitle}`;
            if (!unitsMap.has(key)) {
                unitsMap.set(key, {
                    title: lesson.unitTitle,
                    orderIndex: lesson.unitOrder,
                    lessons: [],
                });
            }
            unitsMap.get(key)!.lessons.push(lesson);
        }

        // ترتيب الوحدات
        const units = Array.from(unitsMap.values())
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map(unit => ({
                title: unit.title,
                orderIndex: unit.orderIndex,
                lessons: unit.lessons.sort((a, b) => a.orderIndex - b.orderIndex),
            }));

        return {
            subjectName: subject.displayName,
            subjectUuid: subject.uuid,
            termName: context.termName,
            isFallbackTerm: context.isFallback,
            units,
        };
    }
    // ═══════════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * التحقق من ارتباط ولي الأمر بالابن + جلب بيانات الابن
     */
    private async verifyParentChildLink(
        schoolId: number,
        parentUserUuid: string,
        childUuid: string,
    ) {
        // ولي الأمر
        const parentUser = await this.prisma.user.findFirst({
            where: { uuid: parentUserUuid, schoolId, userType: 'PARENT', isDeleted: false },
            include: { parent: { select: { userId: true } } },
        });

        if (!parentUser || !parentUser.parent) {
            throw new ForbiddenException('USER_IS_NOT_PARENT');
        }

        // الابن
        const childUser = await this.prisma.user.findFirst({
            where: { uuid: childUuid, schoolId, isDeleted: false },
            include: {
                student: {
                    include: {
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                            include: {
                                grade: { select: { displayName: true } },
                                section: { select: { name: true } },
                            },
                            take: 1,
                        },
                    },
                },
            },
        });

        if (!childUser || !childUser.student) {
            throw new NotFoundException('CHILD_NOT_FOUND');
        }

        // التحقق من الارتباط
        const link = await this.prisma.parentStudent.findFirst({
            where: {
                parentId: parentUser.parent.userId,
                studentId: childUser.student.userId,
                isDeleted: false,
            },
        });

        if (!link) {
            throw new ForbiddenException('CHILD_NOT_LINKED');
        }

        return {
            parentId: parentUser.parent.userId,
            childName: childUser.name,
            childStudentId: childUser.student.userId,
            enrollment: childUser.student.enrollments[0] ?? null,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PAR-030/031: نتائج ابن (ملخص عام + مواد)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /school/parent/child/:childUuid/results
     *
     * DEC-RESULTS-01: مسار مستقل عن الإنجاز
     */
    async getChildResults(
        schoolId: number,
        parentUserUuid: string,
        childUuid: string,
    ) {
        const { childName, childStudentId, enrollment } =
            await this.verifyParentChildLink(schoolId, parentUserUuid, childUuid);

        if (!enrollment) {
            return {
                childName,
                overallScorePercent: 0,
                overallGradeLabel: '',
                subjectCount: 0,
                termName: null,
                isFallbackTerm: false,
                subjects: [],
            };
        }

        const overview = await this.resultsService.aggregateChildResults(
            schoolId,
            childStudentId,
            enrollment.sectionId,
        );

        return {
            childName,
            ...overview,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  PAR-032: نتائج دروس مادة معيّنة
    // ═══════════════════════════════════════════════════════════════════

    /**
     * GET /school/parent/child/:childUuid/subject/:subjectUuid/results
     *
     * DEC-RESULTS-07: فقط الدروس التي لها نتائج فعلية
     */
    async getChildSubjectResults(
        schoolId: number,
        parentUserUuid: string,
        childUuid: string,
        subjectUuid: string,
    ) {
        const { childStudentId, enrollment } =
            await this.verifyParentChildLink(schoolId, parentUserUuid, childUuid);

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        // جلب المادة بالـ UUID
        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
            select: { id: true },
        });

        if (!subject) {
            throw new NotFoundException('SUBJECT_NOT_FOUND');
        }

        const results = await this.resultsService.aggregateSubjectResults(
            schoolId,
            childStudentId,
            enrollment.sectionId,
            subject.id,
        );

        if (!results) {
            throw new NotFoundException('NO_RESULTS_FOUND');
        }

        return results;
    }
}
