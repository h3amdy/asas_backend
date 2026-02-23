// src/school/manager/subjects/subjects.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSubjectDto, UpdateSubjectDto, AssignSubjectSectionsDto, AssignTeacherDto } from './dto/subjects.dto';

@Injectable()
export class SubjectsService {
    constructor(private readonly prisma: PrismaService) { }

    async listSubjects(schoolId: number, gradeId?: number) {
        return this.prisma.subject.findMany({
            where: { schoolId, isDeleted: false, ...(gradeId ? { gradeId } : {}) },
            include: {
                grade: { select: { displayName: true } },
                subjectSections: {
                    where: { isDeleted: false },
                    include: {
                        section: { select: { name: true } },
                        teachers: {
                            where: { isDeleted: false },
                            include: { teacher: { include: { user: { select: { name: true } } } } },
                        },
                    },
                },
            },
            orderBy: { displayName: 'asc' },
        });
    }

    async createSubject(schoolId: number, dto: CreateSubjectDto) {
        const subject = await this.prisma.subject.create({
            data: {
                schoolId,
                gradeId: dto.gradeId,
                displayName: dto.displayName,
                shortName: dto.shortName,
                dictionaryId: dto.dictionaryId ?? null,
                coverMediaAssetId: dto.coverMediaAssetId ?? null,
            },
        });

        // Auto-assign to all sections of the grade
        const sections = await this.prisma.section.findMany({
            where: { gradeId: dto.gradeId, isDeleted: false },
        });
        for (const section of sections) {
            await this.prisma.subjectSection.create({
                data: { subjectId: subject.id, sectionId: section.id },
            });
        }

        return this.getSubjectById(subject.id);
    }

    async getSubjectById(subjectId: number) {
        const subject = await this.prisma.subject.findFirst({
            where: { id: subjectId, isDeleted: false },
            include: {
                grade: { select: { displayName: true } },
                subjectSections: {
                    where: { isDeleted: false },
                    include: {
                        section: { select: { id: true, name: true } },
                        teachers: {
                            where: { isDeleted: false },
                            include: { teacher: { include: { user: { select: { uuid: true, name: true } } } } },
                        },
                    },
                },
            },
        });
        if (!subject) throw new NotFoundException('SUBJECT_NOT_FOUND');
        return subject;
    }

    async updateSubject(subjectId: number, dto: UpdateSubjectDto) {
        const data: Record<string, any> = {};
        if (dto.displayName !== undefined) data.displayName = dto.displayName;
        if (dto.shortName !== undefined) data.shortName = dto.shortName;
        if (dto.coverMediaAssetId !== undefined) data.coverMediaAssetId = dto.coverMediaAssetId;
        await this.prisma.subject.update({ where: { id: subjectId }, data });
        return this.getSubjectById(subjectId);
    }

    async deleteSubject(subjectId: number) {
        await this.prisma.subject.update({
            where: { id: subjectId },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    async assignToSections(subjectId: number, dto: AssignSubjectSectionsDto) {
        for (const sectionId of dto.sectionIds) {
            await this.prisma.subjectSection.upsert({
                where: { subjectId_sectionId: { subjectId, sectionId } },
                create: { subjectId, sectionId },
                update: { isDeleted: false, deletedAt: null },
            });
        }
        return this.getSubjectById(subjectId);
    }

    async removeFromSection(subjectId: number, sectionId: number) {
        await this.prisma.subjectSection.updateMany({
            where: { subjectId, sectionId, isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    async assignTeacher(subjectSectionId: number, dto: AssignTeacherDto) {
        const role = (dto.role === 'ASSISTANT' ? 'ASSISTANT' : 'PRIMARY') as any;
        await this.prisma.subjectSectionTeacher.upsert({
            where: { subjectSectionId_teacherId: { subjectSectionId, teacherId: dto.teacherUserId } },
            create: { subjectSectionId, teacherId: dto.teacherUserId, role },
            update: { role, isDeleted: false, deletedAt: null },
        });
        return { success: true };
    }

    async removeTeacher(subjectSectionId: number, teacherUserId: number) {
        await this.prisma.subjectSectionTeacher.updateMany({
            where: { subjectSectionId, teacherId: teacherUserId, isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }
}
