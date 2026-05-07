// src/school/parent/children/parent-children.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StudentProgressSummaryService } from '../../common/services/student-progress-summary.service';

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
}
