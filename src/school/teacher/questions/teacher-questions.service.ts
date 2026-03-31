// src/school/teacher/questions/teacher-questions.service.ts
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';

/**
 * ❓ Teacher Questions Service
 * منطق إدارة أسئلة الدروس — TCH-090→094, TCH-096→101
 */
@Injectable()
export class TeacherQuestionsService {
    constructor(private readonly prisma: PrismaService) {}

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق أن المعلم يملك هذا الدرس
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
        });

        if (!lesson) {
            throw new NotFoundException('الدرس غير موجود');
        }

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

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق أن المعلم يملك هذا السؤال
    // ─────────────────────────────────────────────────────────
    private async assertTeacherOwnsQuestion(
        schoolId: number,
        userUuid: string,
        questionUuid: string,
    ) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });

        if (!user || !user.teacher) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        const question = await this.prisma.question.findFirst({
            where: { uuid: questionUuid, isDeleted: false },
            include: { template: { select: { id: true, subjectId: true, schoolId: true } } },
        });

        if (!question) {
            throw new NotFoundException('السؤال غير موجود');
        }

        if (question.template.schoolId !== schoolId) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا السؤال');
        }

        const assignment = await this.prisma.subjectSectionTeacher.findFirst({
            where: {
                teacherId: user.teacher.userId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    subjectId: question.template.subjectId,
                    isDeleted: false,
                },
            },
        });

        if (!assignment) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا السؤال');
        }

        return { question, userId: user.id, teacherId: user.teacher.userId };
    }

    // ─────────────────────────────────────────────────────────
    // Helper: include للبيانات الفرعية
    // ─────────────────────────────────────────────────────────
    private readonly questionDetailInclude = {
        options: {
            where: { isDeleted: false },
            orderBy: { orderIndex: 'asc' as const },
        },
        matchingPairs: {
            where: { isDeleted: false },
            orderBy: { leftOrderIndex: 'asc' as const },
        },
        orderingItems: {
            where: { isDeleted: false },
            orderBy: { orderIndex: 'asc' as const },
        },
        fillBlanks: {
            where: { isDeleted: false },
            orderBy: { orderIndex: 'asc' as const },
        },
        fillAnswers: {
            where: { isDeleted: false },
        },
    };

    // ─────────────────────────────────────────────────────────
    // Helper: تحويل السؤال لشكل الاستجابة
    // ─────────────────────────────────────────────────────────
    private formatQuestion(q: any) {
        return {
            id: q.id,
            uuid: q.uuid,
            type: q.type,
            orderIndex: q.orderIndex,
            questionText: q.questionText,
            questionImageAssetId: q.questionImageAssetId,
            questionAudioAssetId: q.questionAudioAssetId,
            score: q.score,
            explanationText: q.explanationText,
            explanationImageAssetId: q.explanationImageAssetId,
            explanationAudioAssetId: q.explanationAudioAssetId,
            // البيانات الفرعية
            options: q.options?.map((o: any) => ({
                id: o.id,
                uuid: o.uuid,
                optionText: o.optionText,
                imageAssetId: o.imageAssetId,
                audioAssetId: o.audioAssetId,
                isCorrect: o.isCorrect,
                orderIndex: o.orderIndex,
            })),
            matchingPairs: q.matchingPairs?.map((p: any) => ({
                id: p.id,
                uuid: p.uuid,
                pairKey: p.pairKey,
                leftText: p.leftText,
                leftImageAssetId: p.leftImageAssetId,
                leftAudioAssetId: p.leftAudioAssetId,
                rightText: p.rightText,
                rightImageAssetId: p.rightImageAssetId,
                rightAudioAssetId: p.rightAudioAssetId,
                leftOrderIndex: p.leftOrderIndex,
                rightOrderIndex: p.rightOrderIndex,
            })),
            orderingItems: q.orderingItems?.map((i: any) => ({
                id: i.id,
                uuid: i.uuid,
                itemText: i.itemText,
                imageAssetId: i.imageAssetId,
                audioAssetId: i.audioAssetId,
                correctIndex: i.correctIndex,
                orderIndex: i.orderIndex,
            })),
            fillBlanks: q.fillBlanks?.map((b: any) => ({
                id: b.id,
                uuid: b.uuid,
                blankKey: b.blankKey,
                orderIndex: b.orderIndex,
                placeholder: b.placeholder,
            })),
            fillAnswers: q.fillAnswers?.map((a: any) => ({
                id: a.id,
                uuid: a.uuid,
                blankKey: a.blankKey,
                answerText: a.answerText,
                isPrimary: a.isPrimary,
            })),
        };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-QST-01 — عرض قائمة الأسئلة
    // ═════════════════════════════════════════════════════════
    async getQuestions(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(schoolId, userUuid, lessonUuid);

        const questions = await this.prisma.question.findMany({
            where: { templateId: lesson.id, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                _count: {
                    select: {
                        options: { where: { isDeleted: false } },
                        matchingPairs: { where: { isDeleted: false } },
                        orderingItems: { where: { isDeleted: false } },
                        fillBlanks: { where: { isDeleted: false } },
                    },
                },
            },
        });

        return {
            questions: questions.map((q) => ({
                id: q.id,
                uuid: q.uuid,
                type: q.type,
                orderIndex: q.orderIndex,
                questionText: q.questionText,
                hasImage: q.questionImageAssetId !== null,
                hasAudio: q.questionAudioAssetId !== null,
                optionsCount: q._count.options,
                pairsCount: q._count.matchingPairs,
                itemsCount: q._count.orderingItems,
                blanksCount: q._count.fillBlanks,
            })),
        };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-QST-02 — إنشاء سؤال (Nested Transaction)
    // ═════════════════════════════════════════════════════════
    async createQuestion(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: CreateQuestionDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(schoolId, userUuid, lessonUuid);

        // BR-03: سؤال غير فارغ
        this.validateQuestionNotEmpty(dto);

        // BR-04: قواعد اكتمال النوع
        this.validateTypeRules(dto);

        // BR-02: فرادة الترتيب
        const existingOrder = await this.prisma.question.findFirst({
            where: {
                templateId: lesson.id,
                orderIndex: dto.orderIndex,
                isDeleted: false,
            },
        });

        if (existingOrder) {
            throw new ConflictException('هذا الترتيب مستخدم. اختر ترتيباً آخر.');
        }

        // Transaction: إنشاء السؤال + بياناته الفرعية
        const result = await this.prisma.$transaction(async (tx) => {
            // 1. إنشاء السؤال
            const question = await tx.question.create({
                data: {
                    templateId: lesson.id,
                    type: dto.type,
                    orderIndex: dto.orderIndex,
                    questionText: dto.questionText ?? null,
                    questionImageAssetId: dto.questionImageAssetId ?? null,
                    questionAudioAssetId: dto.questionAudioAssetId ?? null,
                    explanationText: dto.explanationText ?? null,
                    explanationImageAssetId: dto.explanationImageAssetId ?? null,
                    explanationAudioAssetId: dto.explanationAudioAssetId ?? null,
                },
            });

            // 2. إنشاء البيانات الفرعية حسب النوع
            await this.createSubItems(tx, question.id, dto);

            // 3. جلب السؤال كاملاً
            return tx.question.findUnique({
                where: { id: question.id },
                include: this.questionDetailInclude,
            });
        });

        return this.formatQuestion(result);
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-QST-03a — جلب سؤال بالتفصيل
    // ═════════════════════════════════════════════════════════
    async getQuestion(
        schoolId: number,
        userUuid: string,
        questionUuid: string,
    ) {
        const { question } = await this.assertTeacherOwnsQuestion(schoolId, userUuid, questionUuid);

        const detail = await this.prisma.question.findUnique({
            where: { id: question.id },
            include: this.questionDetailInclude,
        });

        return this.formatQuestion(detail);
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-QST-03b — تعديل سؤال (Replace Strategy)
    // ═════════════════════════════════════════════════════════
    async updateQuestion(
        schoolId: number,
        userUuid: string,
        questionUuid: string,
        dto: UpdateQuestionDto,
    ) {
        const { question } = await this.assertTeacherOwnsQuestion(schoolId, userUuid, questionUuid);

        // التحقق: إذا تم إرسال بيانات فرعية → تحقق من قواعد الاكتمال
        if (dto.options || dto.matchingPairs || dto.orderingItems || dto.fillBlanks || dto.fillAnswers) {
            this.validateTypeRulesForUpdate(question.type, dto);
        }

        const result = await this.prisma.$transaction(async (tx) => {
            // 1. تحديث حقول السؤال
            const updateData: any = {};
            if (dto.questionText !== undefined) updateData.questionText = dto.questionText;
            if (dto.questionImageAssetId !== undefined) updateData.questionImageAssetId = dto.questionImageAssetId;
            if (dto.questionAudioAssetId !== undefined) updateData.questionAudioAssetId = dto.questionAudioAssetId;
            if (dto.explanationText !== undefined) updateData.explanationText = dto.explanationText;
            if (dto.explanationImageAssetId !== undefined) updateData.explanationImageAssetId = dto.explanationImageAssetId;
            if (dto.explanationAudioAssetId !== undefined) updateData.explanationAudioAssetId = dto.explanationAudioAssetId;

            if (Object.keys(updateData).length > 0) {
                await tx.question.update({
                    where: { id: question.id },
                    data: updateData,
                });
            }

            // 2. Replace Strategy: حذف القديم + إدراج الجديد
            if (dto.options) {
                await tx.questionOption.updateMany({
                    where: { questionId: question.id },
                    data: { isDeleted: true, deletedAt: new Date() },
                });
                await this.createOptions(tx, question.id, dto.options);
            }

            if (dto.matchingPairs) {
                await tx.questionMatchingPair.updateMany({
                    where: { questionId: question.id },
                    data: { isDeleted: true, deletedAt: new Date() },
                });
                await this.createMatchingPairs(tx, question.id, dto.matchingPairs);
            }

            if (dto.orderingItems) {
                await tx.questionOrderingItem.updateMany({
                    where: { questionId: question.id },
                    data: { isDeleted: true, deletedAt: new Date() },
                });
                await this.createOrderingItems(tx, question.id, dto.orderingItems);
            }

            if (dto.fillBlanks || dto.fillAnswers) {
                await tx.questionFillBlank.updateMany({
                    where: { questionId: question.id },
                    data: { isDeleted: true, deletedAt: new Date() },
                });
                await tx.questionFillAnswer.updateMany({
                    where: { questionId: question.id },
                    data: { isDeleted: true, deletedAt: new Date() },
                });
                if (dto.fillBlanks) await this.createFillBlanks(tx, question.id, dto.fillBlanks);
                if (dto.fillAnswers) await this.createFillAnswers(tx, question.id, dto.fillAnswers);
            }

            // 3. جلب السؤال المحدّث
            return tx.question.findUnique({
                where: { id: question.id },
                include: this.questionDetailInclude,
            });
        });

        return this.formatQuestion(result);
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-QST-04 — حذف سؤال (Cascading Soft-Delete)
    // ═════════════════════════════════════════════════════════
    async deleteQuestion(
        schoolId: number,
        userUuid: string,
        questionUuid: string,
    ) {
        const { question } = await this.assertTeacherOwnsQuestion(schoolId, userUuid, questionUuid);

        await this.prisma.$transaction(async (tx) => {
            const now = new Date();

            // Soft-delete البيانات الفرعية
            await tx.questionOption.updateMany({
                where: { questionId: question.id },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionMatchingPair.updateMany({
                where: { questionId: question.id },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionOrderingItem.updateMany({
                where: { questionId: question.id },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionFillBlank.updateMany({
                where: { questionId: question.id },
                data: { isDeleted: true, deletedAt: now },
            });
            await tx.questionFillAnswer.updateMany({
                where: { questionId: question.id },
                data: { isDeleted: true, deletedAt: now },
            });

            // Soft-delete السؤال
            await tx.question.update({
                where: { id: question.id },
                data: { isDeleted: true, deletedAt: now },
            });
        });

        return { message: 'تم حذف السؤال بنجاح' };
    }

    // ═════════════════════════════════════════════════════════
    //  SRS-QST-05 — إعادة ترتيب الأسئلة
    // ═════════════════════════════════════════════════════════
    async reorderQuestions(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dto: ReorderQuestionsDto,
    ) {
        const { lesson } = await this.assertTeacherOwnsLesson(schoolId, userUuid, lessonUuid);

        // تحقق أن جميع الـ UUIDs تتبع لهذا الدرس
        const questions = await this.prisma.question.findMany({
            where: { templateId: lesson.id, isDeleted: false },
            select: { id: true, uuid: true },
        });

        const existingUuids = new Set(questions.map((q) => q.uuid));
        for (const uuid of dto.orderedUuids) {
            if (!existingUuids.has(uuid)) {
                throw new BadRequestException(`السؤال ${uuid} غير موجود في هذا الدرس`);
            }
        }

        // إعادة ترتيب داخل transaction
        // نستخدم قيم سالبة مؤقتة لتجنب تعارض unique constraint
        await this.prisma.$transaction(async (tx) => {
            // Step 1: تعيين قيم سالبة مؤقتة
            for (let i = 0; i < dto.orderedUuids.length; i++) {
                await tx.question.update({
                    where: { uuid: dto.orderedUuids[i] },
                    data: { orderIndex: -(i + 1) },
                });
            }

            // Step 2: تعيين القيم النهائية
            for (let i = 0; i < dto.orderedUuids.length; i++) {
                await tx.question.update({
                    where: { uuid: dto.orderedUuids[i] },
                    data: { orderIndex: i + 1 },
                });
            }
        });

        return { message: 'تم تحديث ترتيب الأسئلة' };
    }

    // ─────────────────────────────────────────────────────────
    // Private: إنشاء البيانات الفرعية
    // ─────────────────────────────────────────────────────────
    private async createSubItems(tx: any, questionId: number, dto: CreateQuestionDto) {
        switch (dto.type) {
            case 'MCQ':
            case 'TRUE_FALSE':
                if (dto.options) await this.createOptions(tx, questionId, dto.options);
                break;
            case 'MATCHING':
                if (dto.matchingPairs) await this.createMatchingPairs(tx, questionId, dto.matchingPairs);
                break;
            case 'ORDERING':
                if (dto.orderingItems) await this.createOrderingItems(tx, questionId, dto.orderingItems);
                break;
            case 'FILL':
                if (dto.fillBlanks) await this.createFillBlanks(tx, questionId, dto.fillBlanks);
                if (dto.fillAnswers) await this.createFillAnswers(tx, questionId, dto.fillAnswers);
                break;
        }
    }

    private async createOptions(tx: any, questionId: number, options: any[]) {
        for (const opt of options) {
            await tx.questionOption.create({
                data: {
                    questionId,
                    optionText: opt.optionText ?? null,
                    imageAssetId: opt.imageAssetId ?? null,
                    audioAssetId: opt.audioAssetId ?? null,
                    isCorrect: opt.isCorrect,
                    orderIndex: opt.orderIndex,
                },
            });
        }
    }

    private async createMatchingPairs(tx: any, questionId: number, pairs: any[]) {
        for (const pair of pairs) {
            await tx.questionMatchingPair.create({
                data: {
                    questionId,
                    pairKey: pair.pairKey,
                    leftText: pair.leftText ?? null,
                    leftImageAssetId: pair.leftImageAssetId ?? null,
                    leftAudioAssetId: pair.leftAudioAssetId ?? null,
                    rightText: pair.rightText ?? null,
                    rightImageAssetId: pair.rightImageAssetId ?? null,
                    rightAudioAssetId: pair.rightAudioAssetId ?? null,
                    leftOrderIndex: pair.leftOrderIndex ?? null,
                    rightOrderIndex: pair.rightOrderIndex ?? null,
                },
            });
        }
    }

    private async createOrderingItems(tx: any, questionId: number, items: any[]) {
        for (const item of items) {
            await tx.questionOrderingItem.create({
                data: {
                    questionId,
                    itemText: item.itemText ?? null,
                    imageAssetId: item.imageAssetId ?? null,
                    audioAssetId: item.audioAssetId ?? null,
                    correctIndex: item.correctIndex,
                    orderIndex: item.orderIndex,
                },
            });
        }
    }

    private async createFillBlanks(tx: any, questionId: number, blanks: any[]) {
        for (const blank of blanks) {
            await tx.questionFillBlank.create({
                data: {
                    questionId,
                    blankKey: blank.blankKey,
                    orderIndex: blank.orderIndex,
                    placeholder: blank.placeholder ?? null,
                },
            });
        }
    }

    private async createFillAnswers(tx: any, questionId: number, answers: any[]) {
        for (const answer of answers) {
            await tx.questionFillAnswer.create({
                data: {
                    questionId,
                    blankKey: answer.blankKey,
                    answerText: answer.answerText,
                    isPrimary: answer.isPrimary ?? false,
                },
            });
        }
    }

    // ─────────────────────────────────────────────────────────
    // Private: Validation Helpers
    // ─────────────────────────────────────────────────────────

    /** BR-03: سؤال غير فارغ */
    private validateQuestionNotEmpty(dto: CreateQuestionDto | UpdateQuestionDto) {
        const hasText = dto.questionText && dto.questionText.trim().length > 0;
        const hasImage = dto.questionImageAssetId != null;
        const hasAudio = dto.questionAudioAssetId != null;

        if (!hasText && !hasImage && !hasAudio) {
            throw new BadRequestException('أضف نص السؤال أو صورة أو صوت');
        }
    }

    /** BR-04: قواعد اكتمال النوع */
    private validateTypeRules(dto: CreateQuestionDto) {
        switch (dto.type) {
            case 'MCQ':
                this.validateMCQ(dto.options);
                break;
            case 'TRUE_FALSE':
                this.validateTrueFalse(dto.options);
                break;
            case 'MATCHING':
                this.validateMatching(dto.matchingPairs);
                break;
            case 'ORDERING':
                this.validateOrdering(dto.orderingItems);
                break;
            case 'FILL':
                this.validateFill(dto.fillBlanks, dto.fillAnswers);
                break;
        }
    }

    /** Validation لتعديل السؤال — بيانات فرعية فقط */
    private validateTypeRulesForUpdate(type: string, dto: UpdateQuestionDto) {
        switch (type) {
            case 'MCQ':
                if (dto.options) this.validateMCQ(dto.options);
                break;
            case 'TRUE_FALSE':
                if (dto.options) this.validateTrueFalse(dto.options);
                break;
            case 'MATCHING':
                if (dto.matchingPairs) this.validateMatching(dto.matchingPairs);
                break;
            case 'ORDERING':
                if (dto.orderingItems) this.validateOrdering(dto.orderingItems);
                break;
            case 'FILL':
                if (dto.fillBlanks || dto.fillAnswers) this.validateFill(dto.fillBlanks, dto.fillAnswers);
                break;
        }
    }

    private isOptionValid(opt: any): boolean {
        return !!(opt.optionText?.trim() || opt.imageAssetId || opt.audioAssetId);
    }

    private validateMCQ(options?: any[]) {
        if (!options || options.length < 2) {
            throw new BadRequestException('سؤال MCQ يحتاج خيارين صالحين على الأقل');
        }
        const validOptions = options.filter((o) => this.isOptionValid(o));
        if (validOptions.length < 2) {
            throw new BadRequestException('سؤال MCQ يحتاج خيارين صالحين على الأقل');
        }
        const correctCount = options.filter((o) => o.isCorrect).length;
        if (correctCount !== 1) {
            throw new BadRequestException('سؤال MCQ يحتاج إجابة صحيحة واحدة فقط');
        }
    }

    private validateTrueFalse(options?: any[]) {
        if (!options || options.length !== 2) {
            throw new BadRequestException('سؤال صح/خطأ يحتاج خيارين');
        }
        const correctCount = options.filter((o) => o.isCorrect).length;
        if (correctCount !== 1) {
            throw new BadRequestException('حدد الإجابة الصحيحة (صح أو خطأ)');
        }
    }

    private validateMatching(pairs?: any[]) {
        if (!pairs || pairs.length < 2) {
            throw new BadRequestException('سؤال المطابقة يحتاج زوجين صالحين على الأقل');
        }
        for (const pair of pairs) {
            const leftValid = !!(pair.leftText?.trim() || pair.leftImageAssetId || pair.leftAudioAssetId);
            const rightValid = !!(pair.rightText?.trim() || pair.rightImageAssetId || pair.rightAudioAssetId);
            if (!leftValid || !rightValid) {
                throw new BadRequestException('كل زوج يجب أن يحتوي نص أو صورة أو صوت في كلا الطرفين');
            }
        }
    }

    private validateOrdering(items?: any[]) {
        if (!items || items.length < 2) {
            throw new BadRequestException('سؤال الترتيب يحتاج عنصرين صالحين على الأقل');
        }
        for (const item of items) {
            const valid = !!(item.itemText?.trim() || item.imageAssetId || item.audioAssetId);
            if (!valid) {
                throw new BadRequestException('كل عنصر يجب أن يحتوي نص أو صورة أو صوت');
            }
        }
    }

    private validateFill(blanks?: any[], answers?: any[]) {
        if (!blanks || blanks.length < 1) {
            throw new BadRequestException('سؤال ملء الفراغات يحتاج فراغاً واحداً على الأقل');
        }
        if (!answers || answers.length < 1) {
            throw new BadRequestException('أضف إجابة واحدة على الأقل للفراغات');
        }
        // تحقق أن كل فراغ له إجابة
        const blankKeys = new Set(blanks.map((b) => b.blankKey));
        const answerKeys = new Set(answers.map((a) => a.blankKey));
        for (const key of blankKeys) {
            if (!answerKeys.has(key)) {
                throw new BadRequestException(`الفراغ "${key}" ليس له إجابة`);
            }
        }
    }
}
