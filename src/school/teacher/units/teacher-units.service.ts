// src/school/teacher/units/teacher-units.service.ts
import {
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { ReorderUnitsDto } from './dto/reorder-units.dto';

@Injectable()
export class TeacherUnitsService {
    constructor(private readonly prisma: PrismaService) {}

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق أن المعلم مسند لهذه المادة
    // ─────────────────────────────────────────────────────────
    private async assertTeacherOwnsSubject(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
    ) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });

        if (!user || !user.teacher) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        const subject = await this.prisma.subject.findFirst({
            where: { uuid: subjectUuid, schoolId, isDeleted: false },
        });

        if (!subject) {
            throw new NotFoundException('المادة غير موجودة');
        }

        // تحقق من أن المعلم مُسند لهذه المادة عبر subject_section_teachers
        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: {
                teacherId: user.teacher.userId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    subjectId: subject.id,
                    isDeleted: false,
                },
            },
        });

        if (!assignment) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        return { teacherId: user.teacher.userId, subjectId: subject.id };
    }

    // ─────────────────────────────────────────────────────────
    // GET — جلب وحدات المادة (TCH-020)
    // ─────────────────────────────────────────────────────────
    async getUnits(schoolId: number, userUuid: string, subjectUuid: string) {
        const { subjectId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        const units = await this.prisma.unit.findMany({
            where: { subjectId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
        });

        // حساب عدد الدروس لكل وحدة — مؤجل حتى إنشاء LessonTemplate
        // const lessonCounts = ...

        return {
            units: units.map((u) => ({
                id: u.id,
                uuid: u.uuid,
                title: u.title,
                orderIndex: u.orderIndex,
                description: u.description,
                lessonsCount: 0, // سيُحدّث في المرحلة 2
            })),
        };
    }

    // ─────────────────────────────────────────────────────────
    // POST — إضافة وحدة (TCH-023)
    // ─────────────────────────────────────────────────────────
    async createUnit(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
        dto: CreateUnitDto,
    ) {
        const { subjectId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        // تحقق من عدم تكرار orderIndex
        const existing = await this.prisma.unit.findFirst({
            where: {
                subjectId,
                orderIndex: dto.orderIndex,
                isDeleted: false,
            },
        });

        if (existing) {
            throw new ConflictException(
                'ترتيب الوحدة مستخدم مسبقًا داخل هذه المادة.',
            );
        }

        const unit = await this.prisma.unit.create({
            data: {
                subjectId,
                schoolId,
                ownerType: 'SCHOOL',
                title: dto.title,
                orderIndex: dto.orderIndex,
                description: dto.description ?? null,
            },
        });

        return {
            id: unit.id,
            uuid: unit.uuid,
            title: unit.title,
            orderIndex: unit.orderIndex,
            description: unit.description,
            lessonsCount: 0,
        };
    }

    // ─────────────────────────────────────────────────────────
    // PATCH — تعديل وحدة (TCH-021)
    // ─────────────────────────────────────────────────────────
    async updateUnit(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
        unitUuid: string,
        dto: UpdateUnitDto,
    ) {
        const { subjectId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        const unit = await this.prisma.unit.findFirst({
            where: { uuid: unitUuid, subjectId, isDeleted: false },
        });

        if (!unit) {
            throw new NotFoundException('الوحدة غير موجودة');
        }

        // تحقق من عدم تكرار orderIndex إذا تم تغييره
        if (dto.orderIndex !== undefined && dto.orderIndex !== unit.orderIndex) {
            const conflict = await this.prisma.unit.findFirst({
                where: {
                    subjectId,
                    orderIndex: dto.orderIndex,
                    isDeleted: false,
                    id: { not: unit.id },
                },
            });

            if (conflict) {
                throw new ConflictException(
                    'ترتيب الوحدة مستخدم مسبقًا داخل هذه المادة.',
                );
            }
        }

        const updated = await this.prisma.unit.update({
            where: { id: unit.id },
            data: {
                ...(dto.title !== undefined && { title: dto.title }),
                ...(dto.orderIndex !== undefined && {
                    orderIndex: dto.orderIndex,
                }),
                ...(dto.description !== undefined && {
                    description: dto.description,
                }),
            },
        });

        return {
            id: updated.id,
            uuid: updated.uuid,
            title: updated.title,
            orderIndex: updated.orderIndex,
            description: updated.description,
        };
    }

    // ─────────────────────────────────────────────────────────
    // DELETE — حذف وحدة فارغة (TCH-022)
    // ─────────────────────────────────────────────────────────
    async deleteUnit(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
        unitUuid: string,
    ) {
        const { subjectId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        const unit = await this.prisma.unit.findFirst({
            where: { uuid: unitUuid, subjectId, isDeleted: false },
        });

        if (!unit) {
            throw new NotFoundException('الوحدة غير موجودة');
        }

        // TODO: عند إضافة LessonTemplate في المرحلة 2
        // const lessonsCount = await this.prisma.lessonTemplate.count({
        //     where: { unitId: unit.id, isDeleted: false },
        // });
        // if (lessonsCount > 0) {
        //     throw new ConflictException('لا يمكن حذف وحدة تحتوي على دروس.');
        // }

        // Soft delete
        await this.prisma.unit.update({
            where: { id: unit.id },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        return { message: 'تم حذف الوحدة بنجاح' };
    }

    // ─────────────────────────────────────────────────────────
    // PUT — إعادة ترتيب الوحدات (TCH-020)
    // ─────────────────────────────────────────────────────────
    async reorderUnits(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
        dto: ReorderUnitsDto,
    ) {
        const { subjectId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        // جلب الوحدات الفعلية
        const units = await this.prisma.unit.findMany({
            where: {
                subjectId,
                isDeleted: false,
                uuid: { in: dto.unitIds },
            },
        });

        if (units.length !== dto.unitIds.length) {
            throw new NotFoundException(
                'بعض الوحدات غير موجودة أو لا تنتمي لهذه المادة',
            );
        }

        // تحديث الترتيب داخل Transaction
        // أولاً: إعادة الترتيب لأرقام سالبة مؤقتة لتجنب Unique constraint violation
        await this.prisma.$transaction(async (tx) => {
            // مرحلة 1: أرقام سالبة مؤقتة
            for (let i = 0; i < dto.unitIds.length; i++) {
                const unit = units.find((u) => u.uuid === dto.unitIds[i]);
                if (unit) {
                    await tx.unit.update({
                        where: { id: unit.id },
                        data: { orderIndex: -(i + 1) },
                    });
                }
            }

            // مرحلة 2: الأرقام النهائية
            for (let i = 0; i < dto.unitIds.length; i++) {
                const unit = units.find((u) => u.uuid === dto.unitIds[i]);
                if (unit) {
                    await tx.unit.update({
                        where: { id: unit.id },
                        data: { orderIndex: i + 1 },
                    });
                }
            }
        });

        return { message: 'تم إعادة ترتيب الوحدات بنجاح' };
    }
}
