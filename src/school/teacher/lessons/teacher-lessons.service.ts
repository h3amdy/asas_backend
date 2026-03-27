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
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ReorderContentsDto } from './dto/reorder-contents.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

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
                    subjectId: lesson.subjectId,
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
                                contents: { where: { isDeleted: false } },
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
                lessons: u.lessonTemplates.map((lt) => ({
                    id: lt.id,
                    uuid: lt.uuid,
                    title: lt.title,
                    orderIndex: lt.orderIndex,
                    status: lt.status,
                    coverMediaAssetId: lt.coverMediaAssetId,
                    contentsCount: lt._count.contents,
                    questionsCount: 0, // Phase 3
                })),
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
            contentsCount: 0,
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
            // Soft-delete المحتوى
            this.prisma.lessonContent.updateMany({
                where: { templateId: lesson.id, isDeleted: false },
                data: { isDeleted: true, deletedAt: now },
            }),

            // Soft-delete القالب
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

        // DRAFT → READY: تحقق من الشروط
        if (dto.status === 'READY' && lesson.status === 'DRAFT') {
            const contentsCount = await this.prisma.lessonContent.count({
                where: { templateId: lesson.id, isDeleted: false },
            });

            if (contentsCount === 0) {
                throw new BadRequestException(
                    'أضف محتوى واحد على الأقل قبل تجهيز الدرس.',
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

    // ═════════════════════════════════════════════════════════
    //  SRS-LSN-05 — جلب محتوى الدرس
    // ═════════════════════════════════════════════════════════
    async getContents(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const contents = await this.prisma.lessonContent.findMany({
            where: { templateId: lesson.id, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: { mediaAsset: { select: { uuid: true } } },
        });

        return {
            contents: contents.map((c) => ({
                id: c.id,
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
    //  SRS-LSN-05 — إضافة كتلة محتوى
    // ═════════════════════════════════════════════════════════
    async createContent(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: CreateContentDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        // قيد AUDIO واحد فقط (BR-03)
        if (dto.type === 'AUDIO') {
            const existingAudio = await this.prisma.lessonContent.findFirst({
                where: {
                    templateId: lesson.id,
                    type: 'AUDIO',
                    isDeleted: false,
                },
            });

            if (existingAudio) {
                throw new ConflictException(
                    'مسموح بمقطع صوتي واحد فقط للدرس.',
                );
            }
        }

        // تحديد ترتيب آمن — فحص جميع السجلات (بما فيها المحذوفة)
        // لأن قيد unique في قاعدة البيانات يشمل جميع الصفوف
        let finalOrderIndex = dto.orderIndex;
        const existingOrder = await this.prisma.lessonContent.findFirst({
            where: {
                templateId: lesson.id,
                orderIndex: dto.orderIndex,
                // لا نفلتر بـ isDeleted لأن الـ unique constraint يشمل الكل
            },
        });

        if (existingOrder) {
            // اختر أعلى ترتيب + 1 من جميع السجلات (بما فيها المحذوفة)
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
                where: { uuid: dto.mediaAssetUuid, schoolId, isDeleted: false },
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
            id: content.id,
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
    //  SRS-LSN-05 — تعديل كتلة محتوى
    // ═════════════════════════════════════════════════════════
    async updateContent(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        contentUuid: string,
        dto: UpdateContentDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const content = await this.prisma.lessonContent.findFirst({
            where: {
                uuid: contentUuid,
                templateId: lesson.id,
                isDeleted: false,
            },
        });

        if (!content) {
            throw new NotFoundException('كتلة المحتوى غير موجودة');
        }

        // Resolve mediaAssetUuid → mediaAssetId
        let resolvedMediaAssetId: number | undefined = undefined;
        if (dto.mediaAssetUuid !== undefined) {
            const asset = await this.prisma.mediaAsset.findFirst({
                where: { uuid: dto.mediaAssetUuid, schoolId, isDeleted: false },
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
            id: updated.id,
            uuid: updated.uuid,
            type: updated.type,
            title: updated.title,
            contentText: updated.contentText,
            mediaAssetId: updated.mediaAssetId,
            orderIndex: updated.orderIndex,
        };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-LSN-05 — حذف كتلة محتوى
    // ═════════════════════════════════════════════════════════
    async deleteContent(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        contentUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const content = await this.prisma.lessonContent.findFirst({
            where: {
                uuid: contentUuid,
                templateId: lesson.id,
                isDeleted: false,
            },
        });

        if (!content) {
            throw new NotFoundException('كتلة المحتوى غير موجودة');
        }

        await this.prisma.lessonContent.update({
            where: { id: content.id },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                // تحرير الـ orderIndex من قيد الـ unique constraint
                // بتعيينه قيمة سالبة فريدة (سالب الـ id)
                orderIndex: -content.id,
            },
        });

        return { message: 'تم حذف كتلة المحتوى بنجاح' };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-LSN-05 — إعادة ترتيب كتل المحتوى
    // ═════════════════════════════════════════════════════════
    async reorderContents(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: ReorderContentsDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(
            schoolId,
            userUuid,
            lessonUuid,
        );

        const contents = await this.prisma.lessonContent.findMany({
            where: {
                templateId: lesson.id,
                isDeleted: false,
                uuid: { in: dto.orderedUuids },
            },
        });

        if (contents.length !== dto.orderedUuids.length) {
            throw new NotFoundException(
                'بعض كتل المحتوى غير موجودة أو لا تنتمي لهذا الدرس',
            );
        }

        // نفس نمط الوحدات: أرقام سالبة مؤقتة ثم النهائية
        await this.prisma.$transaction(async (tx) => {
            // مرحلة 1: أرقام سالبة مؤقتة (كبيرة لتجنب التعارض مع السجلات المحذوفة)
            for (let i = 0; i < dto.orderedUuids.length; i++) {
                const content = contents.find((c) => c.uuid === dto.orderedUuids[i]);
                if (content) {
                    await tx.lessonContent.update({
                        where: { id: content.id },
                        data: { orderIndex: -(10000 + i + 1) },
                    });
                }
            }

            // مرحلة 2: الأرقام النهائية
            for (let i = 0; i < dto.orderedUuids.length; i++) {
                const content = contents.find((c) => c.uuid === dto.orderedUuids[i]);
                if (content) {
                    await tx.lessonContent.update({
                        where: { id: content.id },
                        data: { orderIndex: i + 1 },
                    });
                }
            }
        });

        return { message: 'تم إعادة ترتيب المحتوى بنجاح' };
    }
}
