// src/platform/lessons/platform-lessons.service.ts
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { MediaLifecycleService } from '../../shared/media/media-lifecycle.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { CreateBlockItemDto } from './dto/create-block-item.dto';
import { UpdateBlockItemDto } from './dto/update-block-item.dto';
import { ReorderBlocksDto } from './dto/reorder-blocks.dto';
import { ReorderBlockItemsDto } from './dto/reorder-block-items.dto';
import { MoveBlockItemDto } from './dto/move-block-item.dto';

@Injectable()
export class PlatformLessonsService {
    private readonly mediaLifecycle: MediaLifecycleService;
    private readonly mediaAccessPolicy: MediaAccessPolicyService;

    constructor(
        private readonly prisma: PrismaService,
        @Optional() mediaLifecycle?: MediaLifecycleService,
        @Optional() mediaAccessPolicy?: MediaAccessPolicyService,
    ) {
        this.mediaAccessPolicy =
            mediaAccessPolicy ?? new MediaAccessPolicyService(this.prisma);
        this.mediaLifecycle =
            mediaLifecycle ??
            new MediaLifecycleService(this.mediaAccessPolicy);
    }

    private async assertValidCoverMediaAssetId(
        coverMediaAssetId: number | null | undefined,
    ) {
        if (coverMediaAssetId === undefined || coverMediaAssetId === null) {
            return;
        }
        const asset = await this.prisma.mediaAsset.findFirst({
            where: { id: coverMediaAssetId, isDeleted: false },
            select: {
                id: true,
                uuid: true,
                ownerType: true,
                schoolId: true,
                kind: true,
                processingStatus: true,
                isDeleted: true,
            },
        });
        if (!asset) {
            throw new NotFoundException({
                code: 'ASSET_NOT_FOUND',
                message: 'Media asset not found',
            });
        }
        await this.mediaAccessPolicy.assertCanLinkNonVideoAsset(
            this.prisma,
            asset.uuid,
            {
                targetOwnerType: 'PLATFORM',
                allowedKinds: ['IMAGE'],
            },
        );
    }

    // ─────────────────────────────────────────────────────────
    // Helper: زيادة إصدار القالب عند أي تعديل على المحتوى
    // ─────────────────────────────────────────────────────────
    private async bumpVersion(lessonTemplateId: number): Promise<number> {
        const updated = await this.prisma.lessonTemplate.update({
            where: { id: lessonTemplateId },
            data: { templateVersion: { increment: 1 } },
        });
        return updated.templateVersion;
    }


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
        readyOnly = false,
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
                    where: {
                        isDeleted: false,
                        ownerType: 'PLATFORM',
                        ...(readyOnly
                            ? { status: { in: ['READY', 'PUBLISHED'] } }
                            : {}),
                    },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        _count: {
                            select: {
                                contentBlocks: { where: { isDeleted: false } },
                                questions: { where: { isDeleted: false } },
                            },
                        },
                        contentBlocks: {
                            where: { isDeleted: false },
                            select: {
                                _count: {
                                    select: {
                                        items: { where: { isDeleted: false } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // حذف الوحدات الفارغة ثم تحويل البيانات
        const result = units
            .filter((u) => !readyOnly || u.lessonTemplates.length > 0)
            .map((u) => ({
                uuid: u.uuid,
                title: u.title,
                orderIndex: u.orderIndex,
                description: u.description,
                lessons: u.lessonTemplates.map((lt) => {
                    const itemsCount = lt.contentBlocks.reduce(
                        (sum, b) => sum + b._count.items, 0,
                    );
                    return {
                        uuid: lt.uuid,
                        title: lt.title,
                        orderIndex: lt.orderIndex,
                        status: lt.status,
                        coverMediaAssetId: lt.coverMediaAssetId,
                        blocksCount: lt._count.contentBlocks,
                        itemsCount,
                        questionsCount: lt._count.questions,
                    };
                }),
            }));

        return { units: result };
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

        await this.assertValidCoverMediaAssetId(dto.coverMediaAssetId);

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
            blocksCount: 0,
            itemsCount: 0,
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

        await this.assertValidCoverMediaAssetId(dto.coverMediaAssetId);

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

        await this.bumpVersion(lesson.id);

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
        await this.prisma.$transaction(async (tx) => {
            const itemsWithMedia = await tx.lessonBlockItem.findMany({
                where: {
                    block: { templateId: lesson.id },
                    isDeleted: false,
                    mediaAssetId: { not: null },
                },
                select: { mediaAssetId: true },
            });
            const assetIds = this.mediaLifecycle.normalizeAndSortAssetIds(
                itemsWithMedia.map((i) => i.mediaAssetId),
            );
            if (assetIds.length > 0) {
                await this.mediaLifecycle.lockMediaAssetsForUpdate(tx, assetIds);
            }

            // 1. Soft-delete أبناء الأسئلة
            await tx.questionOption.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionMatchingPair.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionOrderingItem.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionFillBlank.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionFillAnswer.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });

            // 2. Soft-delete الأسئلة
            await tx.question.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });

            // 3. Soft-delete عناصر الفقرات
            await tx.lessonBlockItem.updateMany({
                where: {
                    block: { templateId: lesson.id },
                    isDeleted: false,
                },
                data: { isDeleted: true, deletedAt: now },
            });

            // 4. Soft-delete الفقرات
            await tx.lessonContentBlock.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });

            // 5. Soft-delete الدرس المنشور (لمنع ظهوره للطلاب)
            await tx.lesson.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });

            // 6. Soft-delete القالب
            await tx.lessonTemplate.update({
                where: { id: lesson.id },
                data: { isDeleted: true, deletedAt: now },
            });

            if (assetIds.length > 0) {
                await this.mediaLifecycle.reconcileUnlinkedAssetsUnderLock(
                    tx,
                    assetIds,
                );
            }
        });

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
            const blocksCount = await this.prisma.lessonContentBlock.count({
                where: { templateId: lesson.id, isDeleted: false },
            });
            if (blocksCount === 0) {
                throw new BadRequestException('أضف فقرة واحدة على الأقل قبل تجهيز الدرس.');
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

    async getBlocks(platformUserUuid: string, lessonUuid: string) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const blocks = await this.prisma.lessonContentBlock.findMany({
            where: { templateId: lesson.id, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                items: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    include: { mediaAsset: { select: { uuid: true, kind: true } } },
                },
            },
        });

        return {
            blocks: blocks.map((b) => ({
                uuid: b.uuid,
                title: b.title,
                orderIndex: b.orderIndex,
                items: b.items.map((item) => ({
                    uuid: item.uuid,
                    itemType: item.itemType,
                    orderIndex: item.orderIndex,
                    textContent: item.textContent,
                    mediaAssetUuid: item.mediaAsset?.uuid ?? null,
                    mediaAssetKind: item.mediaAsset?.kind ?? null,
                    caption: item.caption,
                })),
            })),
        };
    }

    async createBlock(platformUserUuid: string, lessonUuid: string, dto: CreateBlockDto) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const existing = await this.prisma.lessonContentBlock.findFirst({
            where: { templateId: lesson.id, orderIndex: dto.orderIndex, isDeleted: false },
        });

        let finalOrderIndex = dto.orderIndex;
        if (existing) {
            const maxOrder = await this.prisma.lessonContentBlock.aggregate({
                where: { templateId: lesson.id, isDeleted: false },
                _max: { orderIndex: true },
            });
            finalOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;
        }

        const block = await this.prisma.lessonContentBlock.create({
            data: { templateId: lesson.id, title: dto.title ?? null, orderIndex: finalOrderIndex },
        });

        await this.bumpVersion(lesson.id);
        return { uuid: block.uuid, title: block.title, orderIndex: block.orderIndex, items: [] };
    }

    async updateBlock(platformUserUuid: string, lessonUuid: string, blockUuid: string, dto: UpdateBlockDto) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);
        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!block) throw new NotFoundException('الفقرة غير موجودة');

        const updated = await this.prisma.lessonContentBlock.update({
            where: { id: block.id },
            data: { ...(dto.title !== undefined && { title: dto.title }) },
        });
        await this.bumpVersion(lesson.id);
        return { uuid: updated.uuid, title: updated.title, orderIndex: updated.orderIndex };
    }

    async deleteBlock(platformUserUuid: string, lessonUuid: string, blockUuid: string) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);
        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!block) throw new NotFoundException('الفقرة غير موجودة');

        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
            const itemsWithMedia = await tx.lessonBlockItem.findMany({
                where: {
                    blockId: block.id,
                    isDeleted: false,
                    mediaAssetId: { not: null },
                },
                select: { mediaAssetId: true },
            });
            const assetIds = this.mediaLifecycle.normalizeAndSortAssetIds(
                itemsWithMedia.map((i) => i.mediaAssetId),
            );
            if (assetIds.length > 0) {
                await this.mediaLifecycle.lockMediaAssetsForUpdate(tx, assetIds);
            }

            await tx.lessonBlockItem.updateMany({
                where: { blockId: block.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.lessonContentBlock.update({
                where: { id: block.id },
                data: { isDeleted: true, deletedAt: now },
            });

            if (assetIds.length > 0) {
                await this.mediaLifecycle.reconcileUnlinkedAssetsUnderLock(
                    tx,
                    assetIds,
                );
            }
        });
        await this.bumpVersion(lesson.id);
        return { message: 'تم حذف الفقرة بنجاح' };
    }

    async reorderBlocks(platformUserUuid: string, lessonUuid: string, dto: ReorderBlocksDto) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        // جلب كل الفقرات للتحقق من شمولية القائمة
        const allBlocks = await this.prisma.lessonContentBlock.findMany({
            where: { templateId: lesson.id, isDeleted: false },
        });
        if (dto.orderedUuids.length !== allBlocks.length) {
            throw new BadRequestException(
                `يجب إرسال جميع الفقرات (${allBlocks.length}) في قائمة الترتيب`,
            );
        }
        const blocks = allBlocks.filter((b) => dto.orderedUuids.includes(b.uuid));
        if (blocks.length !== dto.orderedUuids.length) throw new NotFoundException('بعض الفقرات غير موجودة');

        await this.prisma.$transaction(
            dto.orderedUuids.map((uuid, i) => {
                const block = blocks.find((b) => b.uuid === uuid)!;
                return this.prisma.lessonContentBlock.update({ where: { id: block.id }, data: { orderIndex: i + 1 } });
            }),
        );
        await this.bumpVersion(lesson.id);
        return { message: 'تم إعادة ترتيب الفقرات بنجاح' };
    }

    async createBlockItem(platformUserUuid: string, lessonUuid: string, blockUuid: string, dto: CreateBlockItemDto) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);
        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!block) throw new NotFoundException('الفقرة غير موجودة');

        let finalOrderIndex = dto.orderIndex;
        const existingOrder = await this.prisma.lessonBlockItem.findFirst({
            where: { blockId: block.id, orderIndex: dto.orderIndex, isDeleted: false },
        });
        if (existingOrder) {
            const maxOrder = await this.prisma.lessonBlockItem.aggregate({
                where: { blockId: block.id, isDeleted: false }, _max: { orderIndex: true },
            });
            finalOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;
        }

        const item = await this.prisma.$transaction(async (tx) => {
            let mediaAssetId: number | null = null;
            if (dto.mediaAssetUuid) {
                const lockedAsset =
                    await this.mediaLifecycle.resolveAndLockAssetForLink(tx, {
                        assetUuid: dto.mediaAssetUuid,
                        expectedKind: dto.itemType as
                            | 'IMAGE'
                            | 'AUDIO'
                            | 'VIDEO',
                        targetOwnerType: 'PLATFORM',
                    });
                mediaAssetId = lockedAsset.id;
            }

            return tx.lessonBlockItem.create({
                data: {
                    blockId: block.id,
                    itemType: dto.itemType,
                    orderIndex: finalOrderIndex,
                    textContent: dto.textContent ?? null,
                    mediaAssetId,
                    caption: dto.caption ?? null,
                },
                include: { mediaAsset: { select: { uuid: true, kind: true } } },
            });
        });

        await this.bumpVersion(lesson.id);

        return {
            uuid: item.uuid, itemType: item.itemType, orderIndex: item.orderIndex,
            textContent: item.textContent, mediaAssetUuid: item.mediaAsset?.uuid ?? null,
            mediaAssetKind: item.mediaAsset?.kind ?? null, caption: item.caption,
        };
    }

    async updateBlockItem(platformUserUuid: string, lessonUuid: string, blockUuid: string, itemUuid: string, dto: UpdateBlockItemDto) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);
        const block = await this.prisma.lessonContentBlock.findFirst({ where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false } });
        if (!block) throw new NotFoundException('الفقرة غير موجودة');
        const item = await this.prisma.lessonBlockItem.findFirst({ where: { uuid: itemUuid, blockId: block.id, isDeleted: false } });
        if (!item) throw new NotFoundException('العنصر غير موجود');

        const updated = await this.prisma.$transaction(async (tx) => {
            let resolvedMediaAssetId: number | undefined = undefined;
            if (dto.mediaAssetUuid !== undefined) {
                const lockedAsset =
                    await this.mediaLifecycle.resolveAndLockAssetForLink(tx, {
                        assetUuid: dto.mediaAssetUuid,
                        expectedKind: item.itemType as
                            | 'IMAGE'
                            | 'AUDIO'
                            | 'VIDEO',
                        targetOwnerType: 'PLATFORM',
                        previousAssetId: item.mediaAssetId,
                    });
                resolvedMediaAssetId = lockedAsset.id;
            }

            const result = await tx.lessonBlockItem.update({
                where: { id: item.id },
                data: {
                    ...(dto.textContent !== undefined && { textContent: dto.textContent }),
                    ...(resolvedMediaAssetId !== undefined && { mediaAssetId: resolvedMediaAssetId }),
                    ...(dto.caption !== undefined && { caption: dto.caption }),
                },
                include: { mediaAsset: { select: { uuid: true, kind: true } } },
            });

            if (
                resolvedMediaAssetId !== undefined &&
                item.mediaAssetId != null &&
                item.mediaAssetId !== resolvedMediaAssetId
            ) {
                await this.mediaLifecycle.reconcileUnlinkedAssetsUnderLock(tx, [
                    item.mediaAssetId,
                ]);
            }

            return result;
        });

        await this.bumpVersion(lesson.id);

        return {
            uuid: updated.uuid, itemType: updated.itemType, orderIndex: updated.orderIndex,
            textContent: updated.textContent, mediaAssetUuid: updated.mediaAsset?.uuid ?? null,
            mediaAssetKind: updated.mediaAsset?.kind ?? null, caption: updated.caption,
        };
    }

    async deleteBlockItem(platformUserUuid: string, lessonUuid: string, blockUuid: string, itemUuid: string) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);
        const block = await this.prisma.lessonContentBlock.findFirst({ where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false } });
        if (!block) throw new NotFoundException('الفقرة غير موجودة');
        const item = await this.prisma.lessonBlockItem.findFirst({ where: { uuid: itemUuid, blockId: block.id, isDeleted: false } });
        if (!item) throw new NotFoundException('العنصر غير موجود');

        await this.prisma.$transaction(async (tx) => {
            const assetIds = this.mediaLifecycle.normalizeAndSortAssetIds([
                item.mediaAssetId,
            ]);
            if (assetIds.length > 0) {
                await this.mediaLifecycle.lockMediaAssetsForUpdate(
                    tx,
                    assetIds,
                );
            }

            await tx.lessonBlockItem.update({
                where: { id: item.id },
                data: { isDeleted: true, deletedAt: new Date() },
            });

            if (assetIds.length > 0) {
                await this.mediaLifecycle.reconcileUnlinkedAssetsUnderLock(
                    tx,
                    assetIds,
                );
            }
        });
        await this.bumpVersion(lesson.id);
        return { message: 'تم حذف العنصر بنجاح' };
    }

    async reorderBlockItems(platformUserUuid: string, lessonUuid: string, blockUuid: string, dto: ReorderBlockItemsDto) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);
        const block = await this.prisma.lessonContentBlock.findFirst({ where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false } });
        if (!block) throw new NotFoundException('الفقرة غير موجودة');

        // جلب كل العناصر للتحقق من شمولية القائمة
        const allItems = await this.prisma.lessonBlockItem.findMany({ where: { blockId: block.id, isDeleted: false } });
        if (dto.orderedUuids.length !== allItems.length) {
            throw new BadRequestException(
                `يجب إرسال جميع العناصر (${allItems.length}) في قائمة الترتيب`,
            );
        }
        const items = allItems.filter((it) => dto.orderedUuids.includes(it.uuid));
        if (items.length !== dto.orderedUuids.length) throw new NotFoundException('بعض العناصر غير موجودة');

        await this.prisma.$transaction(
            dto.orderedUuids.map((uuid, i) => {
                const item = items.find((it) => it.uuid === uuid)!;
                return this.prisma.lessonBlockItem.update({ where: { id: item.id }, data: { orderIndex: i + 1 } });
            }),
        );
        await this.bumpVersion(lesson.id);
        return { message: 'تم إعادة ترتيب العناصر بنجاح' };
    }

    // ─────── نقل عنصر من فقرة لأخرى ─────────────────────────────────
    async moveItemToBlock(
        platformUserUuid: string,
        lessonUuid: string,
        sourceBlockUuid: string,
        itemUuid: string,
        dto: MoveBlockItemDto,
    ) {
        const { lesson } = await this.assertOwnsLesson(platformUserUuid, lessonUuid);

        const sourceBlock = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: sourceBlockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!sourceBlock) throw new NotFoundException('الفقرة المصدر غير موجودة');

        const targetBlock = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: dto.targetBlockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!targetBlock) throw new NotFoundException('الفقرة الهدف غير موجودة');

        const item = await this.prisma.lessonBlockItem.findFirst({
            where: { uuid: itemUuid, blockId: sourceBlock.id, isDeleted: false },
        });
        if (!item) throw new NotFoundException('العنصر غير موجود');

        if (sourceBlock.id === targetBlock.id) {
            await this.prisma.lessonBlockItem.update({ where: { id: item.id }, data: { orderIndex: dto.targetOrderIndex } });
            const items = await this.prisma.lessonBlockItem.findMany({ where: { blockId: sourceBlock.id, isDeleted: false }, orderBy: { orderIndex: 'asc' } });
            await this.prisma.$transaction(
                items.map((it, i) => this.prisma.lessonBlockItem.update({ where: { id: it.id }, data: { orderIndex: i + 1 } })),
            );
            await this.bumpVersion(lesson.id);
        return { message: 'تم نقل العنصر بنجاح' };
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.lessonBlockItem.update({ where: { id: item.id }, data: { blockId: targetBlock.id, orderIndex: dto.targetOrderIndex } });

            const sourceItems = await tx.lessonBlockItem.findMany({ where: { blockId: sourceBlock.id, isDeleted: false }, orderBy: { orderIndex: 'asc' } });
            for (let i = 0; i < sourceItems.length; i++) {
                await tx.lessonBlockItem.update({ where: { id: sourceItems[i].id }, data: { orderIndex: i + 1 } });
            }

            const targetItems = await tx.lessonBlockItem.findMany({ where: { blockId: targetBlock.id, isDeleted: false }, orderBy: { orderIndex: 'asc' } });
            for (let i = 0; i < targetItems.length; i++) {
                await tx.lessonBlockItem.update({ where: { id: targetItems[i].id }, data: { orderIndex: i + 1 } });
            }
        });

        await this.bumpVersion(lesson.id);
        return { message: 'تم نقل العنصر بنجاح' };
    }
}
