// src/school/teacher/lesson-targeting/teacher-lesson-targeting.service.ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaveTargetingDto } from '../lessons/dto/save-targeting.dto';
import { LessonDeliveryService } from './lesson-delivery.service';

@Injectable()
export class TeacherLessonTargetingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly deliveryService: LessonDeliveryService,
    ) {}

    private async getTeacherContext(schoolId: number, userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });
        if (!user || !user.teacher) throw new ForbiddenException('ليس لديك صلاحية');
        return { userId: user.id, teacherId: user.teacher.userId };
    }

    private async assertOwnsSubject(schoolId: number, teacherId: number, subjectUuid: string) {
        const subject = await this.prisma.subject.findFirst({ where: { uuid: subjectUuid, schoolId, isDeleted: false } });
        if (!subject) throw new NotFoundException('المادة غير موجودة');
        const a = await this.prisma.subjectSectionTeacher.findFirst({
            where: { teacherId, isDeleted: false, isActive: true, subjectSection: { subjectId: subject.id, isDeleted: false } },
        });
        if (!a) throw new ForbiddenException('ليس لديك صلاحية لهذه المادة');
        return { subjectId: subject.id };
    }

    // SRS-P4-01: الشُعب المتاحة
    async getAvailableSections(schoolId: number, userUuid: string, subjectUuid: string) {
        const { teacherId } = await this.getTeacherContext(schoolId, userUuid);
        const { subjectId } = await this.assertOwnsSubject(schoolId, teacherId, subjectUuid);
        const assignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId, isDeleted: false, isActive: true,
                subjectSection: { subjectId, isDeleted: false, section: { isDeleted: false, isActive: true } },
            },
            include: {
                subjectSection: {
                    include: {
                        section: {
                            include: {
                                grade: true,
                                timetables: { where: { isDeleted: false, status: 'PUBLISHED' }, take: 1 },
                            },
                        },
                    },
                },
            },
        });
        return {
            sections: assignments.map((a) => ({
                uuid: a.subjectSection.section.uuid,
                name: a.subjectSection.section.name,
                gradeName: a.subjectSection.section.grade.displayName,
                gradeId: a.subjectSection.section.gradeId,
                sectionId: a.subjectSection.sectionId,
                subjectSectionId: a.subjectSection.id,
                hasPublishedTimetable: a.subjectSection.section.timetables.length > 0,
            })),
        };
    }

    // SRS-P4-02: حصص المادة في شعبة
    async getTimetableSlotsForSection(
        schoolId: number, userUuid: string,
        subjectUuid: string, sectionUuid: string,
    ) {
        const { teacherId } = await this.getTeacherContext(schoolId, userUuid);
        const { subjectId } = await this.assertOwnsSubject(schoolId, teacherId, subjectUuid);

        const section = await this.prisma.section.findFirst({
            where: { uuid: sectionUuid, isDeleted: false, grade: { schoolId } },
        });
        if (!section) throw new NotFoundException('الشعبة غير موجودة');

        const ss = await this.prisma.subjectSection.findFirst({
            where: { subjectId, sectionId: section.id, isDeleted: false },
        });
        if (!ss) throw new NotFoundException('المادة غير مرتبطة بهذه الشعبة');

        const tt = await this.prisma.timetable.findFirst({
            where: { sectionId: section.id, isDeleted: false, status: 'PUBLISHED' },
            orderBy: { publishedAt: 'desc' },
        });
        if (!tt) return { slots: [] };

        const slots = await this.prisma.timetableSlot.findMany({
            where: { timetableId: tt.id, subjectSectionId: ss.id, isDeleted: false },
            orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
            include: {
                lessonTimetableSlots: {
                    include: {
                        lesson: { include: { template: { select: { title: true } } } },
                    },
                },
            },
        });

        return {
            slots: slots.map((s) => {
                const c = s.lessonTimetableSlots.find((l) => !l.lesson.isDeleted);
                return {
                    uuid: s.uuid,
                    weekday: s.weekday,
                    lessonNumber: s.lessonNumber,
                    isCovered: !!c,
                    coveredByLessonTitle: c?.lesson.template.title ?? null,
                    coveredByLessonUuid: c?.lesson.uuid ?? null,
                };
            }),
        };
    }

    // حفظ الاستهداف
    async saveTargeting(
        schoolId: number, userUuid: string,
        lessonTemplateUuid: string, dto: SaveTargetingDto,
    ) {
        const { userId, teacherId } = await this.getTeacherContext(schoolId, userUuid);

        const template = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonTemplateUuid, schoolId, isDeleted: false },
        });
        if (!template) throw new NotFoundException('الدرس غير موجود');
        if (template.status !== 'READY') {
            throw new BadRequestException('الدرس يجب أن يكون "جاهز" قبل الاستهداف');
        }

        const cy = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: { terms: { where: { isCurrent: true, isDeleted: false }, take: 1 } },
        });
        if (!cy || cy.terms.length === 0) {
            throw new BadRequestException('لا يوجد سنة أو فصل دراسي حالي');
        }

        const sections = await this.prisma.section.findMany({
            where: { uuid: { in: dto.sectionUuids }, isDeleted: false, isActive: true, grade: { schoolId } },
        });
        if (sections.length !== dto.sectionUuids.length) {
            throw new BadRequestException('بعض الشُعب غير موجودة');
        }

        const existing = await this.prisma.lesson.findFirst({
            where: { templateId: template.id, isDeleted: false },
        });

        // DEC-020 §14.11: Immutability — لا يمكن تعديل الاستهداف بعد النشر
        if (existing && ['PUBLISHED', 'SCHEDULED', 'ARCHIVED'].includes(existing.status)) {
            throw new BadRequestException('لا يمكن تعديل الاستهداف بعد نشر الدرس');
        }

        return await this.prisma.$transaction(async (tx) => {
            let lesson;

            if (existing) {
                // حذف slots أولاً (FK dependency على targets)
                await tx.lessonTimetableSlot.deleteMany({ where: { lessonId: existing.id } });
                await tx.lessonTarget.deleteMany({ where: { lessonId: existing.id } });
                lesson = await tx.lesson.update({
                    where: { id: existing.id },
                    data: { linkType: dto.linkType },
                });
            } else {
                lesson = await tx.lesson.create({
                    data: {
                        templateId: template.id,
                        schoolId,
                        teacherId,
                        subjectId: template.subjectId!,
                        yearId: cy.id,
                        termId: cy.terms[0].id,
                        status: 'READY',
                        linkType: dto.linkType,
                    },
                });
            }

            // إنشاء targets + بناء map للربط بالحصص
            const sectionIdToTargetId = new Map<number, number>();

            for (const sec of sections) {
                const target = await tx.lessonTarget.create({
                    data: { lessonId: lesson.id, sectionId: sec.id },
                });
                sectionIdToTargetId.set(sec.id, target.id);
            }

            // ربط الحصص بالـ targets (DEC-020 v3.0)
            if (dto.linkType === 'SLOT_COVERAGE' && dto.slotAssignments) {
                // بناء sectionUuid → sectionId map
                const sectionUuidToId = new Map<string, number>();
                for (const sec of sections) {
                    sectionUuidToId.set(sec.uuid, sec.id);
                }

                for (const sa of dto.slotAssignments) {
                    const slot = await tx.timetableSlot.findFirst({
                        where: { uuid: sa.slotUuid, isDeleted: false },
                    });
                    if (slot) {
                        // ربط الحصة بالـ target المناسب
                        const sectionId = sectionUuidToId.get(sa.sectionUuid);
                        const targetId = sectionId ? sectionIdToTargetId.get(sectionId) : undefined;

                        await tx.lessonTimetableSlot.create({
                            data: {
                                lessonId: lesson.id,
                                timetableSlotId: slot.id,
                                targetId: targetId ?? null,
                            },
                        });
                    }
                }
            }

            await tx.lessonDeliveryLog.create({
                data: {
                    lessonId: lesson.id,
                    actorUserId: userId,
                    action: 'SAVE_TARGETING',
                    details: JSON.stringify({
                        sectionCount: sections.length,
                        slotCount: dto.slotAssignments?.length ?? 0,
                        linkType: dto.linkType,
                    }),
                },
            });

            return {
                lessonUuid: lesson.uuid,
                targetedSections: sections.map((s) => s.uuid),
                linkType: dto.linkType,
                slotCount: dto.slotAssignments?.length ?? 0,
            };
        });
    }

    // جلب الاستهداف الحالي
    async getTargeting(schoolId: number, userUuid: string, lessonTemplateUuid: string) {
        await this.getTeacherContext(schoolId, userUuid);

        const template = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonTemplateUuid, schoolId, isDeleted: false },
        });
        if (!template) throw new NotFoundException('الدرس غير موجود');

        const lesson = await this.prisma.lesson.findFirst({
            where: { templateId: template.id, isDeleted: false },
            include: {
                targets: {
                    include: { section: { select: { uuid: true, name: true } } },
                },
                timetableSlots: {
                    include: {
                        timetableSlot: {
                            select: { uuid: true, weekday: true, lessonNumber: true },
                        },
                    },
                },
            },
        });
        if (!lesson) throw new NotFoundException('لم يتم استهداف هذا الدرس بعد');

        return {
            lessonUuid: lesson.uuid,
            status: lesson.status,
            deliveryMethod: lesson.deliveryMethod,
            linkType: lesson.linkType,
            targetedSections: lesson.targets.map((t) => ({
                uuid: t.section.uuid,
                name: t.section.name,
                scheduledAt: t.scheduledAt,
                publishedAt: t.publishedAt,
            })),
            assignedSlots: lesson.timetableSlots.map((l) => ({
                slotUuid: l.timetableSlot.uuid,
                weekday: l.timetableSlot.weekday,
                lessonNumber: l.timetableSlot.lessonNumber,
                weekDate: l.weekDate,
            })),
        };
    }

    // SRS-P4-05: نشر الدرس — يتحقق من سياسة المدرسة
    async publishLesson(schoolId: number, userUuid: string, lessonTemplateUuid: string) {
        const { userId } = await this.getTeacherContext(schoolId, userUuid);

        const template = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonTemplateUuid, schoolId, isDeleted: false },
        });
        if (!template) throw new NotFoundException('الدرس غير موجود');

        const lesson = await this.prisma.lesson.findFirst({
            where: { templateId: template.id, isDeleted: false },
            include: { targets: true },
        });
        if (!lesson) throw new BadRequestException('يجب استهداف الدرس أولاً');
        if (lesson.targets.length === 0) throw new BadRequestException('يجب اختيار شعبة واحدة');
        if (lesson.status === 'PUBLISHED') throw new BadRequestException('الدرس منشور مسبقاً');
        if (lesson.status === 'SCHEDULED') throw new BadRequestException('الدرس مجدول مسبقاً');
        if (lesson.status === 'ARCHIVED') throw new BadRequestException('الدرس مؤرشف — لا يمكن نشره');

        // جلب سياسة المدرسة
        const school = await this.prisma.school.findUnique({
            where: { id: schoolId },
            select: { deliveryPolicy: true },
        });
        if (!school) throw new NotFoundException('المدرسة غير موجودة');

        // تفويض القرار لمحرك النشر
        return this.deliveryService.deliverLesson({
            lessonId: lesson.id,
            schoolId,
            actorUserId: userId,
            policy: school.deliveryPolicy,
        });
    }

    // SRS-P4-07: إلغاء الجدولة
    async cancelSchedule(schoolId: number, userUuid: string, lessonTemplateUuid: string) {
        const { userId } = await this.getTeacherContext(schoolId, userUuid);

        const template = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonTemplateUuid, schoolId, isDeleted: false },
        });
        if (!template) throw new NotFoundException('الدرس غير موجود');

        const lesson = await this.prisma.lesson.findFirst({
            where: { templateId: template.id, isDeleted: false },
        });
        if (!lesson) throw new BadRequestException('الدرس غير مستهدف');

        return this.deliveryService.cancelSchedule({
            lessonId: lesson.id,
            actorUserId: userId,
        });
    }

    // حالة النشر التفصيلية — per-target status
    async getDeliveryStatus(schoolId: number, userUuid: string, lessonTemplateUuid: string) {
        await this.getTeacherContext(schoolId, userUuid);

        const template = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonTemplateUuid, schoolId, isDeleted: false },
        });
        if (!template) throw new NotFoundException('الدرس غير موجود');

        const lesson = await this.prisma.lesson.findFirst({
            where: { templateId: template.id, isDeleted: false },
            include: {
                targets: {
                    include: {
                        section: { select: { uuid: true, name: true } },
                    },
                },
            },
        });
        if (!lesson) throw new NotFoundException('الدرس لم يُستهدف بعد');

        return {
            lessonUuid: lesson.uuid,
            status: lesson.status,
            deliveryMethod: lesson.deliveryMethod,
            linkType: lesson.linkType,
            targets: lesson.targets.map((t) => ({
                sectionUuid: t.section.uuid,
                sectionName: t.section.name,
                scheduledAt: t.scheduledAt,
                publishedAt: t.publishedAt,
                isPublished: t.publishedAt !== null,
                isScheduled: t.scheduledAt !== null && t.publishedAt === null,
            })),
            summary: {
                totalTargets: lesson.targets.length,
                publishedCount: lesson.targets.filter((t) => t.publishedAt !== null).length,
                scheduledCount: lesson.targets.filter((t) => t.scheduledAt !== null && t.publishedAt === null).length,
                pendingCount: lesson.targets.filter((t) => t.scheduledAt === null && t.publishedAt === null).length,
            },
        };
    }
}
