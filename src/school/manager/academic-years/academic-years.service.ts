// src/school/manager/academic-years/academic-years.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateYearDto, UpdateYearDto, UpdateTermDto, AddTermDto, StartTermDto, CopyTimetableDto } from './dto/academic-years.dto';

@Injectable()
export class AcademicYearsService {
    constructor(private readonly prisma: PrismaService) { }

    async listYears(schoolId: number) {
        return this.prisma.year.findMany({
            where: { schoolId, isDeleted: false },
            orderBy: { createdAt: 'desc' },
            include: {
                terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
            },
        });
    }

    /**
     * 🔒 Transaction: إنشاء سنة + إلغاء الحالية + إنشاء فصول
     * تواريخ الفصول إجبارية دائماً — لا توجد تواريخ للسنة
     */
    async createYear(schoolId: number, dto: CreateYearDto) {
        // التحقق من التسلسل الزمني للفصول
        const sortedTerms = [...dto.terms].sort((a, b) => a.orderIndex - b.orderIndex);

        for (let i = 0; i < sortedTerms.length; i++) {
            const term = sortedTerms[i];
            const start = new Date(term.startDate);
            const end = new Date(term.endDate);

            if (end <= start) {
                throw new BadRequestException(`TERM_${term.orderIndex}_END_BEFORE_START`);
            }

            if (i > 0) {
                const prevEnd = new Date(sortedTerms[i - 1].endDate);
                if (start <= prevEnd) {
                    throw new BadRequestException(
                        `TERM_${term.orderIndex}_OVERLAPS_WITH_TERM_${sortedTerms[i - 1].orderIndex}`,
                    );
                }
            }
        }

        const yearId = await this.prisma.$transaction(async (tx) => {
            // 1️⃣ إلغاء السنة الحالية
            await tx.year.updateMany({
                where: { schoolId, isCurrent: true, isDeleted: false },
                data: { isCurrent: false },
            });

            // 2️⃣ إنشاء السنة (بدون تواريخ — مشتقة من الفصول)
            const year = await tx.year.create({
                data: {
                    schoolId,
                    name: dto.name,
                    isCurrent: true,
                },
            });

            // 3️⃣ إنشاء الفصول (تواريخ إجبارية)
            for (const t of sortedTerms) {
                await tx.term.create({
                    data: {
                        yearId: year.id,
                        name: t.name,
                        orderIndex: t.orderIndex,
                        startDate: new Date(t.startDate),
                        endDate: new Date(t.endDate),
                        isCurrent: t.orderIndex === 1,
                    },
                });
            }

            return year.id;
        });

        return this.getYearById(schoolId, yearId);
    }

    async getYearById(schoolId: number, yearId: number) {
        const year = await this.prisma.year.findFirst({
            where: { id: yearId, schoolId, isDeleted: false },
            include: { terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } } },
        });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');
        return year;
    }

    async updateYear(schoolId: number, yearId: number, dto: UpdateYearDto) {
        const year = await this.prisma.year.findFirst({ where: { id: yearId, schoolId, isDeleted: false } });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');

        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        await this.prisma.year.update({ where: { id: yearId }, data });
        return this.getYearById(schoolId, yearId);
    }

    async getCurrentYear(schoolId: number) {
        return this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: { terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } } },
        });
    }

    async updateTerm(schoolId: number, termId: number, dto: UpdateTermDto) {
        const term = await this.prisma.term.findFirst({
            where: { id: termId, isDeleted: false, year: { schoolId, isDeleted: false } },
        });
        if (!term) throw new NotFoundException('TERM_NOT_FOUND');

        // 🛡️ SRS §7.1-3: لا يُعدّل فصل منتهٍ
        if (term.endDate && term.endDate < new Date() && !term.isCurrent) {
            throw new BadRequestException('TERM_ALREADY_FINISHED');
        }

        // 🛡️ SRS §7.1-4: لا يُعدّل startDate لفصل حالي
        if (term.isCurrent && dto.startDate !== undefined) {
            throw new BadRequestException('CANNOT_CHANGE_START_DATE_OF_CURRENT_TERM');
        }

        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
        if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);

        // 🛡️ SRS §7.1-5: endDate > startDate
        const finalStart = data.startDate ?? term.startDate;
        const finalEnd = data.endDate ?? term.endDate;
        if (finalStart && finalEnd && finalEnd <= finalStart) {
            throw new BadRequestException('END_DATE_BEFORE_START_DATE');
        }

        // 🛡️ SRS §5.2: كشف تداخل التواريخ مع فصول أخرى
        if (finalStart && finalEnd) {
            const overlapping = await this.prisma.term.findFirst({
                where: {
                    yearId: term.yearId,
                    id: { not: termId },
                    isDeleted: false,
                    startDate: { lt: finalEnd },
                    endDate: { gt: finalStart },
                },
            });
            if (overlapping) {
                throw new ConflictException('TERM_OVERLAP');
            }
        }

        await this.prisma.term.update({ where: { id: termId }, data });
        return this.prisma.term.findUnique({ where: { id: termId } });
    }

    /**
     * UC-T06: إضافة فصل دراسي إلى سنة قائمة
     */
    async addTerm(schoolId: number, yearId: number, dto: AddTermDto) {
        const year = await this.prisma.year.findFirst({
            where: { id: yearId, schoolId, isDeleted: false },
        });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');

        // 🛡️ السنة يجب أن تكون حالية
        if (!year.isCurrent) {
            throw new BadRequestException('YEAR_NOT_CURRENT');
        }

        const start = new Date(dto.startDate);
        const end = new Date(dto.endDate);

        // 🛡️ endDate > startDate
        if (end <= start) {
            throw new BadRequestException('END_DATE_BEFORE_START_DATE');
        }

        // جلب الفصول الحالية
        const existingTerms = await this.prisma.term.findMany({
            where: { yearId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
        });

        // 🛡️ حد أقصى 3 فصول
        if (existingTerms.length >= 3) {
            throw new ConflictException('MAX_TERMS_LIMIT');
        }

        // 🛡️ الفصل الجديد يجب أن يكون بعد آخر فصل
        if (existingTerms.length > 0) {
            const lastTerm = existingTerms[existingTerms.length - 1];
            if (lastTerm.endDate && start <= lastTerm.endDate) {
                throw new ConflictException('TERM_DATE_OVERLAP');
            }
        }

        // 🛡️ كشف تداخل عام
        const overlapping = await this.prisma.term.findFirst({
            where: {
                yearId,
                isDeleted: false,
                startDate: { lt: end },
                endDate: { gt: start },
            },
        });
        if (overlapping) {
            throw new ConflictException('TERM_DATE_OVERLAP');
        }

        // حساب orderIndex تلقائياً
        const maxOrder = existingTerms.length > 0
            ? Math.max(...existingTerms.map(t => t.orderIndex))
            : 0;

        await this.prisma.term.create({
            data: {
                yearId,
                name: dto.name,
                orderIndex: maxOrder + 1,
                startDate: start,
                endDate: end,
                isCurrent: false,
            },
        });

        return this.getYearById(schoolId, yearId);
    }

    /**
     * 🔒 Transaction: التقدم للفصل التالي
     */
    async advanceToNextTerm(schoolId: number, yearId: number) {
        const year = await this.prisma.year.findFirst({ where: { id: yearId, schoolId, isDeleted: false } });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');

        // 🛡️ SRS §7.2-1: التقدم فقط في السنة الحالية
        if (!year.isCurrent) {
            throw new BadRequestException('YEAR_NOT_CURRENT');
        }

        await this.prisma.$transaction(async (tx) => {
            const terms = await tx.term.findMany({
                where: { yearId, isDeleted: false },
                orderBy: { orderIndex: 'asc' },
            });

            const currentIdx = terms.findIndex((t) => t.isCurrent);
            if (currentIdx === -1 || currentIdx >= terms.length - 1) {
                throw new BadRequestException('NO_NEXT_TERM');
            }

            await tx.term.update({ where: { id: terms[currentIdx].id }, data: { isCurrent: false } });
            await tx.term.update({ where: { id: terms[currentIdx + 1].id }, data: { isCurrent: true } });
        });

        return this.getYearById(schoolId, yearId);
    }

    /**
     * 🗑️ حذف فصل (Soft Delete)
     */
    async deleteTerm(schoolId: number, termId: number) {
        const term = await this.prisma.term.findFirst({
            where: { id: termId, isDeleted: false, year: { schoolId, isDeleted: false } },
        });
        if (!term) throw new NotFoundException('TERM_NOT_FOUND');

        // 🛡️ لا يُحذف الفصل الحالي
        if (term.isCurrent) {
            throw new BadRequestException('CANNOT_DELETE_CURRENT_TERM');
        }

        // 🛡️ INV-05: لا يُحذف فصل منتهٍ أو بدأ
        if (term.endDate && term.endDate < new Date()) {
            throw new BadRequestException('CANNOT_DELETE_FINISHED_TERM');
        }
        if (term.startDate && term.startDate < new Date()) {
            throw new BadRequestException('CANNOT_DELETE_STARTED_TERM');
        }

        // 🛡️ السنة يجب أن تبقى بفصل واحد على الأقل
        const termsCount = await this.prisma.term.count({
            where: { yearId: term.yearId, isDeleted: false },
        });
        if (termsCount <= 1) {
            throw new BadRequestException('LAST_TERM_CANNOT_BE_DELETED');
        }

        await this.prisma.term.update({
            where: { id: termId },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        return { success: true };
    }

    // ═══════════════════════════════════════════════
    // ADM-010a: إنهاء فصل دراسي (End Current Term)
    // ═══════════════════════════════════════════════

    /**
     * 🔒 Transaction: إنهاء الفصل الحالي
     * يُحدّث endDate إلى اليوم (إن لم ينتهِ) ويُلغي isCurrent
     */
    async endCurrentTerm(schoolId: number, yearId: number) {
        const year = await this.prisma.year.findFirst({ where: { id: yearId, schoolId, isDeleted: false } });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');
        if (!year.isCurrent) throw new BadRequestException('YEAR_NOT_CURRENT');

        const currentTerm = await this.prisma.term.findFirst({
            where: { yearId, isCurrent: true, isDeleted: false },
        });
        if (!currentTerm) throw new BadRequestException('NO_CURRENT_TERM');

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await this.prisma.$transaction(async (tx) => {
            // تحديث تاريخ النهاية إلى اليوم إذا لم ينتهِ بعد
            const updateData: Record<string, any> = { isCurrent: false };
            if (!currentTerm.endDate || currentTerm.endDate > today) {
                updateData.endDate = today;
            }
            await tx.term.update({ where: { id: currentTerm.id }, data: updateData });
        });

        return this.getYearById(schoolId, yearId);
    }

    // ═══════════════════════════════════════════════
    // ADM-010b: بدء فصل دراسي (Start Term)
    // ═══════════════════════════════════════════════

    /**
     * 🔒 Transaction: بدء فصل دراسي محدد
     * يُحدّث startDate إلى اليوم (إن لم يحن) ويجعله isCurrent = true
     * اختيارياً: نسخ الجدول الدراسي من الفصل السابق
     */
    async startTerm(schoolId: number, yearId: number, termId: number, dto: StartTermDto) {
        const year = await this.prisma.year.findFirst({ where: { id: yearId, schoolId, isDeleted: false } });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');
        if (!year.isCurrent) throw new BadRequestException('YEAR_NOT_CURRENT');

        // 🛡️ لا يوجد فصل حالي حالياً (يجب إنهاء السابق أولاً)
        const activeTerm = await this.prisma.term.findFirst({
            where: { yearId, isCurrent: true, isDeleted: false },
        });
        if (activeTerm) throw new BadRequestException('CURRENT_TERM_STILL_ACTIVE');

        const targetTerm = await this.prisma.term.findFirst({
            where: { id: termId, yearId, isDeleted: false },
        });
        if (!targetTerm) throw new NotFoundException('TERM_NOT_FOUND');

        // 🛡️ التسلسل: لا يمكن بدء فصل قبل إنهاء السابق
        const terms = await this.prisma.term.findMany({
            where: { yearId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
        });
        const targetIdx = terms.findIndex(t => t.id === termId);
        if (targetIdx > 0) {
            const prevTerm = terms[targetIdx - 1];
            if (prevTerm.isCurrent) {
                throw new BadRequestException('PREVIOUS_TERM_STILL_ACTIVE');
            }
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await this.prisma.$transaction(async (tx) => {
            // تحديث startDate إلى اليوم إذا لم يحن بعد
            const updateData: Record<string, any> = { isCurrent: true };
            if (!targetTerm.startDate || targetTerm.startDate > today) {
                updateData.startDate = today;
            }
            await tx.term.update({ where: { id: termId }, data: updateData });
        });

        // نسخ الجدول من الفصل السابق (افتراضي: true)
        const shouldCopy = dto.copyTimetable !== false;
        if (shouldCopy && targetIdx > 0) {
            const prevTerm = terms[targetIdx - 1];
            try {
                await this._copyTimetableBetweenTerms(yearId, prevTerm.id, termId);
            } catch (e) {
                // لا نوقف العملية إذا فشل نسخ الجدول — العملية الرئيسية (بدء الفصل) أهم
                console.warn(`[startTerm] timetable copy failed: ${e}`);
            }
        }

        return this.getYearById(schoolId, yearId);
    }

    // ═══════════════════════════════════════════════
    // ADM-010c: نسخ الجدول الدراسي بين الفصول
    // ═══════════════════════════════════════════════

    /**
     * نسخ جميع جداول الحصص من فصل مصدر إلى فصل هدف
     * يتم نسخ: Timetable (لكل شعبة) + TimetableSlots
     */
    async copyTimetable(schoolId: number, yearId: number, dto: CopyTimetableDto) {
        const year = await this.prisma.year.findFirst({ where: { id: yearId, schoolId, isDeleted: false } });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');

        // التحقق من الفصول
        const sourceTerm = await this.prisma.term.findFirst({
            where: { id: dto.sourceTermId, yearId, isDeleted: false },
        });
        if (!sourceTerm) throw new NotFoundException('SOURCE_TERM_NOT_FOUND');

        const targetTerm = await this.prisma.term.findFirst({
            where: { id: dto.targetTermId, yearId, isDeleted: false },
        });
        if (!targetTerm) throw new NotFoundException('TARGET_TERM_NOT_FOUND');

        return this._copyTimetableBetweenTerms(yearId, dto.sourceTermId, dto.targetTermId);
    }

    /**
     * 🔧 Helper: نسخ الجدول الدراسي بين فصلين
     */
    private async _copyTimetableBetweenTerms(yearId: number, sourceTermId: number, targetTermId: number) {
        // جلب جميع جداول الفصل المصدر
        const sourceTimetables = await this.prisma.timetable.findMany({
            where: { yearId, termId: sourceTermId, isDeleted: false },
            include: {
                slots: { where: { isDeleted: false } },
            },
        });

        if (sourceTimetables.length === 0) {
            return { copied: 0, skipped: 0, message: 'NO_SOURCE_TIMETABLES' };
        }

        let copied = 0;
        let skipped = 0;

        for (const srcTimetable of sourceTimetables) {
            // التحقق: هل يوجد جدول في الفصل الهدف لنفس الشعبة؟
            const existingTarget = await this.prisma.timetable.findFirst({
                where: {
                    sectionId: srcTimetable.sectionId,
                    yearId,
                    termId: targetTermId,
                    isDeleted: false,
                },
                include: { slots: { where: { isDeleted: false } } },
            });

            // إذا يوجد جدول مع حصص → لا نستبدل
            if (existingTarget && existingTarget.slots.length > 0) {
                skipped++;
                continue;
            }

            // إنشاء أو استخدام الجدول الموجود (فارغ)
            const targetTimetable = existingTarget ?? await this.prisma.timetable.create({
                data: {
                    sectionId: srcTimetable.sectionId,
                    yearId,
                    termId: targetTermId,
                },
            });

            // نسخ الحصص
            for (const slot of srcTimetable.slots) {
                await this.prisma.timetableSlot.upsert({
                    where: {
                        timetableId_weekday_lessonNumber: {
                            timetableId: targetTimetable.id,
                            weekday: slot.weekday,
                            lessonNumber: slot.lessonNumber,
                        },
                    },
                    create: {
                        timetableId: targetTimetable.id,
                        weekday: slot.weekday,
                        lessonNumber: slot.lessonNumber,
                        subjectSectionId: slot.subjectSectionId,
                    },
                    update: {
                        subjectSectionId: slot.subjectSectionId,
                        isDeleted: false,
                        deletedAt: null,
                    },
                });
            }

            copied++;
        }

        return { copied, skipped, total: sourceTimetables.length };
    }
}
