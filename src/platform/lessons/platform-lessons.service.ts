// src/platform/lessons/platform-lessons.service.ts
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ReorderContentsDto } from './dto/reorder-contents.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class PlatformLessonsService {
    constructor(private readonly prisma: PrismaService) {}

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق أن المستخدم يملك هذه المادة
    // ─────────────────────────────────────────────────────────
    private async assertOwnsSubject(
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
    // Helper: التحقق من ملكية درس
    // ─────────────────────────────────────────────────────────
    private async assertOwnsLesson(
        platformUserUuid: string,
        lessonUuid: string,
    ) {
        const platformUser = await this.prisma.platformUser.findFirst({
            where: { uuid: platformUserUuid, isDeleted: false, isActive: true },
        });

        if (!platformUser) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        const lesson = await this.prisma.lessonTemplate.findFirst({
            where: {
                uuid: lessonUuid,
                ownerType: 'PLATFORM',
                isDeleted: false,
            },
            include: { unit: true },
        });

        if (!lesson) {
            throw new NotFoundException('الدرس غير موجود');
        }

        // تحقق من الإسناد (admin يمر مباشرة)
        if (platformUser.role !== 'PLATFORM_ADMIN' && lesson.subjectDictionaryId) {
            const assignment = await this.prisma.platformUserSubject.findFirst({
                where: {
                    platformUserId: platformUser.id,
                    subjectDictionaryId: lesson.subjectDictionaryId,
                },
            });
            if (!assignment) {
                throw new ForbiddenException('ليس لديك صلاحية لهذا الدرس');
            }
        }

        return { lesson, platformUserId: platformUser.id };
    }

    // ═════════════════════════════════════════════════════════
    //  عرض الدروس مقسّمة بالوحدات
    // ═════════════════════════════════════════════════════════
    async getLessonsByUnits(
        platformUserUuid: string,
        subjectDictUuid: string,
    ) {
        const { subjectDictionaryId } = await this.assertOwnsSubject(
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
                lessonTemplates: {
                    where: { isDeleted: false, ownerType: 'PLATFORM' },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        _count: {
                            select: {
                                contents: { where: { isDeleted: false } },
                                questions: { where: { isDeleted: false } },
                            },
                        },
                    },
                },
            },
        });

        return {
            units: units.map((u) => ({
                uuid: u.uuid,
                title: u.title,
                orderIndex: u.orderIndex,
                description: u.description,
                lessons: u.lessonTemplates.map((lt) => ({
                    uuid: lt.uuid,
                    title: lt.title,
                    orderIndex: lt.orderIndex,
                    status: lt.status,
                    coverMediaAssetId: lt.coverMediaAssetId,
                    contentsCount: lt._count.contents,
                    questionsCount: lt._count.questions,
                })),
            })),
        };
    }

    // ═════════════════════════════════════════════════════════
    //  إنشاء درس
    // ═════════════════════════════════════════════════════════
    async createLesson(
        platformUserUuid: string,
        subjectDictUuid: string,
        unitUuid: string,
        dto: CreateLessonDto,
    ) {
        const { subjectDictionaryId, platformUserId } = await this.assertOwnsSubject(
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
            throw new NotFoundException('الوحدة غير موجودة أو لا تتبع لهذه المادة');
        }

        // تحقق من فرادة الترتيب
        const existing = await this.prisma.lessonTemplate.findFirst({
            where: {
                unitId: unit.id,
                orderIndex: dto.orderIndex,
                isDeleted: false,
            },
        });

        if (existing) {
            throw new ConflictException('هذا الترتيب مستخدم. اختر ترتيباً آخر.');
        }

        const lesson = await this.prisma.lessonTemplate.create({
            data: {
                ownerType: 'PLATFORM',
                subjectDictionaryId,
                unitId: unit.id,
                title: dto.title,
                orderIndex: dto.orderIndex,
                status: 'DRAFT',
                coverMediaAssetId: dto.coverMediaAssetId ?? null,
                createdByPlatformUserId: platformUserId,
            },
        });

        return {
            uuid: lesson.uuid,
            title: lesson.title,
            unitId: lesson.unitId,
            orderIndex: lesson.orderIndex,
            status: lesson.status,
            coverMediaAssetId: lesson.coverMediaAssetId,
            contentsCount: 0,
            questionsCount: 0,
            createdAt: lesson.createdAt,
        };
    }

    // ═════════════════════════════════════════════════════════
    //  تعديل درس
    // ═════════════════════════════════════════════════════════
    async updateLesson(
        platformUserUuid: string,
        lessonUuid: string,
        dto: UpdateLessonDto,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        let targetUnitId = lesson.unitId;

        if (dto.unitUuid) {
            const newUnit = await this.prisma.unit.findFirst({
                where: {
                    uuid: dto.unitUuid,
                    subjectDictionaryId: lesson.subjectDictionaryId,
                    ownerType: 'PLATFORM',
                    isDeleted: false,
                },
            });
            if (!newUnit) {
                throw new BadRequestException('الوحدة لا تتبع لنفس المادة');
            }
            targetUnitId = newUnit.id;
        }

        const targetOrder = dto.orderIndex ?? lesson.orderIndex;
        if (targetOrder !== lesson.orderIndex || targetUnitId !== lesson.unitId) {
            const conflict = await this.prisma.lessonTemplate.findFirst({
                where: {
                    unitId: targetUnitId,
                    orderIndex: targetOrder,
                    isDeleted: false,
                    id: { not: lesson.id },
                },
            });
            if (conflict) {
                throw new ConflictException('هذا الترتيب مستخدم في الوحدة المستهدفة.');
            }
        }

        const updated = await this.prisma.lessonTemplate.update({
            where: { id: lesson.id },
            data: {
                ...(dto.title !== undefined && { title: dto.title }),
                ...(targetUnitId !== lesson.unitId && { unitId: targetUnitId }),
                ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
                ...(dto.coverMediaAssetId !== undefined && {
                    coverMediaAssetId: dto.coverMediaAssetId,
                }),
            },
        });

        return {
            uuid: updated.uuid,
            title: updated.title,
            unitId: updated.unitId,
            orderIndex: updated.orderIndex,
            status: updated.status,
            coverMediaAssetId: updated.coverMediaAssetId,
            updatedAt: updated.updatedAt,
        };
    }

    // ═════════════════════════════════════════════════════════
    //  حذف درس DRAFT
    // ═════════════════════════════════════════════════════════
    async deleteLesson(platformUserUuid: string, lessonUuid: string) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        if (lesson.status !== 'DRAFT') {
            throw new BadRequestException('لا يمكن حذف درس غير مسودة. أعده مسودة أولاً.');
        }

        const now = new Date();
        await this.prisma.$transaction([
            this.prisma.lessonContent.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),
            this.prisma.lessonTemplate.update({
                where: { id: lesson.id },
                data: { isDeleted: true, deletedAt: now },
            }),
        ]);

        return { message: 'تم حذف الدرس بنجاح' };
    }

    // ═════════════════════════════════════════════════════════
    //  تغيير حالة الدرس (DRAFT ↔ READY)
    // ═════════════════════════════════════════════════════════
    async updateStatus(
        platformUserUuid: string,
        lessonUuid: string,
        dto: UpdateStatusDto,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        if (dto.status === 'READY' && lesson.status === 'DRAFT') {
            const contentsCount = await this.prisma.lessonContent.count({
                where: { templateId: lesson.id, isDeleted: false },
            });
            if (contentsCount === 0) {
                throw new BadRequestException('أضف محتوى واحد على الأقل قبل تجهيز الدرس.');
            }
        }

        const updated = await this.prisma.lessonTemplate.update({
            where: { id: lesson.id },
            data: { status: dto.status },
        });

        return {
            uuid: updated.uuid,
            status: updated.status,
            updatedAt: updated.updatedAt,
        };
    }

    // ═════════════════════════════════════════════════════════
    //  جلب محتوى الدرس
    // ═════════════════════════════════════════════════════════
    async getContents(platformUserUuid: string, lessonUuid: string) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const contents = await this.prisma.lessonContent.findMany({
            where: { templateId: lesson.id, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: { mediaAsset: { select: { uuid: true } } },
        });

        return {
            contents: contents.map((c) => ({
                uuid: c.uuid,
                type: c.type,
                title: c.title,
                contentText: c.contentText,
                mediaAssetId: c.mediaAssetId,
                mediaAssetUuid: c.mediaAsset?.uuid ?? null,
                orderIndex: c.orderIndex,
            })),
        };
    }

    // ═════════════════════════════════════════════════════════
    //  إضافة كتلة محتوى
    // ═════════════════════════════════════════════════════════
    async createContent(
        platformUserUuid: string,
        lessonUuid: string,
        dto: CreateContentDto,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        // قيد AUDIO واحد فقط
        if (dto.type === 'AUDIO') {
            const existingAudio = await this.prisma.lessonContent.findFirst({
                where: { templateId: lesson.id, type: 'AUDIO', isDeleted: false },
            });
            if (existingAudio) {
                throw new ConflictException('مسموح بمقطع صوتي واحد فقط للدرس.');
            }
        }

        // ترتيب آمن
        let finalOrderIndex = dto.orderIndex;
        const existingOrder = await this.prisma.lessonContent.findFirst({
            where: { templateId: lesson.id, orderIndex: dto.orderIndex },
        });

        if (existingOrder) {
            const maxOrder = await this.prisma.lessonContent.aggregate({
                where: { templateId: lesson.id },
                _max: { orderIndex: true },
            });
            finalOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;
        }

        // Resolve mediaAssetUuid → mediaAssetId
        let mediaAssetId: number | null = null;
        if (dto.mediaAssetUuid) {
            const asset = await this.prisma.mediaAsset.findFirst({
                where: { uuid: dto.mediaAssetUuid, isDeleted: false },
                select: { id: true },
            });
            if (!asset) {
                throw new NotFoundException('الوسيط غير موجود: ' + dto.mediaAssetUuid);
            }
            mediaAssetId = asset.id;
        }

        const content = await this.prisma.lessonContent.create({
            data: {
                templateId: lesson.id,
                type: dto.type,
                title: dto.title ?? null,
                contentText: dto.contentText ?? null,
                mediaAssetId,
                orderIndex: finalOrderIndex,
            },
            include: { mediaAsset: { select: { uuid: true } } },
        });

        return {
            uuid: content.uuid,
            type: content.type,
            title: content.title,
            contentText: content.contentText,
            mediaAssetId: content.mediaAssetId,
            mediaAssetUuid: content.mediaAsset?.uuid ?? null,
            orderIndex: content.orderIndex,
        };
    }

    // ═════════════════════════════════════════════════════════
    //  تعديل كتلة محتوى
    // ═════════════════════════════════════════════════════════
    async updateContent(
        platformUserUuid: string,
        lessonUuid: string,
        contentUuid: string,
        dto: UpdateContentDto,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const content = await this.prisma.lessonContent.findFirst({
            where: { uuid: contentUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!content) {
            throw new NotFoundException('كتلة المحتوى غير موجودة');
        }

        let resolvedMediaAssetId: number | undefined = undefined;
        if (dto.mediaAssetUuid !== undefined) {
            const asset = await this.prisma.mediaAsset.findFirst({
                where: { uuid: dto.mediaAssetUuid, isDeleted: false },
                select: { id: true },
            });
            if (!asset) {
                throw new NotFoundException('الوسيط غير موجود: ' + dto.mediaAssetUuid);
            }
            resolvedMediaAssetId = asset.id;
        }

        const updated = await this.prisma.lessonContent.update({
            where: { id: content.id },
            data: {
                ...(dto.title !== undefined && { title: dto.title }),
                ...(dto.contentText !== undefined && { contentText: dto.contentText }),
                ...(resolvedMediaAssetId !== undefined && { mediaAssetId: resolvedMediaAssetId }),
            },
        });

        return {
            uuid: updated.uuid,
            type: updated.type,
            title: updated.title,
            contentText: updated.contentText,
            mediaAssetId: updated.mediaAssetId,
            orderIndex: updated.orderIndex,
        };
    }

    // ═════════════════════════════════════════════════════════
    //  حذف كتلة محتوى
    // ═════════════════════════════════════════════════════════
    async deleteContent(
        platformUserUuid: string,
        lessonUuid: string,
        contentUuid: string,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const content = await this.prisma.lessonContent.findFirst({
            where: { uuid: contentUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!content) {
            throw new NotFoundException('كتلة المحتوى غير موجودة');
        }

        await this.prisma.lessonContent.update({
            where: { id: content.id },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                orderIndex: -content.id,
            },
        });

        return { message: 'تم حذف كتلة المحتوى بنجاح' };
    }

    // ═════════════════════════════════════════════════════════
    //  إعادة ترتيب كتل المحتوى
    // ═════════════════════════════════════════════════════════
    async reorderContents(
        platformUserUuid: string,
        lessonUuid: string,
        dto: ReorderContentsDto,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const contents = await this.prisma.lessonContent.findMany({
            where: {
                templateId: lesson.id,
                isDeleted: false,
                uuid: { in: dto.orderedUuids },
            },
        });

        if (contents.length !== dto.orderedUuids.length) {
            throw new NotFoundException('بعض كتل المحتوى غير موجودة');
        }

        await this.prisma.$transaction(async (tx) => {
            for (let i = 0; i < dto.orderedUuids.length; i++) {
                const c = contents.find((x) => x.uuid === dto.orderedUuids[i]);
                if (c) {
                    await tx.lessonContent.update({
                        where: { id: c.id },
                        data: { orderIndex: -(10000 + i + 1) },
                    });
                }
            }
            for (let i = 0; i < dto.orderedUuids.length; i++) {
                const c = contents.find((x) => x.uuid === dto.orderedUuids[i]);
                if (c) {
                    await tx.lessonContent.update({
                        where: { id: c.id },
                        data: { orderIndex: i + 1 },
                    });
                }
            }
        });

        return { message: 'تم إعادة ترتيب المحتوى بنجاح' };
    }
}
