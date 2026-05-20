// src/school/teacher/lessons/teacher-lessons.service.ts
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { MoveBlockItemDto } from './dto/move-block-item.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { CreateBlockItemDto } from './dto/create-block-item.dto';
import { UpdateBlockItemDto } from './dto/update-block-item.dto';
import { ReorderBlocksDto } from './dto/reorder-blocks.dto';
import { ReorderBlockItemsDto } from './dto/reorder-block-items.dto';

@Injectable()
export class TeacherLessonsService {
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
            throw new ForbiddenException('ليس لديك صلاحية لهذه المادة');
        }

        return { teacherId: user.teacher.userId, subjectId: subject.id, userId: user.id };
    }

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق من ملكية درس
    // ─────────────────────────────────────────────────────────
    private async assertTeacherOwnsLesson(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });

        if (!user || !user.teacher) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        const lesson = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonUuid, schoolId, isDeleted: false },
            include: { unit: true },
        });

        if (!lesson) {
            throw new NotFoundException('الدرس غير موجود');
        }

        // تحقق أن المعلم مسند لمادة الدرس
        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: {
                teacherId: user.teacher.userId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    subjectId: lesson.subjectId!,
                    isDeleted: false,
                },
            },
        });

        if (!assignment) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الدرس');
        }

        return { lesson, userId: user.id, teacherId: user.teacher.userId };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-LSN-01 — عرض الدروس مقسّمة بالوحدات
    // ═════════════════════════════════════════════════════════
    async getLessonsByUnits(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
    ) {
        const { subjectId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        const units = await this.prisma.unit.findMany({
            where: { subjectId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                lessonTemplates: {
                    where: { isDeleted: false },
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

        return {
            units: units.map((u) => ({
                id: u.id,
                uuid: u.uuid,
                title: u.title,
                orderIndex: u.orderIndex,
                description: u.description,
                lessons: u.lessonTemplates.map((lt) => {
                    const itemsCount = lt.contentBlocks.reduce(
                        (sum, b) => sum + b._count.items, 0,
                    );
                    return {
                        id: lt.id,
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
            })),
        };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-LSN-02 — إنشاء درس
    // ═════════════════════════════════════════════════════════
    async createLesson(
        schoolId: number,
        userUuid: string,
        subjectUuid: string,
        unitUuid: string,
        dto: CreateLessonDto,
    ) {
        const { subjectId, userId } = await this.assertTeacherOwnsSubject(
            schoolId,
            userUuid,
            subjectUuid,
        );

        // تحقق من الوحدة
        const unit = await this.prisma.unit.findFirst({
            where: { uuid: unitUuid, subjectId, isDeleted: false },
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
                ownerType: 'SCHOOL',
                schoolId,
                subjectId,
                unitId: unit.id,
                title: dto.title,
                orderIndex: dto.orderIndex,
                status: 'DRAFT',
                coverMediaAssetId: dto.coverMediaAssetId ?? null,
                createdByUserId: userId,
            },
        });

        return {
            id: lesson.id,
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
    //  SRS-LSN-03 — تعديل درس
    // ═════════════════════════════════════════════════════════
    async updateLesson(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: UpdateLessonDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        let targetUnitId = lesson.unitId;

        // إذا تم تغيير الوحدة
        if (dto.unitUuid) {
            const newUnit = await this.prisma.unit.findFirst({
                where: {
                    uuid: dto.unitUuid,
                    subjectId: lesson.subjectId,
                    isDeleted: false,
                },
            });

            if (!newUnit) {
                throw new BadRequestException('الوحدة لا تتبع لنفس المادة');
            }

            targetUnitId = newUnit.id;
        }

        // تحقق من فرادة الترتيب في الوحدة المستهدفة
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
            id: updated.id,
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
    //  SRS-LSN-04 — حذف درس
    // ═════════════════════════════════════════════════════════
    async deleteLesson(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        if (lesson.status !== 'DRAFT') {
            throw new BadRequestException(
                'لا يمكن حذف درس غير مسودة. أعده مسودة أولاً.',
            );
        }

        const now = new Date();

        await this.prisma.$transaction([
            // 1. Soft-delete أبناء الأسئلة
            this.prisma.questionOption.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),
            this.prisma.questionMatchingPair.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),
            this.prisma.questionOrderingItem.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),
            this.prisma.questionFillBlank.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),
            this.prisma.questionFillAnswer.updateMany({
                where: { question: { templateId: lesson.id }, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),

            // 2. Soft-delete الأسئلة
            this.prisma.question.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),

            // 3. Soft-delete عناصر الفقرات
            this.prisma.lessonBlockItem.updateMany({
                where: {
                    block: { templateId: lesson.id },
                    isDeleted: false,
                },
                data: { isDeleted: true, deletedAt: now },
            }),

            // 4. Soft-delete الفقرات
            this.prisma.lessonContentBlock.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),

            // 5. Soft-delete الدرس المنشور (لمنع ظهوره للطلاب)
            this.prisma.lesson.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),

            // 6. Soft-delete القالب
            this.prisma.lessonTemplate.update({
                where: { id: lesson.id },
                data: { isDeleted: true, deletedAt: now },
            }),
        ]);

        return { message: 'تم حذف الدرس بنجاح' };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-LSN-06 — تغيير حالة الدرس
    // ═════════════════════════════════════════════════════════
    async updateStatus(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: UpdateStatusDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        // DRAFT → READY: تحقق من الشروط (النظام الجديد: فقرات)
        if (dto.status === 'READY' && lesson.status === 'DRAFT') {
            const blocksCount = await this.prisma.lessonContentBlock.count({
                where: { templateId: lesson.id, isDeleted: false },
            });

            if (blocksCount === 0) {
                throw new BadRequestException(
                    'أضف فقرة واحدة على الأقل قبل تجهيز الدرس.',
                );
            }

            // Phase 3: سؤال واحد على الأقل
            // const questionsCount = await this.prisma.question.count(...)
        }

        // READY → DRAFT: تحقق أن الدرس لم يُنشر
        if (dto.status === 'DRAFT' && lesson.status === 'READY') {
            // Phase 2B: فحص lessons table
            // const publishedCount = await this.prisma.lesson.count({
            //     where: { templateId: lesson.id, isDeleted: false },
            // });
            // if (publishedCount > 0) throw ...
        }

        const updated = await this.prisma.lessonTemplate.update({
            where: { id: lesson.id },
            data: { status: dto.status },
        });

        return {
            id: updated.id,
            uuid: updated.uuid,
            status: updated.status,
            updatedAt: updated.updatedAt,
        };
    }

    // ══════════════════════════════════════════════════════════════
    //  فقرات المحتوى (Content Blocks)
    async getBlocks(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const blocks = await this.prisma.lessonContentBlock.findMany({
            where: { templateId: lesson.id, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                items: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        mediaAsset: { select: { uuid: true, kind: true } },
                    },
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

    // ─────── إنشاء فقرة ──────────────────────────────────────────
    async createBlock(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: CreateBlockDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        // تحقق من تعارض الترتيب
        const existing = await this.prisma.lessonContentBlock.findFirst({
            where: {
                templateId: lesson.id,
                orderIndex: dto.orderIndex,
                isDeleted: false,
            },
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
            data: {
                templateId: lesson.id,
                title: dto.title ?? null,
                orderIndex: finalOrderIndex,
            },
        });

        return {
            uuid: block.uuid,
            title: block.title,
            orderIndex: block.orderIndex,
            items: [],
        };
    }

    // ─────── تعديل فقرة ──────────────────────────────────────────
    async updateBlock(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        blockUuid: string,
        dto: UpdateBlockDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!block) {
            throw new NotFoundException('الفقرة غير موجودة');
        }

        const updated = await this.prisma.lessonContentBlock.update({
            where: { id: block.id },
            data: {
                ...(dto.title !== undefined && { title: dto.title }),
            },
        });

        return {
            uuid: updated.uuid,
            title: updated.title,
            orderIndex: updated.orderIndex,
        };
    }

    // ─────── حذف فقرة (مع عناصرها) ───────────────────────────────
    async deleteBlock(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        blockUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!block) {
            throw new NotFoundException('الفقرة غير موجودة');
        }

        const now = new Date();

        await this.prisma.$transaction([
            // soft-delete العناصر
            this.prisma.lessonBlockItem.updateMany({
                where: { blockId: block.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),
            // soft-delete الفقرة
            this.prisma.lessonContentBlock.update({
                where: { id: block.id },
                data: { isDeleted: true, deletedAt: now },
            }),
        ]);

        return { message: 'تم حذف الفقرة بنجاح' };
    }

    // ─────── إعادة ترتيب الفقرات ─────────────────────────────────
    async reorderBlocks(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: ReorderBlocksDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        // جلب كل الفقرات للتحقق من شمولية القائمة
        const allBlocks = await this.prisma.lessonContentBlock.findMany({
            where: { templateId: lesson.id, isDeleted: false },
        });

        if (dto.orderedUuids.length !== allBlocks.length) {
            throw new BadRequestException(
                `يجب إرسال جميع الفقرات (${allBlocks.length}) في قائمة الترتيب، تم إرسال ${dto.orderedUuids.length} فقط`,
            );
        }

        const blocks = allBlocks.filter((b) => dto.orderedUuids.includes(b.uuid));
        if (blocks.length !== dto.orderedUuids.length) {
            throw new NotFoundException('بعض الفقرات غير موجودة أو لا تنتمي لهذا الدرس');
        }

        // بما أنه لا يوجد unique constraint → يمكن التحديث مباشرة
        await this.prisma.$transaction(
            dto.orderedUuids.map((uuid, i) => {
                const block = blocks.find((b) => b.uuid === uuid)!;
                return this.prisma.lessonContentBlock.update({
                    where: { id: block.id },
                    data: { orderIndex: i + 1 },
                });
            }),
        );

        return { message: 'تم إعادة ترتيب الفقرات بنجاح' };
    }

    // ─────── إضافة عنصر داخل فقرة ────────────────────────────────
    async createBlockItem(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        blockUuid: string,
        dto: CreateBlockItemDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!block) {
            throw new NotFoundException('الفقرة غير موجودة');
        }

        // ترتيب آمن
        let finalOrderIndex = dto.orderIndex;
        const existingOrder = await this.prisma.lessonBlockItem.findFirst({
            where: { blockId: block.id, orderIndex: dto.orderIndex, isDeleted: false },
        });

        if (existingOrder) {
            const maxOrder = await this.prisma.lessonBlockItem.aggregate({
                where: { blockId: block.id, isDeleted: false },
                _max: { orderIndex: true },
            });
            finalOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;
        }

        // Resolve mediaAssetUuid
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

        const item = await this.prisma.lessonBlockItem.create({
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

        return {
            uuid: item.uuid,
            itemType: item.itemType,
            orderIndex: item.orderIndex,
            textContent: item.textContent,
            mediaAssetUuid: item.mediaAsset?.uuid ?? null,
            mediaAssetKind: item.mediaAsset?.kind ?? null,
            caption: item.caption,
        };
    }

    // ─────── تعديل عنصر ──────────────────────────────────────────
    async updateBlockItem(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        blockUuid: string,
        itemUuid: string,
        dto: UpdateBlockItemDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!block) {
            throw new NotFoundException('الفقرة غير موجودة');
        }

        const item = await this.prisma.lessonBlockItem.findFirst({
            where: { uuid: itemUuid, blockId: block.id, isDeleted: false },
        });

        if (!item) {
            throw new NotFoundException('العنصر غير موجود');
        }

        // Resolve mediaAssetUuid
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

        const updated = await this.prisma.lessonBlockItem.update({
            where: { id: item.id },
            data: {
                ...(dto.textContent !== undefined && { textContent: dto.textContent }),
                ...(resolvedMediaAssetId !== undefined && { mediaAssetId: resolvedMediaAssetId }),
                ...(dto.caption !== undefined && { caption: dto.caption }),
            },
            include: { mediaAsset: { select: { uuid: true, kind: true } } },
        });

        return {
            uuid: updated.uuid,
            itemType: updated.itemType,
            orderIndex: updated.orderIndex,
            textContent: updated.textContent,
            mediaAssetUuid: updated.mediaAsset?.uuid ?? null,
            mediaAssetKind: updated.mediaAsset?.kind ?? null,
            caption: updated.caption,
        };
    }

    // ─────── حذف عنصر ────────────────────────────────────────────
    async deleteBlockItem(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        blockUuid: string,
        itemUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!block) {
            throw new NotFoundException('الفقرة غير موجودة');
        }

        const item = await this.prisma.lessonBlockItem.findFirst({
            where: { uuid: itemUuid, blockId: block.id, isDeleted: false },
        });

        if (!item) {
            throw new NotFoundException('العنصر غير موجود');
        }

        await this.prisma.lessonBlockItem.update({
            where: { id: item.id },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        return { message: 'تم حذف العنصر بنجاح' };
    }

    // ─────── إعادة ترتيب العناصر ─────────────────────────────────
    async reorderBlockItems(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        blockUuid: string,
        dto: ReorderBlockItemsDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const block = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: blockUuid, templateId: lesson.id, isDeleted: false },
        });

        if (!block) {
            throw new NotFoundException('الفقرة غير موجودة');
        }

        // جلب كل العناصر للتحقق من شمولية القائمة
        const allItems = await this.prisma.lessonBlockItem.findMany({
            where: { blockId: block.id, isDeleted: false },
        });

        if (dto.orderedUuids.length !== allItems.length) {
            throw new BadRequestException(
                `يجب إرسال جميع العناصر (${allItems.length}) في قائمة الترتيب، تم إرسال ${dto.orderedUuids.length} فقط`,
            );
        }

        const items = allItems.filter((it) => dto.orderedUuids.includes(it.uuid));
        if (items.length !== dto.orderedUuids.length) {
            throw new NotFoundException('بعض العناصر غير موجودة أو لا تنتمي لهذه الفقرة');
        }

        await this.prisma.$transaction(
            dto.orderedUuids.map((uuid, i) => {
                const item = items.find((it) => it.uuid === uuid)!;
                return this.prisma.lessonBlockItem.update({
                    where: { id: item.id },
                    data: { orderIndex: i + 1 },
                });
            }),
        );

        return { message: 'تم إعادة ترتيب العناصر بنجاح' };
    }

    // ─────── نقل عنصر من فقرة لأخرى ─────────────────────────────────
    async moveItemToBlock(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        sourceBlockUuid: string,
        itemUuid: string,
        dto: MoveBlockItemDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        // التحقق من الفقرة المصدر
        const sourceBlock = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: sourceBlockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!sourceBlock) {
            throw new NotFoundException('الفقرة المصدر غير موجودة');
        }

        // التحقق من الفقرة الهدف
        const targetBlock = await this.prisma.lessonContentBlock.findFirst({
            where: { uuid: dto.targetBlockUuid, templateId: lesson.id, isDeleted: false },
        });
        if (!targetBlock) {
            throw new NotFoundException('الفقرة الهدف غير موجودة');
        }

        // التحقق من العنصر
        const item = await this.prisma.lessonBlockItem.findFirst({
            where: { uuid: itemUuid, blockId: sourceBlock.id, isDeleted: false },
        });
        if (!item) {
            throw new NotFoundException('العنصر غير موجود');
        }

        // إذا نفس الفقرة — مجرد إعادة ترتيب
        if (sourceBlock.id === targetBlock.id) {
            await this.prisma.lessonBlockItem.update({
                where: { id: item.id },
                data: { orderIndex: dto.targetOrderIndex },
            });
            // إعادة ترقيم كل عناصر الفقرة
            const items = await this.prisma.lessonBlockItem.findMany({
                where: { blockId: sourceBlock.id, isDeleted: false },
                orderBy: { orderIndex: 'asc' },
            });
            await this.prisma.$transaction(
                items.map((it, i) =>
                    this.prisma.lessonBlockItem.update({
                        where: { id: it.id },
                        data: { orderIndex: i + 1 },
                    }),
                ),
            );
            return { message: 'تم نقل العنصر بنجاح' };
        }

        // نقل بين فقرتين مختلفتين
        await this.prisma.$transaction(async (tx) => {
            // 1. نقل العنصر للفقرة الهدف
            await tx.lessonBlockItem.update({
                where: { id: item.id },
                data: {
                    blockId: targetBlock.id,
                    orderIndex: dto.targetOrderIndex,
                },
            });

            // 2. إعادة ترقيم عناصر الفقرة المصدر
            const sourceItems = await tx.lessonBlockItem.findMany({
                where: { blockId: sourceBlock.id, isDeleted: false },
                orderBy: { orderIndex: 'asc' },
            });
            for (let i = 0; i < sourceItems.length; i++) {
                await tx.lessonBlockItem.update({
                    where: { id: sourceItems[i].id },
                    data: { orderIndex: i + 1 },
                });
            }

            // 3. إعادة ترقيم عناصر الفقرة الهدف
            const targetItems = await tx.lessonBlockItem.findMany({
                where: { blockId: targetBlock.id, isDeleted: false },
                orderBy: { orderIndex: 'asc' },
            });
            for (let i = 0; i < targetItems.length; i++) {
                await tx.lessonBlockItem.update({
                    where: { id: targetItems[i].id },
                    data: { orderIndex: i + 1 },
                });
            }
        });

        return { message: 'تم نقل العنصر بنجاح' };
    }
}
