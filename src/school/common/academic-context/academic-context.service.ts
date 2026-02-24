// src/school/common/academic-context/academic-context.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AcademicContextService {
    constructor(private readonly prisma: PrismaService) { }

    async getContext(schoolId: number) {
        const year = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: {
                terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
            },
        });

        if (!year) {
            return { academicYear: null, term: null };
        }

        const currentTerm = year.terms.find((t) => t.isCurrent) ?? null;

        return {
            academicYear: {
                uuid: year.uuid,
                name: year.name,
                startDate: year.startDate,
                endDate: year.endDate,
            },
            term: currentTerm
                ? {
                    uuid: currentTerm.uuid,
                    name: currentTerm.name,
                    orderIndex: currentTerm.orderIndex,
                    startDate: currentTerm.startDate,
                    endDate: currentTerm.endDate,
                }
                : null,
        };
    }
}
