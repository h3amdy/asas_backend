// src/school/teacher/lesson-targeting/lesson-delivery.service.ts
// ─── محرك النشر (Per-Target Publishing — DEC-020→024 v3.0) ─────────────
// مسؤول عن:
//   1. نشر فوري (OPEN) → لكل target: published_at = NOW
//   2. جدولة (SCHEDULED) → لكل target: scheduled_at = computed
//   3. Cron → publishDueTargets → targets المستحقة
//   4. إلغاء الجدولة → targets المجدولة
//   5. أرشفة → دروس منشورة/مجدولة
//   6. إعادة حساب Lesson.status (Derived Aggregate)
// ───────────────────────────────────────────────────────────────────────

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DeliveryPolicy } from '@prisma/client';

@Injectable()
export class LessonDeliveryService {
    private readonly logger = new Logger(LessonDeliveryService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ═══════════════════════════════════════════════════════════════════
    // ██ ENTRY POINT — deliver() ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * نقطة الدخول الرئيسية للنشر — يقرأ سياسة المدرسة ويُنفّذ
     * SRS-P4-05: النشر
     */
    async deliverLesson(params: {
        lessonId: number;
        schoolId: number;
        actorUserId: number;
        policy: DeliveryPolicy;
    }) {
        const { lessonId, schoolId, actorUserId, policy } = params;

        switch (policy) {
            case 'OPEN':
                return this.deliverOpen(lessonId, actorUserId);

            case 'SCHEDULED':
                return this.deliverScheduled(lessonId, actorUserId);

            case 'MANUAL':
                throw new BadRequestException(
                    'سياسة المدرسة تتطلب موافقة المدير/المشرف — هذه الميزة غير متاحة حالياً',
                );
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ OPEN — نشر فوري لكل targets ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * DEC-022 §5: OPEN → كل targets تُنشر فوراً
     * لكل target: published_at = NOW
     * ثم recalculateLessonStatus → PUBLISHED
     */
    private async deliverOpen(lessonId: number, actorUserId: number) {
        return this.prisma.$transaction(async (tx) => {
            const now = new Date();

            // 1. نشر كل targets
            const targets = await tx.lessonTarget.findMany({
                where: { lessonId },
                include: { section: { select: { uuid: true, name: true } } },
            });

            if (targets.length === 0) {
                throw new BadRequestException('يجب استهداف شعبة واحدة على الأقل');
            }

            const publishedTargets: Array<{
                targetId: number;
                sectionUuid: string;
                sectionName: string;
            }> = [];

            for (const target of targets) {
                await tx.lessonTarget.update({
                    where: { id: target.id },
                    data: { publishedAt: now },
                });

                // سجل لكل target
                await tx.lessonDeliveryLog.create({
                    data: {
                        lessonId,
                        targetId: target.id,
                        actorUserId,
                        action: 'PUBLISH_TARGET',
                        policyAtTime: 'OPEN',
                        details: JSON.stringify({
                            sectionId: target.sectionId,
                            publishedAt: now.toISOString(),
                        }),
                    },
                });

                publishedTargets.push({
                    targetId: target.id,
                    sectionUuid: target.section.uuid,
                    sectionName: target.section.name,
                });
            }

            // 2. إعادة حساب حالة الدرس
            const newStatus = await this.recalculateLessonStatus(tx, lessonId);

            // 3. تعيين deliveryMethod
            await tx.lesson.update({
                where: { id: lessonId },
                data: { deliveryMethod: 'OPEN' },
            });

            const lesson = await tx.lesson.findUnique({
                where: { id: lessonId },
                select: { uuid: true },
            });

            return {
                uuid: lesson!.uuid,
                status: newStatus,
                deliveryMethod: 'OPEN',
                summary: {
                    publishedNow: publishedTargets.length,
                    scheduledForLater: 0,
                },
                targets: publishedTargets.map((t) => ({
                    sectionUuid: t.sectionUuid,
                    sectionName: t.sectionName,
                    publishedAt: now.toISOString(),
                    scheduledAt: null,
                })),
            };
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ SCHEDULED — جدولة حسب الحصص (per-target) ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * DEC-022 §5: SCHEDULED
     * - ADDITIONAL → نشر فوري (لا جدولة للدروس الإضافية — BR-P4-09)
     * - SLOT_COVERAGE → لكل target: حساب scheduledAt من حصصها
     *   → إذا التاريخ مرّ: published_at = NOW (late delivery)
     *   → إذا التاريخ مستقبلي: scheduled_at = computed
     */
    private async deliverScheduled(lessonId: number, actorUserId: number) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            select: { id: true, uuid: true, linkType: true },
        });

        if (!lesson) throw new BadRequestException('الدرس غير موجود');

        // BR-P4-09: دروس ADDITIONAL تُنشر فوراً مع SCHEDULED
        if (lesson.linkType !== 'SLOT_COVERAGE') {
            this.logger.log(
                `Lesson ${lesson.uuid}: ADDITIONAL with SCHEDULED policy → publishing immediately`,
            );
            return this.deliverOpen(lessonId, actorUserId);
        }

        return this.prisma.$transaction(async (tx) => {
            const now = new Date();

            // جلب targets مع حصصها
            const targets = await tx.lessonTarget.findMany({
                where: { lessonId },
                include: {
                    section: { select: { uuid: true, name: true } },
                    timetableSlots: {
                        include: {
                            timetableSlot: {
                                include: {
                                    timetable: {
                                        include: {
                                            term: { select: { startDate: true } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            if (targets.length === 0) {
                throw new BadRequestException('يجب استهداف شعبة واحدة على الأقل');
            }

            let publishedNow = 0;
            let scheduledForLater = 0;
            const targetResults: Array<{
                sectionUuid: string;
                sectionName: string;
                publishedAt: string | null;
                scheduledAt: string | null;
            }> = [];

            for (const target of targets) {
                // حساب أقرب تاريخ حصة لهذا الـ target
                const scheduledAt = this.computeEarliestSlotDate(target.timetableSlots);

                if (!scheduledAt || scheduledAt <= now) {
                    // لا حصص أو التاريخ مرّ → نشر فوري
                    await tx.lessonTarget.update({
                        where: { id: target.id },
                        data: { publishedAt: now },
                    });

                    await tx.lessonDeliveryLog.create({
                        data: {
                            lessonId,
                            targetId: target.id,
                            actorUserId,
                            action: 'PUBLISH_TARGET',
                            policyAtTime: 'SCHEDULED',
                            details: JSON.stringify({
                                sectionId: target.sectionId,
                                lateDelivery: !!scheduledAt,
                                publishedAt: now.toISOString(),
                            }),
                        },
                    });

                    publishedNow++;
                    targetResults.push({
                        sectionUuid: target.section.uuid,
                        sectionName: target.section.name,
                        publishedAt: now.toISOString(),
                        scheduledAt: null,
                    });
                } else {
                    // التاريخ مستقبلي → جدولة
                    await tx.lessonTarget.update({
                        where: { id: target.id },
                        data: { scheduledAt },
                    });

                    await tx.lessonDeliveryLog.create({
                        data: {
                            lessonId,
                            targetId: target.id,
                            actorUserId,
                            action: 'SCHEDULE_TARGETS',
                            policyAtTime: 'SCHEDULED',
                            details: JSON.stringify({
                                sectionId: target.sectionId,
                                scheduledAt: scheduledAt.toISOString(),
                            }),
                        },
                    });

                    scheduledForLater++;
                    targetResults.push({
                        sectionUuid: target.section.uuid,
                        sectionName: target.section.name,
                        publishedAt: null,
                        scheduledAt: scheduledAt.toISOString(),
                    });
                }
            }

            // deliveryMethod + إعادة حساب الحالة
            await tx.lesson.update({
                where: { id: lessonId },
                data: { deliveryMethod: 'SCHEDULED' },
            });
            const newStatus = await this.recalculateLessonStatus(tx, lessonId);

            return {
                uuid: lesson.uuid,
                status: newStatus,
                deliveryMethod: 'SCHEDULED',
                summary: { publishedNow, scheduledForLater },
                targets: targetResults,
            };
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ CRON — نشر targets المستحقة ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * SRS-P4-06: Cron Job — publishDueTargets
     * يبحث عن targets: scheduled_at <= NOW AND published_at IS NULL
     * @returns عدد الـ targets المنشورة
     */
    async publishDueTargets(): Promise<number> {
        const now = new Date();

        const dueTargets = await this.prisma.lessonTarget.findMany({
            where: {
                scheduledAt: { lte: now },
                publishedAt: null,
                lesson: { isDeleted: false },
            },
            select: {
                id: true,
                lessonId: true,
                sectionId: true,
                lesson: { select: { uuid: true, teacherId: true } },
            },
        });

        if (dueTargets.length === 0) return 0;

        this.logger.log(`Found ${dueTargets.length} due target(s) to publish`);

        let published = 0;

        for (const target of dueTargets) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    // 1. نشر الـ target
                    await tx.lessonTarget.update({
                        where: { id: target.id },
                        data: { publishedAt: now },
                    });

                    // 2. سجل — المنفّذ هو النظام (المعلم صاحب الدرس)
                    await tx.lessonDeliveryLog.create({
                        data: {
                            lessonId: target.lessonId,
                            targetId: target.id,
                            actorUserId: target.lesson.teacherId,
                            action: 'PUBLISH_TARGET',
                            policyAtTime: 'SCHEDULED',
                            details: JSON.stringify({
                                triggeredBy: 'CRON_JOB',
                                sectionId: target.sectionId,
                                publishedAt: now.toISOString(),
                            }),
                        },
                    });

                    // 3. إعادة حساب حالة الدرس
                    await this.recalculateLessonStatus(tx, target.lessonId);
                });

                published++;
                this.logger.log(
                    `Published target ${target.id} for lesson ${target.lesson.uuid}`,
                );
            } catch (error) {
                this.logger.error(
                    `Failed to publish target ${target.id}: ${error}`,
                );
                // تابع مع الأخرى — retry في الدورة التالية
            }
        }

        return published;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ CANCEL — إلغاء الجدولة ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * SRS-P4-07: إلغاء الجدولة
     * Pre-condition: لا يوجد target منشور (published_at != null)
     * يُرجع كل targets إلى scheduled_at = null
     * ثم recalculateLessonStatus → READY
     */
    async cancelSchedule(params: {
        lessonId: number;
        actorUserId: number;
    }): Promise<{ uuid: string; status: string }> {
        const { lessonId, actorUserId } = params;

        return this.prisma.$transaction(async (tx) => {
            const lesson = await tx.lesson.findUnique({
                where: { id: lessonId },
                select: { uuid: true, status: true },
            });

            if (!lesson) throw new BadRequestException('الدرس غير موجود');
            if (lesson.status !== 'SCHEDULED') {
                throw new BadRequestException('الدرس ليس مُجدولاً');
            }

            // تحقق: لا targets منشورة (DEC-020 E7)
            const publishedCount = await tx.lessonTarget.count({
                where: { lessonId, publishedAt: { not: null } },
            });
            if (publishedCount > 0) {
                throw new BadRequestException(
                    'لا يمكن إلغاء الجدولة — يوجد شُعب منشورة بالفعل',
                );
            }

            // إلغاء جدولة كل targets
            await tx.lessonTarget.updateMany({
                where: { lessonId, scheduledAt: { not: null } },
                data: { scheduledAt: null },
            });

            // سجل
            await tx.lessonDeliveryLog.create({
                data: {
                    lessonId,
                    actorUserId,
                    action: 'CANCEL_SCHEDULE',
                    details: JSON.stringify({ cancelledAt: new Date().toISOString() }),
                },
            });

            // إعادة حساب → READY
            const newStatus = await this.recalculateLessonStatus(tx, lessonId);

            return { uuid: lesson.uuid, status: newStatus };
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ ARCHIVE — أرشفة ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * SRS-P4-08: الأرشفة — حدث مستقل (DEC-021 §4.3)
     * يُلغي كل targets المجدولة ثم يُؤرشف
     */
    async archiveLessons(params: {
        yearId: number;
        termId?: number;
        actorUserId: number;
    }): Promise<number> {
        const { yearId, termId, actorUserId } = params;

        const whereClause: any = {
            yearId,
            status: { in: ['PUBLISHED', 'SCHEDULED'] },
            isDeleted: false,
        };
        if (termId) whereClause.termId = termId;

        const lessons = await this.prisma.lesson.findMany({
            where: whereClause,
            select: { id: true, uuid: true },
        });

        let archived = 0;

        for (const lesson of lessons) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    // إلغاء targets المجدولة (INV-005)
                    await tx.lessonTarget.updateMany({
                        where: {
                            lessonId: lesson.id,
                            scheduledAt: { not: null },
                            publishedAt: null,
                        },
                        data: { scheduledAt: null },
                    });

                    // أرشفة
                    await tx.lesson.update({
                        where: { id: lesson.id },
                        data: { status: 'ARCHIVED' },
                    });

                    // سجل
                    await tx.lessonDeliveryLog.create({
                        data: {
                            lessonId: lesson.id,
                            actorUserId,
                            action: 'ARCHIVE',
                            details: JSON.stringify({
                                yearId,
                                termId: termId ?? null,
                            }),
                        },
                    });
                });

                archived++;
            } catch (error) {
                this.logger.error(`Failed to archive lesson ${lesson.uuid}: ${error}`);
            }
        }

        return archived;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ INVALIDATE — إبطال الجدولة عند حذف حصة ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * DEC-022 DR-022-05: عند حذف حصة → أبطل جدولة الـ target
     * فقط إذا لم يُنشر بعد
     */
    async handleScheduleInvalidated(targetId: number, actorUserId: number): Promise<void> {
        const target = await this.prisma.lessonTarget.findUnique({
            where: { id: targetId },
            select: { id: true, publishedAt: true, scheduledAt: true, lessonId: true },
        });

        if (!target || target.publishedAt || !target.scheduledAt) return;

        await this.prisma.$transaction(async (tx) => {
            await tx.lessonTarget.update({
                where: { id: targetId },
                data: { scheduledAt: null },
            });

            await tx.lessonDeliveryLog.create({
                data: {
                    lessonId: target.lessonId,
                    targetId,
                    actorUserId,
                    action: 'INVALIDATE_SCHEDULE',
                    details: JSON.stringify({ reason: 'SLOT_DELETED' }),
                },
            });

            await this.recalculateLessonStatus(tx, target.lessonId);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ PRIVATE — recalculateLessonStatus (DEC-020 §12) ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Derived Aggregate: يحسب Lesson.status من حالة الـ targets
     * 
     * القواعد (DEC-020 v3.0):
     * - كل targets published → PUBLISHED
     * - بعض targets scheduled (وبقيتها published أو لا شيء) → SCHEDULED
     * - لا scheduled ولا published → READY
     * - ARCHIVED → لا يتغير (فقط عبر archive())
     */
    private async recalculateLessonStatus(
        tx: any,
        lessonId: number,
    ): Promise<string> {
        const lesson = await tx.lesson.findUnique({
            where: { id: lessonId },
            select: { status: true },
        });

        // لا نُغيّر ARCHIVED
        if (lesson?.status === 'ARCHIVED') return 'ARCHIVED';

        const targets = await tx.lessonTarget.findMany({
            where: { lessonId },
            select: { publishedAt: true, scheduledAt: true },
        });

        if (targets.length === 0) {
            await tx.lesson.update({
                where: { id: lessonId },
                data: { status: 'READY' },
            });
            return 'READY';
        }

        const allPublished = targets.every((t: any) => t.publishedAt !== null);
        const anyScheduled = targets.some((t: any) => t.scheduledAt !== null && t.publishedAt === null);

        let newStatus: string;
        if (allPublished) {
            newStatus = 'PUBLISHED';
        } else if (anyScheduled) {
            newStatus = 'SCHEDULED';
        } else {
            // بعض targets منشورة + بعضها بدون جدولة → لا يزال SCHEDULED
            // (لأن الدرس لم يكتمل نشره)
            const anyPublished = targets.some((t: any) => t.publishedAt !== null);
            newStatus = anyPublished ? 'SCHEDULED' : 'READY';
        }

        await tx.lesson.update({
            where: { id: lessonId },
            data: { status: newStatus },
        });

        return newStatus;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ██ PRIVATE — حساب تاريخ النشر ██
    // ═══════════════════════════════════════════════════════════════════

    /**
     * حساب أقرب تاريخ حصة من بيانات LessonTimetableSlot
     * يعتمد على weekDate + weekday لحساب التاريخ الفعلي
     */
    private computeEarliestSlotDate(
        timetableSlots: Array<{
            weekDate: Date | null;
            timetableSlot: {
                weekday: number;
                timetable: {
                    term: { startDate: Date | null };
                };
            };
        }>,
    ): Date | null {
        let earliest: Date | null = null;

        for (const lts of timetableSlots) {
            const weekStart = lts.weekDate
                ?? lts.timetableSlot.timetable.term.startDate;

            if (!weekStart) continue;

            // weekday: 0=سبت, 1=أحد, 2=اثنين...
            // حساب التاريخ الفعلي = بداية الأسبوع + weekday
            const slotDate = new Date(weekStart);
            slotDate.setDate(slotDate.getDate() + lts.timetableSlot.weekday);

            if (earliest === null || slotDate < earliest) {
                earliest = slotDate;
            }
        }

        return earliest;
    }
}
