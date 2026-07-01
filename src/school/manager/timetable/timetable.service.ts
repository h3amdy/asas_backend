// src/school/manager/timetable/timetable.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaveTimetableDto } from './dto/timetable.dto';

@Injectable()
export class TimetableService {
    constructor(private readonly prisma: PrismaService) { }

    // ═══════ القراءة ═══════

    /**
     * GET — جلب جدول الشعبة للفصل المحدد
     * يشمل: slots + subject info + teacher المسند (من ADM-052)
     */
    async getTimetable(schoolId: number, sectionId: number, yearId: number, termId: number) {
        // 🛡️ التحقق من الشعبة وانتمائها للمدرسة
        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false, grade: { schoolId, isDeleted: false } },
            include: { grade: { select: { displayName: true } } },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        // جلب أو إنشاء الجدول
        let timetable = await this.prisma.timetable.findFirst({
            where: { sectionId, yearId, termId, isDeleted: false },
            include: {
                slots: {
                    where: { isDeleted: false },
                    orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
                    include: {
                        subjectSection: {
                            include: {
                                subject: { select: { id: true, uuid: true, displayName: true, shortName: true } },
                                teachers: {
                                    where: { isDeleted: false, isActive: true },
                                    take: 1,
                                    include: {
                                        teacher: {
                                            include: { user: { select: { uuid: true, name: true, code: true } } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // إذا لم يوجد جدول → إنشاء فارغ
        if (!timetable) {
            timetable = await this.prisma.timetable.create({
                data: { sectionId, yearId, termId },
                include: { slots: true },
            }) as any;
        }

        return {
            uuid: timetable!.uuid,
            sectionId,
            sectionName: section.name,
            gradeName: section.grade.displayName,
            yearId,
            termId,
            slots: (timetable!.slots || []).map((slot: any) => ({
                id: slot.id,
                uuid: slot.uuid,
                weekday: slot.weekday,
                lessonNumber: slot.lessonNumber,
                subject: slot.subjectSection ? {
                    id: slot.subjectSection.subject.id,
                    uuid: slot.subjectSection.subject.uuid,
                    displayName: slot.subjectSection.subject.displayName,
                    shortName: slot.subjectSection.subject.shortName,
                } : null,
                teacher: slot.subjectSection?.teachers?.[0] ? {
                    uuid: slot.subjectSection.teachers[0].teacher.user.uuid,
                    name: slot.subjectSection.teachers[0].teacher.user.name,
                    code: slot.subjectSection.teachers[0].teacher.user.code,
                } : null,
                subjectSectionId: slot.subjectSectionId,
            })),
        };
    }

    // ═══════ الحفظ (Bulk Upsert) ═══════

    /**
     * PUT — حفظ/تحديث حصص الجدول دفعة واحدة
     */
    async saveTimetable(
        schoolId: number,
        sectionId: number,
        yearId: number,
        termId: number,
        dto: SaveTimetableDto,
    ) {
        // 🛡️ التحقق من الشعبة
        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false, grade: { schoolId, isDeleted: false } },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        // 🛡️ التحقق من الـ year والـ term
        const term = await this.prisma.term.findFirst({
            where: { id: termId, yearId, year: { schoolId }, isDeleted: false },
        });
        if (!term) throw new NotFoundException('TERM_NOT_FOUND');

        // 🛡️ التحقق من الـ subjectSectionIds
        const ssIds = dto.slots
            .filter((s) => s.subjectSectionId != null)
            .map((s) => s.subjectSectionId!);

        if (ssIds.length > 0) {
            const validSS = await this.prisma.subjectSection.findMany({
                where: { id: { in: ssIds }, sectionId, isDeleted: false },
                select: { id: true },
            });
            const validIds = new Set(validSS.map((s) => s.id));
            const invalid = ssIds.filter((id) => !validIds.has(id));
            if (invalid.length > 0) {
                throw new BadRequestException(`INVALID_SUBJECT_SECTIONS: ${invalid.join(',')}`);
            }
        }

        // جلب أو إنشاء الجدول
        let timetable = await this.prisma.timetable.findFirst({
            where: { sectionId, yearId, termId, isDeleted: false },
        });

        if (!timetable) {
            timetable = await this.prisma.timetable.create({
                data: { sectionId, yearId, termId },
            });
        }

        // Bulk upsert slots
        for (const slot of dto.slots) {
            await this.prisma.timetableSlot.upsert({
                where: {
                    timetableId_weekday_lessonNumber: {
                        timetableId: timetable.id,
                        weekday: slot.weekday,
                        lessonNumber: slot.lessonNumber,
                    },
                },
                create: {
                    timetableId: timetable.id,
                    weekday: slot.weekday,
                    lessonNumber: slot.lessonNumber,
                    subjectSectionId: slot.subjectSectionId ?? null,
                },
                update: {
                    subjectSectionId: slot.subjectSectionId ?? null,
                    isDeleted: false,
                    deletedAt: null,
                },
            });
        }

        // إرجاع الجدول المحدّث
        return this.getTimetable(schoolId, sectionId, yearId, termId);
    }

    // ═══════ حذف حصة ═══════

    async deleteSlot(schoolId: number, slotUuid: string) {
        const slot = await this.prisma.timetableSlot.findFirst({
            where: { uuid: slotUuid, isDeleted: false },
            include: {
                timetable: {
                    include: { section: { include: { grade: { select: { schoolId: true } } } } },
                },
            },
        });

        if (!slot) throw new NotFoundException('SLOT_NOT_FOUND');
        if (slot.timetable.section.grade.schoolId !== schoolId) {
            throw new NotFoundException('SLOT_NOT_FOUND');
        }

        await this.prisma.$transaction(async (tx) => {
            // 1. حذف الحصة (soft delete)
            await tx.timetableSlot.update({
                where: { id: slot.id },
                data: { isDeleted: true, deletedAt: new Date(), subjectSectionId: null },
            });

            // ────────────────────────────────────────────────────────────────
            // DEC-022 DR-022-05: إبطال جدولة الدروس المرتبطة بهذه الحصة
            // "الجدول هو مصدر الحقيقة، وليس scheduled_at"
            // TimetableService لا تُعدّل scheduled_at مباشرة — لكن تتحقق
            // من وجود targets مُجدولة مرتبطة وتُبطل جدولتها.
            // ────────────────────────────────────────────────────────────────

            // 2. إيجاد LessonTimetableSlots المرتبطة بهذه الحصة
            const linkedLessonSlots = await tx.lessonTimetableSlot.findMany({
                where: { timetableSlotId: slot.id },
                include: {
                    target: {
                        select: {
                            id: true,
                            lessonId: true,
                            sectionId: true,
                            publishedAt: true,
                            scheduledAt: true,
                        },
                    },
                },
            });

            // 3. لكل target مُجدول (غير منشور) — فحص هل بقيت حصص أخرى
            const affectedTargetIds = new Set<number>();
            for (const lts of linkedLessonSlots) {
                const target = lts.target;
                // لا نتدخل إذا target منشور أو غير مُجدول
                if (!target || target.publishedAt || !target.scheduledAt) continue;
                affectedTargetIds.add(target.id);
            }

            for (const targetId of affectedTargetIds) {
                // كم حصة متبقية لهذا الـ target (غير الحصة المحذوفة)؟
                const remainingSlots = await tx.lessonTimetableSlot.findMany({
                    where: {
                        targetId,
                        timetableSlot: { isDeleted: false },
                    },
                    include: {
                        timetableSlot: {
                            include: {
                                timetable: {
                                    include: { term: { select: { startDate: true } } },
                                },
                            },
                        },
                    },
                });

                const target = await tx.lessonTarget.findUnique({
                    where: { id: targetId },
                    select: { lessonId: true, sectionId: true },
                });
                if (!target) continue;

                if (remainingSlots.length === 0) {
                    // DR-022-05: Invalidated Scheduling — لم تبقَ أي حصة
                    await tx.lessonTarget.update({
                        where: { id: targetId },
                        data: { scheduledAt: null },
                    });

                    await tx.lessonDeliveryLog.create({
                        data: {
                            lessonId: target.lessonId,
                            targetId,
                            actorUserId: 0, // System action
                            action: 'INVALIDATE_SCHEDULE',
                            details: JSON.stringify({
                                reason: 'SLOT_DELETED',
                                deletedSlotUuid: slotUuid,
                                sectionId: target.sectionId,
                            }),
                        },
                    });
                } else {
                    // بقيت حصص — إعادة حساب scheduled_at
                    // أقرب تاريخ حصة مستقبلي
                    const now = new Date();
                    let earliest: Date | null = null;

                    for (const rs of remainingSlots) {
                        const tSlot = rs.timetableSlot;
                        const term = tSlot.timetable?.term;
                        if (!term?.startDate || !rs.weekDate) continue;

                        const weekDate = new Date(rs.weekDate);
                        // حساب التاريخ الفعلي: weekDate + weekday
                        const targetDate = new Date(weekDate);
                        targetDate.setDate(targetDate.getDate() + ((tSlot.weekday - targetDate.getDay() + 7) % 7));

                        if (targetDate > now) {
                            if (!earliest || targetDate < earliest) {
                                earliest = targetDate;
                            }
                        }
                    }

                    await tx.lessonTarget.update({
                        where: { id: targetId },
                        data: { scheduledAt: earliest },
                    });

                    if (!earliest) {
                        // كل الحصص المتبقية ماضية — Invalidated
                        await tx.lessonDeliveryLog.create({
                            data: {
                                lessonId: target.lessonId,
                                targetId,
                                actorUserId: 0,
                                action: 'INVALIDATE_SCHEDULE',
                                details: JSON.stringify({
                                    reason: 'ALL_REMAINING_SLOTS_PAST',
                                    deletedSlotUuid: slotUuid,
                                }),
                            },
                        });
                    }
                }

                // إعادة حساب حالة الدرس (DEC-020 §10, DEC-022 §10)
                const lesson = await tx.lesson.findUnique({
                    where: { id: target.lessonId },
                    select: { status: true },
                });
                if (lesson && lesson.status !== 'ARCHIVED') {
                    const allTargets = await tx.lessonTarget.findMany({
                        where: { lessonId: target.lessonId },
                        select: { publishedAt: true, scheduledAt: true },
                    });
                    const allPublished = allTargets.every((t: any) => t.publishedAt !== null);
                    const anyScheduled = allTargets.some((t: any) => t.scheduledAt !== null && t.publishedAt === null);
                    let newStatus: string;
                    if (allPublished) newStatus = 'PUBLISHED';
                    else if (anyScheduled) newStatus = 'SCHEDULED';
                    else newStatus = 'READY';

                    await tx.lesson.update({
                        where: { id: target.lessonId },
                        data: { status: newStatus },
                    });
                }
            }
        });

        return { success: true };
    }

    // ═══════ المواد المتاحة للشعبة (لـ bottom sheet) ═══════

    /**
     * GET — جلب كل المواد المسندة لشعبة معينة مع المعلمين
     * يُستخدم في bottom sheet لاختيار المادة للحصة
     */
    async getSectionSubjects(schoolId: number, sectionId: number) {
        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false, grade: { schoolId, isDeleted: false } },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        const subjectSections = await this.prisma.subjectSection.findMany({
            where: { sectionId, isDeleted: false },
            include: {
                subject: { select: { id: true, uuid: true, displayName: true, shortName: true } },
                teachers: {
                    where: { isDeleted: false, isActive: true },
                    take: 1,
                    include: {
                        teacher: {
                            include: { user: { select: { uuid: true, name: true, code: true } } },
                        },
                    },
                },
            },
            orderBy: { subject: { displayName: 'asc' } },
        });

        return subjectSections.map((ss) => ({
            subjectSectionId: ss.id,
            subjectName: ss.subject.displayName,
            subjectShortName: ss.subject.shortName,
            subjectUuid: ss.subject.uuid,
            teacher: ss.teachers[0] ? {
                uuid: ss.teachers[0].teacher.user.uuid,
                name: ss.teachers[0].teacher.user.name,
                code: ss.teachers[0].teacher.user.code,
            } : null,
        }));
    }

    // ═══════ كشف تعارضات المعلم ═══════

    /**
     * GET — هل المعلم مشغول في حصة أخرى بنفس الوقت؟
     * يُستخدم من Flutter قبل التعيين
     */
    async checkTeacherConflicts(
        schoolId: number,
        sectionId: number,
        yearId: number,
        termId: number,
        weekday: number,
        lessonNumber: number,
        subjectSectionId: number,
    ) {
        // 1. إيجاد المعلم المسند لهذه المادة+الشعبة
        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: { subjectSectionId, isDeleted: false, isActive: true },
            include: { teacher: { include: { user: { select: { uuid: true, name: true } } } } },
        });

        if (!assignment) return { hasConflict: false, teacher: null, conflictsWith: null };

        const teacherId = assignment.teacherId;

        // 2. البحث عن حصص أخرى لنفس المعلم في نفس الوقت
        const conflictingSlots = await this.prisma.timetableSlot.findMany({
            where: {
                weekday,
                lessonNumber,
                isDeleted: false,
                timetable: {
                    yearId,
                    termId,
                    isDeleted: false,
                    sectionId: { not: sectionId }, // شعبة مختلفة
                    section: { grade: { schoolId } },
                },
                subjectSection: {
                    isDeleted: false,
                    teachers: {
                        some: { teacherId, isDeleted: false, isActive: true },
                    },
                },
            },
            include: {
                timetable: {
                    include: {
                        section: { select: { name: true, grade: { select: { displayName: true } } } },
                    },
                },
                subjectSection: {
                    include: { subject: { select: { displayName: true } } },
                },
            },
        });

        if (conflictingSlots.length === 0) {
            return { hasConflict: false, teacher: null, conflictsWith: null };
        }

        return {
            hasConflict: true,
            teacher: {
                uuid: assignment.teacher.user.uuid,
                name: assignment.teacher.user.name,
            },
            conflictsWith: conflictingSlots.map((s) => ({
                sectionName: s.timetable.section.name,
                gradeName: s.timetable.section.grade.displayName,
                subjectName: s.subjectSection?.subject?.displayName ?? '',
            })),
        };
    }

    // ═══════ جدول المعلم الأسبوعي (ADM-047) ═══════

    /**
     * GET — جلب كل حصص المعلم من كل الشعب في فصل معيّن
     * يُستخدم لعرض الجدول الأسبوعي للمعلم
     */
    async getTeacherTimetable(
        schoolId: number,
        teacherUuid: string,
        yearId: number,
        termId: number,
    ) {
        // 1. التحقق من المعلم (schoolId على User وليس Teacher)
        const teacher = await this.prisma.teacher.findFirst({
            where: {
                user: { uuid: teacherUuid, schoolId, isActive: true },
            },
            include: {
                user: { select: { uuid: true, name: true, code: true } },
            },
        });
        if (!teacher) throw new NotFoundException('TEACHER_NOT_FOUND');

        // 2. جلب كل حصص المعلم عبر subject_section_teachers → timetable_slots
        const slots = await this.prisma.timetableSlot.findMany({
            where: {
                isDeleted: false,
                timetable: {
                    yearId,
                    termId,
                    isDeleted: false,
                    section: {
                        isDeleted: false,
                        grade: { schoolId, isDeleted: false },
                    },
                },
                subjectSection: {
                    isDeleted: false,
                    teachers: {
                        some: {
                            teacherId: teacher.userId,  // PK في Teacher = userId
                            isDeleted: false,
                            isActive: true,
                        },
                    },
                },
            },
            orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
            include: {
                subjectSection: {
                    include: {
                        subject: {
                            select: {
                                id: true,
                                uuid: true,
                                displayName: true,
                                shortName: true,
                            },
                        },
                        section: {
                            select: {
                                id: true,
                                name: true,
                                grade: { select: { displayName: true } },
                            },
                        },
                    },
                },
            },
        });

        return {
            teacherUuid: teacher.user.uuid,
            teacherName: teacher.user.name,
            teacherCode: teacher.user.code,
            yearId,
            termId,
            slots: slots.map((slot) => ({
                weekday: slot.weekday,
                lessonNumber: slot.lessonNumber,
                subject: slot.subjectSection ? {
                    id: slot.subjectSection.subject.id,
                    uuid: slot.subjectSection.subject.uuid,
                    displayName: slot.subjectSection.subject.displayName,
                    shortName: slot.subjectSection.subject.shortName,
                } : null,
                section: slot.subjectSection ? {
                    id: slot.subjectSection.section.id,
                    name: slot.subjectSection.section.name,
                    gradeName: slot.subjectSection.section.grade.displayName,
                } : null,
            })),
        };
    }
}
