// src/school/student/lessons/student-lessons.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StudentLessonsService {
    constructor(private readonly prisma: PrismaService) { }

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
        const { sectionId } = await this.getStudentEnrollment(schoolId, userUuid);

        // 1. جلب Subject بالـ UUID
        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
        });

        if (!subject) {
            throw new NotFoundException('SUBJECT_NOT_FOUND');
        }

        // 2. جلب الدروس المستهدفة لشعبة الطالب في هذه المادة
        const lessonTargets = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId,
                lesson: {
                    subjectId: subject.id,
                    schoolId,
                    status: { in: ['PUBLISHED', 'DELIVERED'] },
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
                                contents: {
                                    where: { isDeleted: false, type: 'AUDIO' },
                                    select: { id: true },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        });

        // 3. تجميع وترتيب حسب publishedAt ASC (الأقدم أولاً)
        const result = lessonTargets
            .map((lt) => {
                const lesson = lt.lesson;
                const template = lesson.template;
                return {
                    uuid: lesson.uuid,
                    title: template.title,
                    unitName: template.unit.title,
                    unitOrder: template.unit.orderIndex,
                    orderIndex: template.orderIndex,
                    questionCount: template._count.questions,
                    publishedAt: lesson.publishedAt,
                    coverMediaAssetUuid: template.coverMediaAsset?.uuid ?? null,
                    hasAudio: template.contents.length > 0,
                };
            })
            .sort((a, b) => {
                // ترتيب حسب الوحدة ثم ترتيب الدرس داخل الوحدة
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

        // 1. جلب الدرس مع التحقق من أنه مستهدف لشعبة الطالب
        const lesson = await this.prisma.lesson.findFirst({
            where: {
                uuid: lessonUuid,
                schoolId,
                status: { in: ['PUBLISHED', 'DELIVERED'] },
                isDeleted: false,
                isActive: true,
                targets: {
                    some: { sectionId },
                },
            },
            include: {
                template: {
                    include: {
                        unit: { select: { title: true } },
                        contents: {
                            where: { isDeleted: false },
                            orderBy: { orderIndex: 'asc' },
                            include: {
                                mediaAsset: {
                                    select: {
                                        uuid: true,
                                        contentType: true,
                                        durationSec: true,
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

        // 2. بناء كتل المحتوى
        const contentBlocks = lesson.template.contents.map((c) => ({
            uuid: c.uuid,
            type: c.type,
            title: c.title,
            contentText: c.contentText,
            orderIndex: c.orderIndex,
            mediaAssetUuid: c.mediaAsset?.uuid ?? null,
            contentType: c.mediaAsset?.contentType ?? null,
            durationSec: c.mediaAsset?.durationSec ?? null,
        }));

        return {
            uuid: lesson.uuid,
            title: lesson.template.title,
            subjectName: lesson.subject.displayName,
            unitName: lesson.template.unit.title,
            questionCount: lesson.template._count.questions,
            publishedAt: lesson.publishedAt,
            contentBlocks,
        };
    }
}
