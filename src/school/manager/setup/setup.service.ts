// src/school/manager/setup/setup.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SetupStatusDto } from './dto/setup-status.dto';
import type { AcademicInitializationDto } from './dto/academic-initialization.dto';

@Injectable()
export class SetupService {
    constructor(private readonly prisma: PrismaService) { }

    // ==================== حالة التهيئة ====================

    async getSetupStatus(schoolId: number): Promise<SetupStatusDto> {
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: {
                terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
            },
        });

        const hasCurrentYear = !!currentYear;
        const termsCount = currentYear?.terms.length ?? 0;
        const currentTerm = currentYear?.terms.find((t) => t.isCurrent);

        const gradesCount = await this.prisma.schoolGrade.count({
            where: { schoolId, isDeleted: false },
        });

        const sectionsCount = await this.prisma.section.count({
            where: { grade: { schoolId }, isDeleted: false },
        });

        const teachersCount = await this.prisma.user.count({
            where: { schoolId, userType: 'TEACHER', isDeleted: false, isActive: true },
        });

        const subjectsCount = await this.prisma.subject.count({
            where: { schoolId, isDeleted: false },
        });

        const hasGrades = gradesCount > 0;
        const hasSections = sectionsCount > 0;
        const hasTeachers = teachersCount > 0;
        const hasSubjects = subjectsCount > 0;

        const isAcademicReady = hasCurrentYear && termsCount > 0 && hasGrades && hasSections;
        const isReadyForStudents = isAcademicReady;
        const isFullyReady = isAcademicReady && hasSubjects && hasTeachers;

        return {
            hasCurrentYear,
            currentYearUuid: currentYear?.uuid,
            currentTermUuid: currentTerm?.uuid,
            termsCount,
            hasGrades,
            gradesCount,
            hasSections,
            sectionsCount,
            hasTeachers,
            teachersCount,
            hasSubjects,
            subjectsCount,
            isAcademicReady,
            isReadyForStudents,
            isFullyReady,
        };
    }

    // ==================== التهيئة الأولى ====================

    async initializeAcademic(schoolId: number, dto: AcademicInitializationDto) {
        // ───── التحقق المسبق (خارج Transaction) ─────

        // 1. ترتيب الفصول + التحقق من التسلسل الزمني
        const sortedTerms = [...dto.year.terms].sort((a, b) => a.orderIndex - b.orderIndex);

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

        // 2. الصف المخصص يجب أن يحتوي displayName و stage
        for (const g of dto.grades) {
            if (!g.dictionaryId) {
                if (!g.displayName) throw new BadRequestException('DISPLAY_NAME_REQUIRED');
                if (!g.stage) throw new BadRequestException('STAGE_REQUIRED_FOR_CUSTOM_GRADE');
            }
        }


        // ───── Transaction ─────
        return this.prisma.$transaction(async (tx) => {
            // 4. تحقق من عدم وجود إعداد سابق
            const existingYear = await tx.year.findFirst({
                where: { schoolId, isDeleted: false },
            });
            if (existingYear) {
                throw new ConflictException('ACADEMIC_ALREADY_INITIALIZED');
            }

            // 5. إنشاء الصفوف
            for (const gradeDto of dto.grades) {
                let stage = gradeDto.stage as any;

                if (gradeDto.dictionaryId) {
                    const dictionary = await tx.gradeDictionary.findFirst({
                        where: { id: gradeDto.dictionaryId, isDeleted: false, isActive: true },
                    });
                    if (!dictionary) {
                        throw new BadRequestException(`INVALID_DICTIONARY_GRADE_${gradeDto.dictionaryId}`);
                    }

                    gradeDto.displayName = gradeDto.displayName ?? dictionary.defaultName;
                    gradeDto.shortName = gradeDto.shortName ?? (dictionary.shortName ?? undefined);
                    stage = gradeDto.stage ?? (dictionary.stage as any) ?? null;
                }

                const grade = await tx.schoolGrade.create({
                    data: {
                        schoolId,
                        dictionaryId: gradeDto.dictionaryId ?? null,
                        displayName: gradeDto.displayName!,
                        shortName: gradeDto.shortName,
                        sortOrder: gradeDto.sortOrder,
                        stage: stage ?? null,
                        isLocal: !gradeDto.dictionaryId,
                    },
                });

                await tx.section.create({
                    data: { gradeId: grade.id, name: 'أ', orderIndex: 1 },
                });
            }

            // 6. إنشاء السنة (بدون تواريخ)
            const year = await tx.year.create({
                data: {
                    schoolId,
                    name: dto.year.name,
                    isCurrent: true,
                },
            });

            // 7. إنشاء الفصول
            for (const term of sortedTerms) {
                await tx.term.create({
                    data: {
                        yearId: year.id,
                        name: term.name,
                        orderIndex: term.orderIndex,
                        startDate: new Date(term.startDate),
                        endDate: new Date(term.endDate),
                        isCurrent: term.orderIndex === 1,
                    },
                });
            }

            return { success: true };
        });
    }

}
