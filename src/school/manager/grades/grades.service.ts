// src/school/manager/grades/grades.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateGradeDto, UpdateGradeDto, CreateSectionDto, UpdateSectionDto } from './dto/grades.dto';

@Injectable()
export class GradesService {
    constructor(private readonly prisma: PrismaService) { }

    // ========== DICTIONARY ==========

    async listGradeDictionary() {
        return this.prisma.gradeDictionary.findMany({
            where: { isDeleted: false, isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
    }

    // ========== GRADES ==========

    async listGrades(schoolId: number) {
        return this.prisma.schoolGrade.findMany({
            where: { schoolId, isDeleted: false },
            orderBy: { sortOrder: 'asc' },
            include: {
                _count: { select: { sections: { where: { isDeleted: false } } } },
                sections: {
                    where: { isDeleted: false },
                    select: {
                        id: true, name: true, orderIndex: true,
                        _count: { select: { enrollments: { where: { isDeleted: false, isCurrent: true } } } },
                    },
                },
            },
        });
    }

    async createGrade(schoolId: number, dto: CreateGradeDto) {
        try {
            const gradeId = await this.prisma.$transaction(async (tx) => {
                if (dto.dictionaryId) {
                    const dictionary = await tx.gradeDictionary.findFirst({
                        where: { id: dto.dictionaryId, isDeleted: false, isActive: true },
                    });
                    if (!dictionary) {
                        throw new BadRequestException('INVALID_DICTIONARY_GRADE');
                    }
                    dto.displayName = dto.displayName ?? dictionary.defaultName;
                    dto.shortName = dto.shortName ?? (dictionary.shortName ?? undefined);
                }

                if (!dto.dictionaryId && !dto.displayName) {
                    throw new BadRequestException('DISPLAY_NAME_REQUIRED');
                }

                const grade = await tx.schoolGrade.create({
                    data: {
                        schoolId,
                        dictionaryId: dto.dictionaryId ?? null,
                        displayName: dto.displayName!,
                        shortName: dto.shortName,
                        sortOrder: dto.sortOrder,
                        stage: (dto.stage as any) ?? null,
                        isLocal: dto.isLocal ?? !dto.dictionaryId,
                    },
                });

                await tx.section.create({
                    data: { gradeId: grade.id, name: 'أ', orderIndex: 1 },
                });

                return grade.id;
            });

            return this.getGradeById(schoolId, gradeId);
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                const target = (e.meta?.target as string[]) ?? [];
                if (target.includes('dictionary_id')) {
                    throw new ConflictException('GRADE_DICTIONARY_ALREADY_ADDED');
                }
                throw new ConflictException('GRADE_NAME_DUPLICATE');
            }
            throw e;
        }
    }

    async createGradesBulk(schoolId: number, grades: CreateGradeDto[]) {
        if (!grades.length) {
            throw new BadRequestException('EMPTY_GRADES_LIST');
        }

        try {
            const createdIds = await this.prisma.$transaction(async (tx) => {
                const ids: number[] = [];

                for (const dto of grades) {
                    if (dto.dictionaryId) {
                        const dictionary = await tx.gradeDictionary.findFirst({
                            where: { id: dto.dictionaryId, isDeleted: false, isActive: true },
                        });
                        if (!dictionary) {
                            throw new BadRequestException(`INVALID_DICTIONARY_GRADE_${dto.dictionaryId}`);
                        }
                        dto.displayName = dto.displayName ?? dictionary.defaultName;
                        dto.shortName = dto.shortName ?? (dictionary.shortName ?? undefined);
                    }

                    if (!dto.dictionaryId && !dto.displayName) {
                        throw new BadRequestException('DISPLAY_NAME_REQUIRED');
                    }

                    const grade = await tx.schoolGrade.create({
                        data: {
                            schoolId,
                            dictionaryId: dto.dictionaryId ?? null,
                            displayName: dto.displayName!,
                            shortName: dto.shortName,
                            sortOrder: dto.sortOrder,
                            stage: (dto.stage as any) ?? null,
                            isLocal: !dto.dictionaryId,
                        },
                    });

                    await tx.section.create({
                        data: { gradeId: grade.id, name: 'أ', orderIndex: 1 },
                    });

                    ids.push(grade.id);
                }

                return ids;
            });

            return this.prisma.schoolGrade.findMany({
                where: { id: { in: createdIds } },
                orderBy: { sortOrder: 'asc' },
                include: {
                    _count: { select: { sections: { where: { isDeleted: false } } } },
                    sections: { where: { isDeleted: false }, select: { id: true, name: true, orderIndex: true } },
                },
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                const target = (e.meta?.target as string[]) ?? [];
                if (target.includes('dictionary_id')) {
                    throw new ConflictException('ONE_OR_MORE_DICTIONARY_GRADES_ALREADY_ADDED');
                }
                throw new ConflictException('GRADE_NAME_DUPLICATE');
            }
            throw e;
        }
    }

    async getGradeById(schoolId: number, gradeId: number) {
        const grade = await this.prisma.schoolGrade.findFirst({
            where: { id: gradeId, schoolId, isDeleted: false },
            include: {
                sections: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
                _count: { select: { sections: { where: { isDeleted: false } } } },
            },
        });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');
        return grade;
    }

    async updateGrade(schoolId: number, gradeId: number, dto: UpdateGradeDto) {
        const grade = await this.prisma.schoolGrade.findFirst({ where: { id: gradeId, schoolId, isDeleted: false } });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        try {
            const data: Record<string, any> = {};
            if (dto.displayName !== undefined) data.displayName = dto.displayName;
            if (dto.shortName !== undefined) data.shortName = dto.shortName;
            if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

            await this.prisma.schoolGrade.update({ where: { id: gradeId }, data });
            return this.getGradeById(schoolId, gradeId);
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new ConflictException('GRADE_NAME_DUPLICATE');
            }
            throw e;
        }
    }

    async deleteGrade(schoolId: number, gradeId: number) {
        const grade = await this.prisma.schoolGrade.findFirst({ where: { id: gradeId, schoolId, isDeleted: false } });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        const hasSections = await this.prisma.section.count({
            where: { gradeId, isDeleted: false, enrollments: { some: { isDeleted: false } } },
        });
        if (hasSections > 0) throw new BadRequestException('GRADE_HAS_STUDENTS');

        await this.prisma.schoolGrade.update({
            where: { id: gradeId },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    async toggleGradeActive(schoolId: number, gradeId: number, isActive: boolean) {
        const grade = await this.prisma.schoolGrade.findFirst({ where: { id: gradeId, schoolId, isDeleted: false } });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        await this.prisma.schoolGrade.update({ where: { id: gradeId }, data: { isActive } });
        return this.getGradeById(schoolId, gradeId);
    }

    // ========== SECTIONS ==========

    async listSections(schoolId: number, gradeId: number) {
        const grade = await this.prisma.schoolGrade.findFirst({ where: { id: gradeId, schoolId, isDeleted: false } });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        return this.prisma.section.findMany({
            where: { gradeId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                _count: { select: { enrollments: { where: { isDeleted: false, isCurrent: true } } } },
            },
        });
    }

    async createSection(schoolId: number, gradeId: number, dto: CreateSectionDto) {
        const grade = await this.prisma.schoolGrade.findFirst({ where: { id: gradeId, schoolId, isDeleted: false } });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        try {
            return await this.prisma.section.create({
                data: { gradeId, name: dto.name, orderIndex: dto.orderIndex },
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                const target = (e.meta?.target as string[]) ?? [];
                if (target.includes('name')) throw new ConflictException('SECTION_NAME_DUPLICATE');
                if (target.includes('order_index')) throw new ConflictException('SECTION_ORDER_DUPLICATE');
                throw new ConflictException('SECTION_DUPLICATE');
            }
            throw e;
        }
    }

    async updateSection(schoolId: number, sectionId: number, dto: UpdateSectionDto) {
        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false, grade: { schoolId, isDeleted: false } },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        try {
            const data: Record<string, any> = {};
            if (dto.name !== undefined) data.name = dto.name;
            if (dto.orderIndex !== undefined) data.orderIndex = dto.orderIndex;
            return await this.prisma.section.update({ where: { id: sectionId }, data });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new ConflictException('SECTION_DUPLICATE');
            }
            throw e;
        }
    }

    async deleteSection(schoolId: number, sectionId: number) {
        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false, grade: { schoolId, isDeleted: false } },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        const hasStudents = await this.prisma.studentEnrollment.count({
            where: { sectionId, isDeleted: false, isCurrent: true },
        });
        if (hasStudents > 0) throw new BadRequestException('SECTION_HAS_STUDENTS');

        await this.prisma.section.update({
            where: { id: sectionId },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    async toggleSectionActive(schoolId: number, sectionId: number, isActive: boolean) {
        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, isDeleted: false, grade: { schoolId, isDeleted: false } },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        await this.prisma.section.update({
            where: { id: sectionId },
            data: { isActive },
        });

        return this.prisma.section.findFirst({
            where: { id: sectionId },
            include: {
                _count: { select: { enrollments: { where: { isDeleted: false, isCurrent: true } } } },
            },
        });
    }
}
