// src/school/shared/platform-content/platform-content.service.ts
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 📖 خدمة محتوى المنصة — مكتبة المنصة للمعلم
 *
 * توفر:
 * 1. عرض دروس المنصة الموزعة للمدرسة
 * 2. تفاصيل درس كاملة (blocks + items + questions)
 * 3. Fork: نسخ درس إلى دروس المعلم
 * 4. Fork & Publish: نسخ + نشر مباشر مع استهداف شُعب
 */
@Injectable()
export class PlatformContentService {
    constructor(private readonly prisma: PrismaService) {}

    // ─── Helpers ─────────────────────────────────────────────

    /**
     * جلب سياق المعلم والتحقق من صلاحياته
     */
    private async getTeacherContext(schoolId: number, userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });
        if (!user || !user.teacher) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }
        return { userId: user.id, teacherId: user.teacher.userId };
    }

    /**
     * جلب المواد المسندة للمعلم التي لديها subjectDictionaryId
     */
    private async getTeacherSubjectsWithDict(schoolId: number, teacherId: number) {
        const assignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    subject: {
                        isDeleted: false,
                        dictionaryId: { not: null },
                    },
                },
            },
            include: {
                subjectSection: {
                    include: {
                        subject: {
                            include: {
                                grade: true,
                                dictionary: true,
                            },
                        },
                    },
                },
            },
        });

        // Deduplicate by subject id
        const subjectMap = new Map<number, typeof assignments[0]['subjectSection']['subject']>();
        for (const a of assignments) {
            const sub = a.subjectSection.subject;
            if (!subjectMap.has(sub.id)) {
                subjectMap.set(sub.id, sub);
            }
        }
        return Array.from(subjectMap.values());
    }

    // ═══════════════════════════════════════════════════════════
    //  1. قائمة دروس المنصة الموزعة
    // ═══════════════════════════════════════════════════════════

    async getPlatformLessons(schoolId: number, userUuid: string) {
        const { teacherId } = await this.getTeacherContext(schoolId, userUuid);
        const teacherSubjects = await this.getTeacherSubjectsWithDict(schoolId, teacherId);

        if (teacherSubjects.length === 0) {
            return { subjects: [] };
        }

        // جمع dictionaryIds للمواد المسندة
        const dictIds = teacherSubjects
            .map((s) => s.dictionaryId!)
            .filter((id) => id != null);

        // جلب التوزيعات النشطة لهذه المدرسة
        const allDistributions = await this.prisma.contentDistribution.findMany({
            where: {
                schoolId,
                status: 'ACTIVE',
                isDeleted: false,
            },
            include: {
                sourceLessonTemplate: {
                    include: {
                        unit: { select: { uuid: true, title: true, orderIndex: true } },
                        subjectDictionary: { select: { uuid: true, defaultName: true } },
                        _count: {
                            select: {
                                contentBlocks: { where: { isDeleted: false } },
                                questions: { where: { isDeleted: false } },
                            },
                        },
                    },
                },
                schoolLessonTemplate: {
                    select: {
                        id: true,
                        uuid: true,
                        isDeleted: true,
                        sourceVersion: true,
                    },
                },
            },
        });

        // تصفية: فقط دروس المنصة المرتبطة بمواد المعلم
        const distributions = allDistributions.filter((d) => {
            const src = d.sourceLessonTemplate;
            return src
                && !src.isDeleted
                && src.ownerType === 'PLATFORM'
                && src.subjectDictionaryId != null
                && dictIds.includes(src.subjectDictionaryId);
        });

        // تجميع حسب المادة → الوحدة → الدروس
        type SubjectGroup = {
            subjectDictUuid: string;
            subjectName: string;
            gradeName: string;
            schoolSubjectUuid: string;
            units: Map<string, {
                unitUuid: string;
                unitTitle: string;
                orderIndex: number;
                lessons: any[];
            }>;
        };

        const subjectGroups = new Map<number, SubjectGroup>();

        for (const dist of distributions) {
            const src = dist.sourceLessonTemplate;
            const dictId = src.subjectDictionaryId!;
            const teacherSub = teacherSubjects.find((s) => s.dictionaryId === dictId);
            if (!teacherSub) continue;

            if (!subjectGroups.has(dictId)) {
                subjectGroups.set(dictId, {
                    subjectDictUuid: src.subjectDictionary!.uuid,
                    subjectName: src.subjectDictionary!.defaultName,
                    gradeName: teacherSub.grade.displayName,
                    schoolSubjectUuid: teacherSub.uuid,
                    units: new Map(),
                });
            }

            const group = subjectGroups.get(dictId)!;
            const unitKey = src.unit?.uuid ?? '__no_unit__';

            if (!group.units.has(unitKey)) {
                group.units.set(unitKey, {
                    unitUuid: src.unit?.uuid ?? '',
                    unitTitle: src.unit?.title ?? 'بدون وحدة',
                    orderIndex: src.unit?.orderIndex ?? 0,
                    lessons: [],
                });
            }

            // تحديد الحالة
            const forkedTemplate = dist.schoolLessonTemplate;
            const isForked = forkedTemplate && !forkedTemplate.isDeleted;
            let state: 'new' | 'updated' | 'forked' = 'new';

            if (isForked) {
                if (src.templateVersion > (forkedTemplate.sourceVersion ?? 0)) {
                    state = 'updated';
                } else {
                    state = 'forked';
                }
            }

            group.units.get(unitKey)!.lessons.push({
                distributionUuid: dist.uuid,
                lessonUuid: src.uuid,
                title: src.title,
                templateVersion: src.templateVersion,
                blocksCount: src._count.contentBlocks,
                questionsCount: src._count.questions,
                state,
                forkedLessonUuid: isForked ? forkedTemplate.uuid : null,
                sourceVersionAtFork: isForked ? forkedTemplate.sourceVersion : null,
            });
        }

        // تحويل Map → مصفوفة مرتبة
        const subjects = Array.from(subjectGroups.values()).map((group) => ({
            subjectDictUuid: group.subjectDictUuid,
            subjectName: group.subjectName,
            gradeName: group.gradeName,
            schoolSubjectUuid: group.schoolSubjectUuid,
            units: Array.from(group.units.values())
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((u) => ({
                    unitUuid: u.unitUuid,
                    unitTitle: u.unitTitle,
                    lessons: u.lessons,
                })),
        }));

        return { subjects };
    }

    // ═══════════════════════════════════════════════════════════
    //  2. تفاصيل درس المنصة
    // ═══════════════════════════════════════════════════════════

    async getPlatformLessonDetail(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        await this.getTeacherContext(schoolId, userUuid);

        // التحقق أن الدرس موزع لهذه المدرسة
        const distribution = await this.prisma.contentDistribution.findFirst({
            where: {
                schoolId,
                status: 'ACTIVE',
                isDeleted: false,
                sourceLessonTemplate: { uuid: lessonUuid, isDeleted: false },
            },
        });

        if (!distribution) {
            throw new NotFoundException('هذا الدرس غير متاح لمدرستك');
        }

        // جلب الدرس مع كامل المحتوى
        const lesson = await this.prisma.lessonTemplate.findFirst({
            where: { uuid: lessonUuid, isDeleted: false },
            include: {
                contentBlocks: {
                    where: { isDeleted: false },
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
                },
                questions: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        options: {
                            where: { isDeleted: false },
                            orderBy: { orderIndex: 'asc' },
                            include: {
                                imageAsset: { select: { uuid: true, kind: true } },
                                audioAsset: { select: { uuid: true, kind: true } },
                            },
                        },
                        matchingPairs: {
                            where: { isDeleted: false },
                            include: {
                                leftImageAsset: { select: { uuid: true, kind: true } },
                                leftAudioAsset: { select: { uuid: true, kind: true } },
                                rightImageAsset: { select: { uuid: true, kind: true } },
                                rightAudioAsset: { select: { uuid: true, kind: true } },
                            },
                        },
                        orderingItems: {
                            where: { isDeleted: false },
                            orderBy: { orderIndex: 'asc' },
                            include: {
                                imageAsset: { select: { uuid: true, kind: true } },
                                audioAsset: { select: { uuid: true, kind: true } },
                            },
                        },
                        fillBlanks: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
                        fillAnswers: { where: { isDeleted: false } },
                        questionImageAsset: { select: { uuid: true, kind: true } },
                        questionAudioAsset: { select: { uuid: true, kind: true } },
                    },
                },
            },
        });

        if (!lesson) {
            throw new NotFoundException('الدرس غير موجود');
        }

        return {
            uuid: lesson.uuid,
            title: lesson.title,
            templateVersion: lesson.templateVersion,
            isReadOnly: true,
            blocks: lesson.contentBlocks.map((b) => ({
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
            questions: lesson.questions.map((q) => ({
                uuid: q.uuid,
                type: q.type,
                orderIndex: q.orderIndex,
                questionText: q.questionText,
                instructionText: q.instructionText,
                explanationText: q.explanationText,
                questionImageAssetUuid: q.questionImageAsset?.uuid ?? null,
                questionAudioAssetUuid: q.questionAudioAsset?.uuid ?? null,
                score: q.score,
                options: q.options.map((o) => ({
                    uuid: o.uuid,
                    optionText: o.optionText,
                    imageAssetUuid: o.imageAsset?.uuid ?? null,
                    audioAssetUuid: o.audioAsset?.uuid ?? null,
                    isCorrect: o.isCorrect,
                    orderIndex: o.orderIndex,
                })),
                matchingPairs: q.matchingPairs.map((p) => ({
                    uuid: p.uuid,
                    pairKey: p.pairKey,
                    leftText: p.leftText,
                    leftImageAssetUuid: p.leftImageAsset?.uuid ?? null,
                    leftAudioAssetUuid: p.leftAudioAsset?.uuid ?? null,
                    rightText: p.rightText,
                    rightImageAssetUuid: p.rightImageAsset?.uuid ?? null,
                    rightAudioAssetUuid: p.rightAudioAsset?.uuid ?? null,
                })),
                orderingItems: q.orderingItems.map((oi) => ({
                    uuid: oi.uuid,
                    itemText: oi.itemText,
                    imageAssetUuid: oi.imageAsset?.uuid ?? null,
                    audioAssetUuid: oi.audioAsset?.uuid ?? null,
                    correctIndex: oi.correctIndex,
                    orderIndex: oi.orderIndex,
                })),
                fillBlanks: q.fillBlanks.map((fb) => ({
                    uuid: fb.uuid,
                    blankKey: fb.blankKey,
                    orderIndex: fb.orderIndex,
                    placeholder: fb.placeholder,
                })),
                fillAnswers: q.fillAnswers.map((fa) => ({
                    uuid: fa.uuid,
                    blankKey: fa.blankKey,
                    answerText: fa.answerText,
                    isPrimary: fa.isPrimary,
                })),
            })),
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  3. Fork — نسخ درس إلى دروس المعلم
    // ═══════════════════════════════════════════════════════════

    async forkLesson(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        const { userId, teacherId } = await this.getTeacherContext(schoolId, userUuid);

        // 1. التحقق من التوزيع
        const distribution = await this.prisma.contentDistribution.findFirst({
            where: {
                schoolId,
                status: 'ACTIVE',
                isDeleted: false,
                sourceLessonTemplate: { uuid: lessonUuid, isDeleted: false },
            },
            include: {
                sourceLessonTemplate: {
                    include: {
                        subjectDictionary: true,
                        unit: true,
                    },
                },
                schoolLessonTemplate: { select: { id: true, isDeleted: true } },
            },
        });

        if (!distribution) {
            throw new NotFoundException('هذا الدرس غير متاح لمدرستك');
        }

        // 2. التحقق من عدم النسخ المسبق
        if (distribution.schoolLessonTemplate && !distribution.schoolLessonTemplate.isDeleted) {
            throw new ConflictException('تم نسخ هذا الدرس مسبقاً');
        }

        const source = distribution.sourceLessonTemplate;
        const dictId = source.subjectDictionaryId;

        if (!dictId) {
            throw new BadRequestException('الدرس غير مرتبط بمادة رسمية');
        }

        // 3. إيجاد المادة المدرسية المرتبطة بنفس SubjectDictionary
        const schoolSubject = await this.prisma.subject.findFirst({
            where: {
                schoolId,
                dictionaryId: dictId,
                isDeleted: false,
            },
        });

        if (!schoolSubject) {
            throw new BadRequestException('لا توجد مادة مدرسية مرتبطة بهذه المادة الرسمية');
        }

        // التحقق أن المعلم مسند لهذه المادة
        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: { subjectId: schoolSubject.id, isDeleted: false },
            },
        });

        if (!assignment) {
            throw new ForbiddenException('ليس لديك صلاحية لهذه المادة');
        }

        // 4. إيجاد أو إنشاء الوحدة بنفس الاسم
        let targetUnitId: number | null = null;
        if (source.unit) {
            let unit = await this.prisma.unit.findFirst({
                where: {
                    subjectId: schoolSubject.id,
                    title: source.unit.title,
                    isDeleted: false,
                },
            });

            if (!unit) {
                // إنشاء وحدة جديدة بنفس الاسم
                const maxOrder = await this.prisma.unit.aggregate({
                    where: { subjectId: schoolSubject.id, isDeleted: false },
                    _max: { orderIndex: true },
                });

                unit = await this.prisma.unit.create({
                    data: {
                        subjectId: schoolSubject.id,
                        title: source.unit.title,
                        orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
                    },
                });
            }
            targetUnitId = unit.id;
        }

        // 5. Deep copy in transaction
        return await this.prisma.$transaction(async (tx) => {
            // ترتيب آمن
            const maxOrder = await tx.lessonTemplate.aggregate({
                where: {
                    unitId: targetUnitId,
                    isDeleted: false,
                },
                _max: { orderIndex: true },
            });
            const newOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;

            // 5a. نسخ LessonTemplate
            const newTemplate = await tx.lessonTemplate.create({
                data: {
                    ownerType: 'SCHOOL',
                    schoolId,
                    subjectId: schoolSubject.id,
                    unitId: targetUnitId,
                    title: source.title,
                    orderIndex: newOrderIndex,
                    status: 'DRAFT',
                    coverMediaAssetId: source.coverMediaAssetId,
                    templateVersion: 1,
                    sourceTemplateId: source.id,
                    sourceVersion: source.templateVersion,
                    createdByUserId: userId,
                },
            });

            // 5b. نسخ ContentBlocks + Items
            await this.copyBlocksAndItems(tx, source.id, newTemplate.id);

            // 5c. نسخ Questions + all sub-types
            await this.copyQuestions(tx, source.id, newTemplate.id);

            // 5d. تحديث ContentDistribution
            await tx.contentDistribution.update({
                where: { id: distribution.id },
                data: { schoolLessonTemplateId: newTemplate.id },
            });

            return {
                schoolLesson: {
                    uuid: newTemplate.uuid,
                    title: newTemplate.title,
                    status: newTemplate.status,
                    sourceTemplateId: source.id,
                    sourceVersion: source.templateVersion,
                },
                message: 'تم إضافة الدرس إلى دروسك — يمكنك تعديله ونشره الآن',
            };
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  4. Fork & Publish — نسخ + نشر مباشر
    // ═══════════════════════════════════════════════════════════

    async forkAndPublish(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        sectionUuids: string[],
    ) {
        if (!sectionUuids || sectionUuids.length === 0) {
            throw new BadRequestException('يجب اختيار شعبة واحدة على الأقل');
        }

        const { userId, teacherId } = await this.getTeacherContext(schoolId, userUuid);

        // 1. التحقق من التوزيع (نفس منطق fork)
        const distribution = await this.prisma.contentDistribution.findFirst({
            where: {
                schoolId,
                status: 'ACTIVE',
                isDeleted: false,
                sourceLessonTemplate: { uuid: lessonUuid, isDeleted: false },
            },
            include: {
                sourceLessonTemplate: {
                    include: {
                        subjectDictionary: true,
                        unit: true,
                    },
                },
                schoolLessonTemplate: { select: { id: true, isDeleted: true } },
            },
        });

        if (!distribution) {
            throw new NotFoundException('هذا الدرس غير متاح لمدرستك');
        }

        if (distribution.schoolLessonTemplate && !distribution.schoolLessonTemplate.isDeleted) {
            throw new ConflictException('تم نسخ هذا الدرس مسبقاً');
        }

        const source = distribution.sourceLessonTemplate;
        const dictId = source.subjectDictionaryId;

        if (!dictId) {
            throw new BadRequestException('الدرس غير مرتبط بمادة رسمية');
        }

        // المادة المدرسية
        const schoolSubject = await this.prisma.subject.findFirst({
            where: { schoolId, dictionaryId: dictId, isDeleted: false },
        });
        if (!schoolSubject) {
            throw new BadRequestException('لا توجد مادة مدرسية مرتبطة');
        }

        // التحقق من الصلاحية
        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: {
                teacherId, isDeleted: false, isActive: true,
                subjectSection: { subjectId: schoolSubject.id, isDeleted: false },
            },
        });
        if (!assignment) {
            throw new ForbiddenException('ليس لديك صلاحية لهذه المادة');
        }

        // التحقق من الشُعب
        const sections = await this.prisma.section.findMany({
            where: { uuid: { in: sectionUuids }, isDeleted: false, isActive: true, grade: { schoolId } },
        });
        if (sections.length !== sectionUuids.length) {
            throw new BadRequestException('بعض الشُعب غير موجودة');
        }

        // السنة والفصل الحالي
        const cy = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: { terms: { where: { isCurrent: true, isDeleted: false }, take: 1 } },
        });
        if (!cy || cy.terms.length === 0) {
            throw new BadRequestException('لا يوجد سنة أو فصل دراسي حالي');
        }

        // الوحدة
        let targetUnitId: number | null = null;
        if (source.unit) {
            let unit = await this.prisma.unit.findFirst({
                where: { subjectId: schoolSubject.id, title: source.unit.title, isDeleted: false },
            });
            if (!unit) {
                const maxOrder = await this.prisma.unit.aggregate({
                    where: { subjectId: schoolSubject.id, isDeleted: false },
                    _max: { orderIndex: true },
                });
                unit = await this.prisma.unit.create({
                    data: {
                        subjectId: schoolSubject.id,
                        title: source.unit.title,
                        orderIndex: (maxOrder._max.orderIndex ?? 0) + 1,
                    },
                });
            }
            targetUnitId = unit.id;
        }

        // Transaction: Fork + Create Lesson + Target + Publish
        return await this.prisma.$transaction(async (tx) => {
            // ترتيب آمن
            const maxOrder = await tx.lessonTemplate.aggregate({
                where: { unitId: targetUnitId, isDeleted: false },
                _max: { orderIndex: true },
            });
            const newOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;

            // Fork LessonTemplate
            const newTemplate = await tx.lessonTemplate.create({
                data: {
                    ownerType: 'SCHOOL',
                    schoolId,
                    subjectId: schoolSubject.id,
                    unitId: targetUnitId,
                    title: source.title,
                    orderIndex: newOrderIndex,
                    status: 'PUBLISHED',
                    coverMediaAssetId: source.coverMediaAssetId,
                    templateVersion: 1,
                    sourceTemplateId: source.id,
                    sourceVersion: source.templateVersion,
                    createdByUserId: userId,
                },
            });

            // Copy content
            await this.copyBlocksAndItems(tx, source.id, newTemplate.id);
            await this.copyQuestions(tx, source.id, newTemplate.id);

            // Update distribution
            await tx.contentDistribution.update({
                where: { id: distribution.id },
                data: { schoolLessonTemplateId: newTemplate.id },
            });

            // Create published Lesson
            const lesson = await tx.lesson.create({
                data: {
                    templateId: newTemplate.id,
                    schoolId,
                    teacherId,
                    subjectId: schoolSubject.id,
                    yearId: cy.id,
                    termId: cy.terms[0].id,
                    status: 'PUBLISHED',
                    deliveryMethod: 'OPEN',
                    linkType: 'ADDITIONAL',
                    publishedAt: new Date(),
                },
            });

            // Create LessonTargets
            for (const sec of sections) {
                await tx.lessonTarget.create({
                    data: { lessonId: lesson.id, sectionId: sec.id },
                });
            }

            // Delivery Log
            await tx.lessonDeliveryLog.create({
                data: {
                    lessonId: lesson.id,
                    actorUserId: userId,
                    action: 'PUBLISH',
                    policyAtTime: 'OPEN',
                    details: JSON.stringify({
                        source: 'platform_fork_and_publish',
                        targetCount: sections.length,
                        sourceLessonUuid: lessonUuid,
                    }),
                },
            });

            return {
                schoolLesson: {
                    uuid: newTemplate.uuid,
                    title: newTemplate.title,
                    status: newTemplate.status,
                },
                assignedSections: sections.length,
                message: 'تم نشر الدرس مباشرة على الشعب المختارة',
            };
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  Deep Copy Helpers
    // ═══════════════════════════════════════════════════════════

    /**
     * نسخ ContentBlocks + BlockItems
     */
    private async copyBlocksAndItems(
        tx: any,
        sourceTemplateId: number,
        targetTemplateId: number,
    ) {
        const blocks = await tx.lessonContentBlock.findMany({
            where: { templateId: sourceTemplateId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                items: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                },
            },
        });

        for (const block of blocks) {
            const newBlock = await tx.lessonContentBlock.create({
                data: {
                    templateId: targetTemplateId,
                    title: block.title,
                    orderIndex: block.orderIndex,
                },
            });

            for (const item of block.items) {
                await tx.lessonBlockItem.create({
                    data: {
                        blockId: newBlock.id,
                        itemType: item.itemType,
                        orderIndex: item.orderIndex,
                        textContent: item.textContent,
                        mediaAssetId: item.mediaAssetId, // نفس الوسيط
                        caption: item.caption,
                        metadataJson: item.metadataJson,
                    },
                });
            }
        }
    }

    /**
     * نسخ Questions + Options + MatchingPairs + OrderingItems + FillBlanks + FillAnswers
     */
    private async copyQuestions(
        tx: any,
        sourceTemplateId: number,
        targetTemplateId: number,
    ) {
        const questions = await tx.question.findMany({
            where: { templateId: sourceTemplateId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                options: { where: { isDeleted: false } },
                matchingPairs: { where: { isDeleted: false } },
                orderingItems: { where: { isDeleted: false } },
                fillBlanks: { where: { isDeleted: false } },
                fillAnswers: { where: { isDeleted: false } },
            },
        });

        for (const q of questions) {
            const newQ = await tx.question.create({
                data: {
                    templateId: targetTemplateId,
                    type: q.type,
                    orderIndex: q.orderIndex,
                    instructionText: q.instructionText,
                    questionText: q.questionText,
                    questionImageAssetId: q.questionImageAssetId,
                    questionAudioAssetId: q.questionAudioAssetId,
                    score: q.score,
                    explanationText: q.explanationText,
                    explanationImageAssetId: q.explanationImageAssetId,
                    explanationAudioAssetId: q.explanationAudioAssetId,
                },
            });

            // Options (MCQ / TRUE_FALSE)
            for (const o of q.options) {
                await tx.questionOption.create({
                    data: {
                        questionId: newQ.id,
                        optionText: o.optionText,
                        imageAssetId: o.imageAssetId,
                        audioAssetId: o.audioAssetId,
                        isCorrect: o.isCorrect,
                        orderIndex: o.orderIndex,
                    },
                });
            }

            // Matching Pairs
            for (const p of q.matchingPairs) {
                await tx.questionMatchingPair.create({
                    data: {
                        questionId: newQ.id,
                        pairKey: p.pairKey,
                        leftText: p.leftText,
                        leftImageAssetId: p.leftImageAssetId,
                        leftAudioAssetId: p.leftAudioAssetId,
                        rightText: p.rightText,
                        rightImageAssetId: p.rightImageAssetId,
                        rightAudioAssetId: p.rightAudioAssetId,
                        leftOrderIndex: p.leftOrderIndex,
                        rightOrderIndex: p.rightOrderIndex,
                    },
                });
            }

            // Ordering Items
            for (const oi of q.orderingItems) {
                await tx.questionOrderingItem.create({
                    data: {
                        questionId: newQ.id,
                        itemText: oi.itemText,
                        imageAssetId: oi.imageAssetId,
                        audioAssetId: oi.audioAssetId,
                        correctIndex: oi.correctIndex,
                        orderIndex: oi.orderIndex,
                    },
                });
            }

            // Fill Blanks
            for (const fb of q.fillBlanks) {
                await tx.questionFillBlank.create({
                    data: {
                        questionId: newQ.id,
                        blankKey: fb.blankKey,
                        orderIndex: fb.orderIndex,
                        placeholder: fb.placeholder,
                    },
                });
            }

            // Fill Answers
            for (const fa of q.fillAnswers) {
                await tx.questionFillAnswer.create({
                    data: {
                        questionId: newQ.id,
                        blankKey: fa.blankKey,
                        answerText: fa.answerText,
                        isPrimary: fa.isPrimary,
                    },
                });
            }
        }
    }
}
