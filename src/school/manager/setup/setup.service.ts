// src/school/manager/setup/setup.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SetupStatusDto } from './dto/setup-status.dto';
import type { AcademicInitializationDto } from './dto/academic-initialization.dto';

@Injectable()
export class SetupService {
    constructor(private readonly prisma: PrismaService) { }

    async getSetupStatus(schoolId: number): Promise<SetupStatusDto> {
        // 1️⃣ السنة الحالية + الفصل الحالي
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: {
                terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
            },
        });

        const hasCurrentYear = !!currentYear;
        const termsCount = currentYear?.terms.length ?? 0;
        const currentTerm = currentYear?.terms.find((t) => t.isCurrent);

        // 2️⃣ الصفوف
        const gradesCount = await this.prisma.schoolGrade.count({
            where: { schoolId, isDeleted: false },
        });

        // 3️⃣ الشُعب
        const sectionsCount = await this.prisma.section.count({
            where: { grade: { schoolId }, isDeleted: false },
        });

        // 4️⃣ المعلمين
        const teachersCount = await this.prisma.user.count({
            where: { schoolId, userType: 'TEACHER', isDeleted: false, isActive: true },
        });

        // 5️⃣ المواد
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
            currentYearId: currentYear?.id,
            currentTermId: currentTerm?.id,
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

    async initializeAcademic(schoolId: number, dto: AcademicInitializationDto) {
        return this.prisma.$transaction(async (tx) => {
            // 1. تحقق من عدم وجود إعداد سابق
            const existingYear = await tx.year.findFirst({
                where: { schoolId, isDeleted: false },
            });

            if (existingYear) {
                throw new ConflictException('ACADEMIC_ALREADY_INITIALIZED');
            }

            // 2. إنشاء الصفوف
            for (const gradeDto of dto.grades) {
                if (gradeDto.dictionaryId) {
                    const dictionary = await tx.gradeDictionary.findFirst({
                        where: { id: gradeDto.dictionaryId, isDeleted: false, isActive: true },
                    });

                    if (!dictionary) {
                        throw new BadRequestException(`INVALID_DICTIONARY_GRADE_${gradeDto.dictionaryId}`);
                    }

                    gradeDto.displayName = gradeDto.displayName ?? dictionary.defaultName;
                    gradeDto.shortName = gradeDto.shortName ?? (dictionary.shortName ?? undefined);
                }

                if (!gradeDto.dictionaryId && !gradeDto.displayName) {
                    throw new BadRequestException('DISPLAY_NAME_REQUIRED');
                }

                const grade = await tx.schoolGrade.create({
                    data: {
                        schoolId,
                        dictionaryId: gradeDto.dictionaryId ?? null,
                        displayName: gradeDto.displayName,
                        shortName: gradeDto.shortName,
                        sortOrder: gradeDto.sortOrder,
                        isLocal: gradeDto.dictionaryId ? false : true,
                    },
                });

                // إنشاء شعبة "أ"
                await tx.section.create({
                    data: { gradeId: grade.id, name: 'أ', orderIndex: 1 },
                });
            }

            // 3. إنشاء السنة
            const year = await tx.year.create({
                data: {
                    schoolId,
                    name: dto.year.name,
                    startDate: dto.year.startDate ? new Date(dto.year.startDate) : null,
                    endDate: dto.year.endDate ? new Date(dto.year.endDate) : null,
                    isCurrent: true,
                },
            });

            // 4. إنشاء الفصول
            const termsCount = dto.year.terms?.length ?? dto.year.termsCount ?? 2;
            const termsToCreate = dto.year.terms ?? Array.from({ length: termsCount }, (_, i) => ({
                name: `الفصل ${i + 1}`,
                orderIndex: i + 1,
            }));

            for (const term of termsToCreate) {
                await tx.term.create({
                    data: {
                        yearId: year.id,
                        name: term.name,
                        orderIndex: term.orderIndex,
                        startDate: (term as any).startDate ? new Date((term as any).startDate) : null,
                        endDate: (term as any).endDate ? new Date((term as any).endDate) : null,
                        isCurrent: term.orderIndex === 1,
                    },
                });
            }

            return { success: true };
        });
    }
}
