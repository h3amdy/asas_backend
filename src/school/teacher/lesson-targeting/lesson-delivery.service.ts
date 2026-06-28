// src/school/teacher/lesson-targeting/lesson-delivery.service.ts
// ─── خدمة نشر/تمرير الدروس ────────────────────────────────────────────
// مسؤولة عن اتخاذ قرار النشر بناءً على سياسة المدرسة
// تُستخدم من: publishLesson endpoint + Cron Job
// ───────────────────────────────────────────────────────────────────────

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DeliveryPolicy } from '@prisma/client';

@Injectable()
export class LessonDeliveryService {
    private readonly logger = new Logger(LessonDeliveryService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * نشر الدرس بناءً على سياسة المدرسة
     * @returns بيانات الدرس المنشور/المجدول
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

    // ═══════════════ OPEN — نشر فوري ═══════════════

    /**
     * نشر فوري — الدرس يصل للطلاب مباشرة
     */
    private async deliverOpen(lessonId: number, actorUserId: number) {
        return this.prisma.$transaction(async (tx) => {
            const now = new Date();

            const updated = await tx.lesson.update({
                where: { id: lessonId },
                data: {
                    status: 'PUBLISHED',
                    deliveryMethod: 'OPEN',
                    publishedAt: now,
                    deliveredAt: now,
                },
            });

            await tx.lessonDeliveryLog.create({
                data: {
                    lessonId,
                    actorUserId,
                    action: 'PUBLISH',
                    policyAtTime: 'OPEN',
                    details: JSON.stringify({ deliveredImmediately: true }),
                },
            });

            return {
                uuid: updated.uuid,
                status: updated.status,
                deliveryMethod: updated.deliveryMethod,
                publishedAt: updated.publishedAt,
                deliveredAt: updated.deliveredAt,
                scheduledAt: null,
            };
        });
    }

    // ═══════════════ SCHEDULED — جدولة حسب الحصص ═══════════════

    /**
     * نشر حسب الجدول:
     * - درس إضافي (ADDITIONAL) → نشر فوري (قرار وظيفي موثق)
     * - درس مع حصص والتاريخ مرّ → نشر فوري (درس متأخر)
     * - درس مع حصص والتاريخ مستقبلي → جدولة
     */
    private async deliverScheduled(lessonId: number, actorUserId: number) {
        const lesson = await this.prisma.lesson.findUnique({
            where: { id: lessonId },
            include: {
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

        if (!lesson) throw new BadRequestException('الدرس غير موجود');

        // قرار وظيفي موثق: الدروس الإضافية تُنشر فوراً مع SCHEDULED
        // لأنها غير مرتبطة بالجدول ولا معنى لجدولتها
        if (lesson.linkType !== 'SLOT_COVERAGE' || lesson.timetableSlots.length === 0) {
            this.logger.log(
                `Lesson ${lesson.uuid}: ADDITIONAL with SCHEDULED policy → publishing immediately`,
            );
            return this.deliverOpen(lessonId, actorUserId);
        }

        // حساب أقرب تاريخ حصة
        const scheduledAt = this.computeEarliestSlotDate(lesson.timetableSlots);

        if (!scheduledAt) {
            // لم نستطع حساب التاريخ → نشر فوري كـ fallback
            this.logger.warn(
                `Lesson ${lesson.uuid}: Could not compute scheduledAt → publishing immediately`,
            );
            return this.deliverOpen(lessonId, actorUserId);
        }

        const now = new Date();

        if (scheduledAt <= now) {
            // التاريخ مرّ → نشر فوري كدرس "متأخر"
            this.logger.log(
                `Lesson ${lesson.uuid}: scheduledAt (${scheduledAt.toISOString()}) has passed → publishing as late delivery`,
            );
            return this.prisma.$transaction(async (tx) => {
                const updated = await tx.lesson.update({
                    where: { id: lessonId },
                    data: {
                        status: 'PUBLISHED',
                        deliveryMethod: 'SCHEDULED',
                        publishedAt: now,
                        deliveredAt: now,
                        scheduledAt,
                    },
                });

                await tx.lessonDeliveryLog.create({
                    data: {
                        lessonId,
                        actorUserId,
                        action: 'PUBLISH',
                        policyAtTime: 'SCHEDULED',
                        details: JSON.stringify({
                            scheduledAt: scheduledAt.toISOString(),
                            lateDelivery: true,
                        }),
                    },
                });

                return {
                    uuid: updated.uuid,
                    status: updated.status,
                    deliveryMethod: updated.deliveryMethod,
                    publishedAt: updated.publishedAt,
                    deliveredAt: updated.deliveredAt,
                    scheduledAt: updated.scheduledAt,
                };
            });
        }

        // التاريخ مستقبلي → جدولة
        this.logger.log(
            `Lesson ${lesson.uuid}: scheduling for ${scheduledAt.toISOString()}`,
        );
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.lesson.update({
                where: { id: lessonId },
                data: {
                    status: 'SCHEDULED',
                    deliveryMethod: 'SCHEDULED',
                    scheduledAt,
                },
            });

            await tx.lessonDeliveryLog.create({
                data: {
                    lessonId,
                    actorUserId,
                    action: 'SCHEDULE',
                    policyAtTime: 'SCHEDULED',
                    details: JSON.stringify({
                        scheduledAt: scheduledAt.toISOString(),
                    }),
                },
            });

            return {
                uuid: updated.uuid,
                status: updated.status,
                deliveryMethod: updated.deliveryMethod,
                publishedAt: null,
                deliveredAt: null,
                scheduledAt: updated.scheduledAt,
            };
        });
    }

    // ═══════════════ Cron — نشر الدروس المجدولة المستحقة ═══════════════

    /**
     * تُستدعى من Cron Job — تبحث عن دروس SCHEDULED مستحقة وتنشرها
     * @returns عدد الدروس المنشورة
     */
    async publishDueLessons(): Promise<number> {
        const now = new Date();

        const dueLessons = await this.prisma.lesson.findMany({
            where: {
                status: 'SCHEDULED',
                scheduledAt: { lte: now },
                isDeleted: false,
            },
            select: { id: true, uuid: true, teacherId: true },
        });

        if (dueLessons.length === 0) return 0;

        this.logger.log(`Found ${dueLessons.length} due lesson(s) to publish`);

        let published = 0;

        for (const lesson of dueLessons) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    await tx.lesson.update({
                        where: { id: lesson.id },
                        data: {
                            status: 'PUBLISHED',
                            publishedAt: now,
                            deliveredAt: now,
                        },
                    });

                    // teacherId هو actorUserId في Cron (المعلم هو من جدول الدرس)
                    // نستخدم teacher.userId لأن teacherId = userId في الجدول
                    const teacher = await tx.teacher.findUnique({
                        where: { userId: lesson.teacherId },
                        select: { userId: true },
                    });

                    await tx.lessonDeliveryLog.create({
                        data: {
                            lessonId: lesson.id,
                            actorUserId: teacher?.userId ?? lesson.teacherId,
                            action: 'AUTO_PUBLISH',
                            policyAtTime: 'SCHEDULED',
                            details: JSON.stringify({
                                triggeredBy: 'CRON_JOB',
                                publishedAt: now.toISOString(),
                            }),
                        },
                    });
                });

                published++;
                this.logger.log(`Published lesson ${lesson.uuid}`);
            } catch (error) {
                this.logger.error(
                    `Failed to publish lesson ${lesson.uuid}: ${error}`,
                );
                // تابع مع الدروس الأخرى — retry في الدورة التالية
            }
        }

        return published;
    }

    // ═══════════════ حساب تاريخ النشر ═══════════════

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
