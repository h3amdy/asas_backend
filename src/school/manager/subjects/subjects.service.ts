// src/school/manager/subjects/subjects.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateSubjectDto, UpdateSubjectDto, AssignSubjectSectionsDto, AssignTeacherToSectionDto } from './dto/subjects.dto';

@Injectable()
export class SubjectsService {
    constructor(private readonly prisma: PrismaService) { }

    // ═══════ القراءة ═══════

    async listSubjects(schoolId: number, gradeId?: number) {
        return this.prisma.subject.findMany({
            where: { schoolId, isDeleted: false, ...(gradeId ? { gradeId } : {}) },
            include: {
                grade: { select: { id: true, displayName: true } },
                coverMediaAsset: { select: { uuid: true } },
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
            orderBy: { displayName: 'asc' },
        });
    }

    async getSubjectById(schoolId: number, subjectId: number) {
        const subject = await this.prisma.subject.findFirst({
            where: { id: subjectId, schoolId, isDeleted: false },
            include: {
                grade: { select: { id: true, displayName: true } },
                coverMediaAsset: { select: { uuid: true } },
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

    // ═══════ الإنشاء ═══════

    async createSubject(schoolId: number, dto: CreateSubjectDto) {
        // 🛡️ 1. التحقق من وجود الصف وانتمائه للمدرسة
        const grade = await this.prisma.schoolGrade.findFirst({
            where: { id: dto.gradeId, schoolId, isDeleted: false },
        });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        // 🛡️ 2. عدم تكرار الاسم في نفس الصف (INV-02)
        const existing = await this.prisma.subject.findFirst({
            where: {
                schoolId,
                gradeId: dto.gradeId,
                displayName: dto.displayName,
                isDeleted: false,
            },
        });
        if (existing) throw new ConflictException('SUBJECT_ALREADY_EXISTS');

        // 🛡️ 3. UUID → ID لغلاف المادة (إن وُجد)
        let coverMediaAssetId: number | null = null;
        if (dto.coverMediaAssetUuid) {
            const asset = await this.prisma.mediaAsset.findUnique({
                where: { uuid: dto.coverMediaAssetUuid },
                select: { id: true },
            });
            if (!asset) throw new BadRequestException('COVER_MEDIA_ASSET_NOT_FOUND');
            coverMediaAssetId = asset.id;
        }

        // 4. إنشاء المادة
        const subject = await this.prisma.subject.create({
            data: {
                schoolId,
                gradeId: dto.gradeId,
                displayName: dto.displayName,
                shortName: dto.shortName ?? null,
                dictionaryId: dto.dictionaryId ?? null,
                coverMediaAssetId,
            },
        });

        // 4. ربط تلقائي بكل شعب الصف (INV-04)
        const sections = await this.prisma.section.findMany({
            where: { gradeId: dto.gradeId, isDeleted: false },
        });
        for (const section of sections) {
            await this.prisma.subjectSection.create({
                data: { subjectId: subject.id, sectionId: section.id },
            });
        }

        return this.getSubjectById(schoolId, subject.id);
    }

    // ═══════ التعديل ═══════

    async updateSubject(schoolId: number, subjectId: number, dto: UpdateSubjectDto) {
        // 🛡️ 1. التحقق من الوجود والانتماء للمدرسة
        const subject = await this.prisma.subject.findFirst({
            where: { id: subjectId, schoolId, isDeleted: false },
        });
        if (!subject) throw new NotFoundException('SUBJECT_NOT_FOUND');

        // 🛡️ 2. عدم تكرار الاسم إذا تغيّر
        if (dto.displayName !== undefined && dto.displayName !== subject.displayName) {
            const duplicate = await this.prisma.subject.findFirst({
                where: {
                    schoolId,
                    gradeId: subject.gradeId,
                    displayName: dto.displayName,
                    isDeleted: false,
                    id: { not: subjectId },
                },
            });
            if (duplicate) throw new ConflictException('SUBJECT_ALREADY_EXISTS');
        }

        // 3. التحديث
        const data: Record<string, any> = {};
        if (dto.displayName !== undefined) data.displayName = dto.displayName;
        if (dto.shortName !== undefined) data.shortName = dto.shortName;
        if (dto.coverMediaAssetUuid !== undefined) {
            if (dto.coverMediaAssetUuid) {
                const asset = await this.prisma.mediaAsset.findUnique({
                    where: { uuid: dto.coverMediaAssetUuid },
                    select: { id: true },
                });
                if (!asset) throw new BadRequestException('COVER_MEDIA_ASSET_NOT_FOUND');
                data.coverMediaAssetId = asset.id;
            } else {
                data.coverMediaAssetId = null; // إزالة الغلاف
            }
        }

        await this.prisma.subject.update({ where: { id: subjectId }, data });
        return this.getSubjectById(schoolId, subjectId);
    }

    // ═══════ الحذف ═══════

    async deleteSubject(schoolId: number, subjectId: number) {
        // 🛡️ التحقق من الوجود والانتماء
        const subject = await this.prisma.subject.findFirst({
            where: { id: subjectId, schoolId, isDeleted: false },
        });
        if (!subject) throw new NotFoundException('SUBJECT_NOT_FOUND');

        await this.prisma.subject.update({
            where: { id: subjectId },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    // ═══════ إسناد الشعب ═══════

    async assignToSections(schoolId: number, subjectId: number, dto: AssignSubjectSectionsDto) {
        // 🛡️ التحقق
        const subject = await this.prisma.subject.findFirst({
            where: { id: subjectId, schoolId, isDeleted: false },
        });
        if (!subject) throw new NotFoundException('SUBJECT_NOT_FOUND');

        for (const sectionId of dto.sectionIds) {
            await this.prisma.subjectSection.upsert({
                where: { subjectId_sectionId: { subjectId, sectionId } },
                create: { subjectId, sectionId },
                update: { isDeleted: false, deletedAt: null },
            });
        }
        return this.getSubjectById(schoolId, subjectId);
    }

    async removeFromSection(schoolId: number, subjectId: number, sectionId: number) {
        // 🛡️ التحقق
        const subject = await this.prisma.subject.findFirst({
            where: { id: subjectId, schoolId, isDeleted: false },
        });
        if (!subject) throw new NotFoundException('SUBJECT_NOT_FOUND');

        await this.prisma.subjectSection.updateMany({
            where: { subjectId, sectionId, isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    // ═══════ إسناد المعلمين (ADM-052 — UUID-based) ═══════

    /**
     * GET /subjects/:subjectUuid/assignment
     * عرض شعب المادة مع حالة الإسناد
     */
    async getAssignment(schoolId: number, subjectUuid: string) {
        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
            include: {
                grade: { select: { displayName: true } },
                subjectSections: {
                    where: { isDeleted: false },
                    orderBy: { section: { orderIndex: 'asc' } },
                    include: {
                        section: { select: { id: true, name: true } },
                        teachers: {
                            where: { isDeleted: false, isActive: true },
                            take: 1,
                            include: {
                                teacher: {
                                    include: { user: { select: { uuid: true, name: true, code: true } } },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!subject) throw new NotFoundException('SUBJECT_NOT_FOUND');

        return {
            subjectUuid: subject.uuid,
            displayName: subject.displayName,
            grade: subject.grade,
            sections: subject.subjectSections.map((ss) => ({
                subjectSectionId: ss.id,
                sectionId: ss.section.id,
                sectionName: ss.section.name,
                teacher: ss.teachers.length > 0
                    ? {
                        uuid: ss.teachers[0].teacher.user.uuid,
                        name: ss.teachers[0].teacher.user.name,
                        code: ss.teachers[0].teacher.user.code,
                    }
                    : null,
            })),
        };
    }

    /**
     * POST /subjects/:subjectUuid/sections/:sectionId/assign-teacher
     * إسناد أو تغيير معلم لشعبة
     */
    async assignTeacherToSection(
        schoolId: number,
        subjectUuid: string,
        sectionId: number,
        teacherUuid: string,
    ) {
        // 🛡️ 1. التحقق من المادة + الشعبة
        const subjectSection = await this.prisma.subjectSection.findFirst({
            where: {
                sectionId,
                isDeleted: false,
                subject: { uuid: subjectUuid, schoolId, isDeleted: false },
            },
            include: {
                teachers: {
                    where: { isDeleted: false, isActive: true },
                    take: 1,
                    include: { teacher: { include: { user: { select: { uuid: true, name: true, code: true } } } } },
                },
            },
        });
        if (!subjectSection) throw new NotFoundException('SECTION_NOT_FOUND');

        // 🛡️ 2. التحقق من المعلم (عبر User)
        const user = await this.prisma.user.findFirst({
            where: { uuid: teacherUuid, schoolId },
            include: { teacher: true },
        });
        if (!user || !user.teacher) throw new NotFoundException('TEACHER_NOT_FOUND');

        // 3. حفظ المعلم السابق (إن وُجد)
        let previousTeacher: { uuid: string; name: string; code: number } | null = null;
        if (subjectSection.teachers.length > 0) {
            const prev = subjectSection.teachers[0];
            previousTeacher = {
                uuid: prev.teacher.user.uuid,
                name: prev.teacher.user.name,
                code: prev.teacher.user.code ?? 0,
            };

            // إذا نفس المعلم → لا تغيير
            if (previousTeacher!.uuid === teacherUuid) {
                return {
                    success: true,
                    message: 'ALREADY_ASSIGNED',
                    previousTeacher: null,
                    newTeacher: previousTeacher!,
                };
            }

            // soft delete المعلم السابق
            await this.prisma.subjectSectionTeacher.updateMany({
                where: {
                    subjectSectionId: subjectSection.id,
                    isDeleted: false,
                },
                data: { isDeleted: true, deletedAt: new Date(), isActive: false },
            });
        }

        // 4. إسناد المعلم الجديد (upsert لمنع التكرار)
        await this.prisma.subjectSectionTeacher.upsert({
            where: {
                subjectSectionId_teacherId: {
                    subjectSectionId: subjectSection.id,
                    teacherId: user.teacher.userId,
                },
            },
            create: {
                subjectSectionId: subjectSection.id,
                teacherId: user.teacher.userId,
                role: 'PRIMARY',
            },
            update: {
                isDeleted: false,
                deletedAt: null,
                isActive: true,
                role: 'PRIMARY',
            },
        });

        return {
            success: true,
            previousTeacher,
            newTeacher: {
                uuid: user.uuid,
                name: user.name,
                code: user.code ?? 0,
            },
        };
    }

    /**
     * DELETE /subjects/:subjectUuid/sections/:sectionId/unassign-teacher
     * إزالة الإسناد
     */
    async unassignTeacherFromSection(
        schoolId: number,
        subjectUuid: string,
        sectionId: number,
    ) {
        // 🛡️ التحقق
        const subjectSection = await this.prisma.subjectSection.findFirst({
            where: {
                sectionId,
                isDeleted: false,
                subject: { uuid: subjectUuid, schoolId, isDeleted: false },
            },
        });
        if (!subjectSection) throw new NotFoundException('SECTION_NOT_FOUND');

        const result = await this.prisma.subjectSectionTeacher.updateMany({
            where: {
                subjectSectionId: subjectSection.id,
                isDeleted: false,
            },
            data: { isDeleted: true, deletedAt: new Date(), isActive: false },
        });

        if (result.count === 0) throw new NotFoundException('ASSIGNMENT_NOT_FOUND');

        return { success: true };
    }
}
