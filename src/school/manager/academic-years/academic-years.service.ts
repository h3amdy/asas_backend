// src/school/manager/academic-years/academic-years.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateYearDto, UpdateYearDto, UpdateTermDto } from './dto/academic-years.dto';

const TERM_NAMES = ['الفصل الأول', 'الفصل الثاني', 'الفصل الثالث'];

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
     * تواريخ السنة تُشتق دائماً من الفصول إذا أُرسلت تواريخ
     */
    async createYear(schoolId: number, dto: CreateYearDto) {
        const yearId = await this.prisma.$transaction(async (tx) => {
            // 1️⃣ إلغاء السنة الحالية
            await tx.year.updateMany({
                where: { schoolId, isCurrent: true, isDeleted: false },
                data: { isCurrent: false },
            });

            // 2️⃣ تجهيز الفصول
            const termsCount = dto.terms?.length ?? dto.termsCount ?? 2;
            const termsToCreate = dto.terms ?? Array.from({ length: termsCount }, (_, i) => ({
                name: TERM_NAMES[i] ?? `الفصل ${i + 1}`,
                orderIndex: i + 1,
            }));

            // 3️⃣ حساب تواريخ السنة من الفصول (إذا وجدت تواريخ)
            const termDates = termsToCreate
                .filter((t: any) => t.startDate && t.endDate)
                .map((t: any) => ({ start: new Date(t.startDate), end: new Date(t.endDate) }));

            let yearStart: Date | null = null;
            let yearEnd: Date | null = null;

            if (termDates.length > 0) {
                yearStart = termDates.reduce((min, t) => t.start < min ? t.start : min, termDates[0].start);
                yearEnd = termDates.reduce((max, t) => t.end > max ? t.end : max, termDates[0].end);
            }

            // 4️⃣ إنشاء السنة
            const year = await tx.year.create({
                data: {
                    schoolId,
                    name: dto.name,
                    startDate: yearStart,
                    endDate: yearEnd,
                    isCurrent: true,
                },
            });

            // 5️⃣ إنشاء الفصول
            for (const t of termsToCreate) {
                await tx.term.create({
                    data: {
                        yearId: year.id,
                        name: t.name,
                        orderIndex: t.orderIndex,
                        startDate: (t as any).startDate ? new Date((t as any).startDate) : null,
                        endDate: (t as any).endDate ? new Date((t as any).endDate) : null,
                        isCurrent: t.orderIndex === 1,
                    },
                });
            }

            return year.id;
        });

        return this.getYearById(yearId);
    }

    async getYearById(yearId: number) {
        const year = await this.prisma.year.findFirst({
            where: { id: yearId, isDeleted: false },
            include: { terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } } },
        });
        if (!year) throw new NotFoundException('YEAR_NOT_FOUND');
        return year;
    }

    async updateYear(yearId: number, dto: UpdateYearDto) {
        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
        if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
        await this.prisma.year.update({ where: { id: yearId }, data });
        return this.getYearById(yearId);
    }

    async getCurrentYear(schoolId: number) {
        return this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: { terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } } },
        });
    }

    async updateTerm(termId: number, dto: UpdateTermDto) {
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
    async advanceToNextTerm(yearId: number) {
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

        return this.getYearById(yearId);
    }
}
