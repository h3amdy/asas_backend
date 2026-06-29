// src/school/student/lessons/student-lessons.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StudentProgressSummaryService } from '../../common/services/student-progress-summary.service';

@Injectable()
export class StudentLessonsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly progressSummary: StudentProgressSummaryService,
    ) { }

    /**
     * 📚 جلب Student + Enrollment helper
     */
    private async getStudentEnrollment(schoolId: number, userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { student: { select: { userId: true } } },
        });

        if (!user || !user.student) {
            throw new ForbiddenException('USER_IS_NOT_STUDENT');
        }

        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId: user.student.userId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
        });

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        return { studentId: user.student.userId, sectionId: enrollment.sectionId };
    }

    /**
     * GET /school/student/my-lessons?subjectUuid=xxx
     * جلب قائمة دروس مادة معيّنة المتاحة للطالب
     */
    async getMyLessons(schoolId: number, userUuid: string, subjectUuid: string) {
        const { studentId, sectionId } = await this.getStudentEnrollment(schoolId, userUuid);

        // 1. جلب Subject بالـ UUID
        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
        });

        if (!subject) {
            throw new NotFoundException('SUBJECT_NOT_FOUND');
        }

        // 2. جلب الدروس المستهدفة لشعبة الطالب في هذه المادة
        // DEC-024 v3.0: الظهور يعتمد على target.publishedAt (Per-Target)
        const lessonTargets = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId,
                publishedAt: { not: null }, // فقط targets المنشورة لهذه الشعبة
                lesson: {
                    subjectId: subject.id,
                    schoolId,
                    status: { not: 'ARCHIVED' },
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                lesson: {
                    include: {
                        template: {
                            include: {
                                unit: { select: { title: true, orderIndex: true } },
                                coverMediaAsset: { select: { uuid: true } },
                                _count: {
                                    select: {
                                        questions: {
                                            where: { isDeleted: false },
                                        },
                                    },
                                },
                                // فحص وجود صوت في الفقرات الجديدة
                                contentBlocks: {
                                    where: { isDeleted: false },
                                    select: {
                                        items: {
                                            where: { isDeleted: false, itemType: 'AUDIO' },
                                            select: { id: true },
                                            take: 1,
                                        },
                                    },
                                    take: 10,
                                },
                            },
                        },
                    },
                },
            },
        });

        // 3. جلب نتائج الطالب لكل الدروس (STD-055: تقدم الطالب)
        const lessonIds = lessonTargets.map((lt) => lt.lesson.id);
        const lessonResults = await this.prisma.studentLessonResult.findMany({
            where: {
                studentId,
                lessonId: { in: lessonIds },
                isDeleted: false,
            },
            orderBy: { percent: 'desc' },
        });

        // بناء map: lessonId → { bestResult, attemptCount }
        const progressMap = new Map<number, { bestPercent: number; bestGradeLabel: string; attemptCount: number; completedAt: Date }>();
        const attemptCountMap = new Map<number, number>();
        for (const r of lessonResults) {
            attemptCountMap.set(r.lessonId, (attemptCountMap.get(r.lessonId) ?? 0) + 1);
            if (!progressMap.has(r.lessonId)) {
                progressMap.set(r.lessonId, {
                    bestPercent: r.percent,
                    bestGradeLabel: r.gradeLabel,
                    attemptCount: 0, // سنحدثه بعد
                    completedAt: r.createdAt,
                });
            }
        }
        // تحديث عدد المحاولات
        for (const [lessonId, count] of attemptCountMap) {
            const entry = progressMap.get(lessonId);
            if (entry) entry.attemptCount = count;
        }

        // 4. تجميع وترتيب
        const result = lessonTargets
            .map((lt) => {
                const lesson = lt.lesson;
                const template = lesson.template;
                const prog = progressMap.get(lesson.id);
                return {
                    uuid: lesson.uuid,
                    title: template.title,
                    unitName: template.unit?.title ?? '',
                    unitOrder: template.unit?.orderIndex ?? 0,
                    orderIndex: template.orderIndex,
                    questionCount: template._count.questions,
                    publishedAt: lt.publishedAt, // Per-Target: من target وليس lesson
                    coverMediaAssetUuid: template.coverMediaAsset?.uuid ?? null,
                    hasAudio: template.contentBlocks.some((b) => b.items.length > 0),
                    // STD-055: حالة التقدم
                    progress: prog
                        ? {
                              status: 'COMPLETED',
                              bestPercent: prog.bestPercent,
                              bestGradeLabel: prog.bestGradeLabel,
                              attemptCount: prog.attemptCount,
                              completedAt: prog.completedAt,
                          }
                        : {
                              status: 'NOT_STARTED',
                              bestPercent: null,
                              bestGradeLabel: null,
                              attemptCount: 0,
                              completedAt: null,
                          },
                };
            })
            .sort((a, b) => {
                if (a.unitOrder !== b.unitOrder) return a.unitOrder - b.unitOrder;
                return a.orderIndex - b.orderIndex;
            });

        return {
            subjectName: subject.displayName,
            subjectUuid: subject.uuid,
            lessons: result,
        };
    }

    /**
     * GET /school/student/lesson/:lessonUuid
     * جلب تفاصيل درس واحد (المحتوى + معلومات)
     */
    async getLessonDetail(schoolId: number, userUuid: string, lessonUuid: string) {
        const { sectionId } = await this.getStudentEnrollment(schoolId, userUuid);

        // 1. جلب الدرس مع التحقق من أنه مستهدف ومنشور لشعبة الطالب
        // DEC-024 v3.0: الظهور يعتمد على target.publishedAt
        const lesson = await this.prisma.lesson.findFirst({
            where: {
                uuid: lessonUuid,
                schoolId,
                isDeleted: false,
                isActive: true,
                targets: {
                    some: { sectionId, publishedAt: { not: null } },
                },
                status: { not: 'ARCHIVED' },
            },
            include: {
                template: {
                    include: {
                        unit: { select: { title: true } },
                        // النظام الجديد: فقرات + عناصر
                        contentBlocks: {
                            where: { isDeleted: false },
                            orderBy: { orderIndex: 'asc' },
                            include: {
                                items: {
                                    where: { isDeleted: false },
                                    orderBy: { orderIndex: 'asc' },
                                    include: {
                                        mediaAsset: {
                                            select: {
                                                uuid: true,
                                                kind: true,
                                                contentType: true,
                                                durationSec: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        _count: {
                            select: {
                                questions: {
                                    where: { isDeleted: false },
                                },
                            },
                        },
                    },
                },
                subject: { select: { displayName: true } },
            },
        });

        if (!lesson) {
            throw new NotFoundException('LESSON_NOT_FOUND');
        }

        // 2. بناء الفقرات مع عناصرها
        const blocks = lesson.template.contentBlocks.map((b) => ({
            uuid: b.uuid,
            title: b.title,
            orderIndex: b.orderIndex,
            items: b.items.map((item) => ({
                uuid: item.uuid,
                itemType: item.itemType,
                orderIndex: item.orderIndex,
                textContent: item.textContent,
                mediaAssetUuid: item.mediaAsset?.uuid ?? null,
                mediaAssetKind: item.mediaAsset?.kind ?? null,
                contentType: item.mediaAsset?.contentType ?? null,
                durationSec: item.mediaAsset?.durationSec ?? null,
                caption: item.caption,
            })),
        }));

        // جلب publishedAt من target الطالب
        const studentTarget = await this.prisma.lessonTarget.findFirst({
            where: { lessonId: lesson.id, sectionId, publishedAt: { not: null } },
            select: { publishedAt: true },
        });

        return {
            uuid: lesson.uuid,
            title: lesson.template.title,
            subjectName: lesson.subject.displayName,
            unitName: lesson.template.unit?.title ?? '',
            questionCount: lesson.template._count.questions,
            publishedAt: studentTarget?.publishedAt ?? null, // Per-Target
            blocks,
        };
    }

    /**
     * GET /school/student/my-summary
     * ملخص الطالب: الاسم + الصف/الشعبة + إحصائيات الدروس (STD-011)
     */
    async getMySummary(schoolId: number, userUuid: string) {
        // 1. جلب بيانات المستخدم + enrollment
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            select: {
                displayName: true,
                student: { select: { userId: true } },
            },
        });

        if (!user || !user.student) {
            throw new ForbiddenException('USER_IS_NOT_STUDENT');
        }

        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId: user.student.userId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
            include: {
                section: {
                    select: {
                        name: true,
                        grade: { select: { displayName: true } },
                    },
                },
            },
        });

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        // 2. حساب الإنجاز عبر الخدمة المشتركة (تُصفّي بالسنة/الفصل الحالي)
        const progress = await this.progressSummary.getStudentProgressSummary(
            schoolId,
            user.student.userId,
            enrollment.sectionId,
        );

        return {
            displayName: user.displayName,
            gradeName: enrollment.section.grade.displayName,
            sectionName: enrollment.section.name,
            totalLessons: progress.totalLessons,
            completedLessons: progress.completedLessons,
        };
    }
}
