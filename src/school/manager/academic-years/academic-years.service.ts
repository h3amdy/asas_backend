// src/school/manager/academic-years/academic-years.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateYearDto, UpdateYearDto, UpdateTermDto } from './dto/academic-years.dto';

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

        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
        if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
        await this.prisma.term.update({ where: { id: termId }, data });
        return this.prisma.term.findUnique({ where: { id: termId } });
    }

    /**
     * 🔒 Transaction: التقدم للفصل التالي
     */
    async advanceToNextTerm(schoolId: number, yearId: number) {
        const year = await this.prisma.year.findFirst({ where: { id: yearId, schoolId, isDeleted: false } });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');

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
}
