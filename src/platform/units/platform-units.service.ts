// src/platform/units/platform-units.service.ts
import {
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { ReorderUnitsDto } from './dto/reorder-units.dto';

@Injectable()
export class PlatformUnitsService {
    constructor(private readonly prisma: PrismaService) {}

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق أن المعلم مسند لهذه المادة (عبر subject_dictionary)
    // ─────────────────────────────────────────────────────────
    private async assertPlatformTeacherOwnsSubject(
        platformUserUuid: string,
        subjectDictUuid: string,
    ) {
        const platformUser = await this.prisma.platformUser.findFirst({
            where: { uuid: platformUserUuid, isDeleted: false, isActive: true },
        });

        if (!platformUser) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        const subjectDict = await this.prisma.subjectDictionary.findFirst({
            where: { uuid: subjectDictUuid, isDeleted: false, isActive: true },
        });

        if (!subjectDict) {
            throw new NotFoundException('المادة غير موجودة');
        }

        // تحقق من الإسناد — أو كون المستخدم مدير منصة
        if (platformUser.role !== 'PLATFORM_ADMIN') {
            const assignment = await this.prisma.platformUserSubject.findFirst({
                where: {
                    platformUserId: platformUser.id,
                    subjectDictionaryId: subjectDict.id,
                },
            });

            if (!assignment) {
                throw new ForbiddenException('ليس لديك صلاحية لهذه المادة');
            }
        }

        return { platformUserId: platformUser.id, subjectDictionaryId: subjectDict.id };
    }

    // ─────────────────────────────────────────────────────────
    // GET — جلب وحدات المادة
    // ─────────────────────────────────────────────────────────
    async getUnits(platformUserUuid: string, subjectDictUuid: string) {
        const { subjectDictionaryId } = await this.assertPlatformTeacherOwnsSubject(
            platformUserUuid,
            subjectDictUuid,
        );

        const units = await this.prisma.unit.findMany({
            where: {
                subjectDictionaryId,
                ownerType: 'PLATFORM',
                isDeleted: false,
            },
            orderBy: { orderIndex: 'asc' },
            include: {
                _count: {
                    select: {
                        lessonTemplates: { where: { isDeleted: false } },
                    },
                },
            },
        });

        return {
            units: units.map((u) => ({
                id: u.id,
                uuid: u.uuid,
                title: u.title,
                orderIndex: u.orderIndex,
                description: u.description,
                lessonsCount: u._count.lessonTemplates,
            })),
        };
    }

    // ─────────────────────────────────────────────────────────
    // POST — إضافة وحدة
    // ─────────────────────────────────────────────────────────
    async createUnit(
        platformUserUuid: string,
        subjectDictUuid: string,
        dto: CreateUnitDto,
    ) {
        const { subjectDictionaryId } = await this.assertPlatformTeacherOwnsSubject(
            platformUserUuid,
            subjectDictUuid,
        );

        // تحقق من عدم تكرار orderIndex
        const existing = await this.prisma.unit.findFirst({
            where: {
                subjectDictionaryId,
                ownerType: 'PLATFORM',
                orderIndex: dto.orderIndex,
                isDeleted: false,
            },
        });

        if (existing) {
            throw new ConflictException('ترتيب الوحدة مستخدم مسبقًا داخل هذه المادة.');
        }

        const unit = await this.prisma.unit.create({
            data: {
                subjectDictionaryId,
                ownerType: 'PLATFORM',
                // schoolId و subjectId تبقى null لمحتوى المنصة
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
    // PATCH — تعديل وحدة
    // ─────────────────────────────────────────────────────────
    async updateUnit(
        platformUserUuid: string,
        subjectDictUuid: string,
        unitUuid: string,
        dto: UpdateUnitDto,
    ) {
        const { subjectDictionaryId } = await this.assertPlatformTeacherOwnsSubject(
            platformUserUuid,
            subjectDictUuid,
        );

        const unit = await this.prisma.unit.findFirst({
            where: {
                uuid: unitUuid,
                subjectDictionaryId,
                ownerType: 'PLATFORM',
                isDeleted: false,
            },
        });

        if (!unit) {
            throw new NotFoundException('الوحدة غير موجودة');
        }

        // تحقق من عدم تكرار orderIndex إذا تم تغييره
        if (dto.orderIndex !== undefined && dto.orderIndex !== unit.orderIndex) {
            const conflict = await this.prisma.unit.findFirst({
                where: {
                    subjectDictionaryId,
                    ownerType: 'PLATFORM',
                    orderIndex: dto.orderIndex,
                    isDeleted: false,
                    id: { not: unit.id },
                },
            });

            if (conflict) {
                throw new ConflictException('ترتيب الوحدة مستخدم مسبقًا داخل هذه المادة.');
            }
        }

        const updated = await this.prisma.unit.update({
            where: { id: unit.id },
            data: {
                ...(dto.title !== undefined && { title: dto.title }),
                ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
                ...(dto.description !== undefined && { description: dto.description }),
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
    // DELETE — حذف وحدة فارغة
    // ─────────────────────────────────────────────────────────
    async deleteUnit(
        platformUserUuid: string,
        subjectDictUuid: string,
        unitUuid: string,
    ) {
        const { subjectDictionaryId } = await this.assertPlatformTeacherOwnsSubject(
            platformUserUuid,
            subjectDictUuid,
        );

        const unit = await this.prisma.unit.findFirst({
            where: {
                uuid: unitUuid,
                subjectDictionaryId,
                ownerType: 'PLATFORM',
                isDeleted: false,
            },
        });

        if (!unit) {
            throw new NotFoundException('الوحدة غير موجودة');
        }

        // التحقق من أن الوحدة فارغة
        const lessonsCount = await this.prisma.lessonTemplate.count({
            where: { unitId: unit.id, isDeleted: false },
        });

        if (lessonsCount > 0) {
            throw new ConflictException('لا يمكن حذف وحدة تحتوي على دروس.');
        }

        // Soft delete
        await this.prisma.unit.update({
            where: { id: unit.id },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        return { message: 'تم حذف الوحدة بنجاح' };
    }

    // ─────────────────────────────────────────────────────────
    // PUT — إعادة ترتيب الوحدات
    // ─────────────────────────────────────────────────────────
    async reorderUnits(
        platformUserUuid: string,
        subjectDictUuid: string,
        dto: ReorderUnitsDto,
    ) {
        const { subjectDictionaryId } = await this.assertPlatformTeacherOwnsSubject(
            platformUserUuid,
            subjectDictUuid,
        );

        const units = await this.prisma.unit.findMany({
            where: {
                subjectDictionaryId,
                ownerType: 'PLATFORM',
                isDeleted: false,
                uuid: { in: dto.unitIds },
            },
        });

        if (units.length !== dto.unitIds.length) {
            throw new NotFoundException('بعض الوحدات غير موجودة أو لا تنتمي لهذه المادة');
        }

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
