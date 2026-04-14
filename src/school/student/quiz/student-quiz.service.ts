// src/school/student/quiz/student-quiz.service.ts
import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

// TODO: لاحقاً سيكون من إعدادات المدرسة
const MAX_ATTEMPTS = 999;

@Injectable()
export class StudentQuizService {
    constructor(private readonly prisma: PrismaService) { }

    // ─────── Helpers ─────────────────────────────────────────────────────────

    private async getStudentAndLesson(schoolId: number, userUuid: string, lessonUuid: string) {
        // 1. جلب الطالب
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { student: { select: { userId: true } } },
        });
        if (!user || !user.student) throw new ForbiddenException('USER_IS_NOT_STUDENT');

        // 2. جلب الالتحاق
        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId: user.student.userId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
        });
        if (!enrollment) throw new NotFoundException('ENROLLMENT_NOT_FOUND');

        // 3. جلب الدرس مع التحقق من الاستهداف
        const lesson = await this.prisma.lesson.findFirst({
            where: {
                uuid: lessonUuid,
                schoolId,
                status: { in: ['PUBLISHED', 'DELIVERED'] },
                isDeleted: false,
                isActive: true,
                targets: { some: { sectionId: enrollment.sectionId } },
            },
        });
        if (!lesson) throw new NotFoundException('LESSON_NOT_FOUND');

        return { studentId: user.student.userId, lesson };
    }

    // ─────── GET questions ───────────────────────────────────────────────────

    /**
     * جلب أسئلة الدرس مع الإجابات الصحيحة
     * القرار: إرسال الإجابات الصحيحة للتصحيح الفوري (DEC)
     */
    async getQuestions(schoolId: number, userUuid: string, lessonUuid: string) {
        const { studentId, lesson } = await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        // حساب عدد المحاولات السابقة
        const attemptCount = await this.prisma.studentLessonResult.count({
            where: { studentId, lessonId: lesson.id, isDeleted: false },
        });

        const canAttempt = attemptCount < MAX_ATTEMPTS;

        // جلب الأسئلة
        const questions = await this.prisma.question.findMany({
            where: { templateId: lesson.templateId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                options: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true,
                        optionText: true,
                        imageAssetId: true,
                        imageAsset: { select: { uuid: true } },
                        audioAssetId: true,
                        audioAsset: { select: { uuid: true } },
                        isCorrect: true,  // ✅ نرسل الإجابة الصحيحة
                        orderIndex: true,
                    },
                },
                matchingPairs: {
                    where: { isDeleted: false },
                    select: {
                        uuid: true,
                        pairKey: true,
                        leftText: true,
                        leftImageAssetId: true,
                        leftImageAsset: { select: { uuid: true } },
                        rightText: true,
                        rightImageAssetId: true,
                        rightImageAsset: { select: { uuid: true } },
                        leftOrderIndex: true,
                        rightOrderIndex: true,
                    },
                },
                orderingItems: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true,
                        itemText: true,
                        imageAssetId: true,
                        imageAsset: { select: { uuid: true } },
                        correctIndex: true,  // ✅ نرسل الترتيب الصحيح
                        orderIndex: true,
                    },
                },
                fillBlanks: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true,
                        blankKey: true,
                        orderIndex: true,
                        placeholder: true,
                    },
                },
                fillAnswers: {
                    where: { isDeleted: false },
                    select: {
                        blankKey: true,
                        answerText: true,
                        isPrimary: true,
                    },
                },
                questionImageAsset: { select: { uuid: true } },
                questionAudioAsset: { select: { uuid: true } },
                explanationImageAsset: { select: { uuid: true } },
                explanationAudioAsset: { select: { uuid: true } },
            },
        });

        // بناء الاستجابة
        const mappedQuestions = questions.map((q) => {
            const base: any = {
                uuid: q.uuid,
                type: q.type,
                orderIndex: q.orderIndex,
                questionText: q.questionText,
                questionImageAssetUuid: q.questionImageAsset?.uuid ?? null,
                questionAudioAssetUuid: q.questionAudioAsset?.uuid ?? null,
                score: q.score,
                explanation: {
                    text: q.explanationText,
                    imageAssetUuid: q.explanationImageAsset?.uuid ?? null,
                    audioAssetUuid: q.explanationAudioAsset?.uuid ?? null,
                },
            };

            switch (q.type) {
                case 'MCQ':
                case 'TRUE_FALSE':
                    base.options = q.options.map((o) => ({
                        uuid: o.uuid,
                        optionText: o.optionText,
                        imageAssetUuid: o.imageAsset?.uuid ?? null,
                        audioAssetUuid: o.audioAsset?.uuid ?? null,
                        isCorrect: o.isCorrect,
                        orderIndex: o.orderIndex,
                    }));
                    break;

                case 'MATCHING':
                    base.matchingPairs = q.matchingPairs.map((p) => ({
                        uuid: p.uuid,
                        pairKey: p.pairKey,
                        leftText: p.leftText,
                        leftImageAssetUuid: p.leftImageAsset?.uuid ?? null,
                        rightText: p.rightText,
                        rightImageAssetUuid: p.rightImageAsset?.uuid ?? null,
                        leftOrderIndex: p.leftOrderIndex,
                        rightOrderIndex: p.rightOrderIndex,
                    }));
                    break;

                case 'ORDERING':
                    base.orderingItems = q.orderingItems.map((i) => ({
                        uuid: i.uuid,
                        itemText: i.itemText,
                        imageAssetUuid: i.imageAsset?.uuid ?? null,
                        correctIndex: i.correctIndex,
                        orderIndex: i.orderIndex,
                    }));
                    break;

                case 'FILL':
                    base.fillBlanks = q.fillBlanks.map((b) => ({
                        uuid: b.uuid,
                        blankKey: b.blankKey,
                        orderIndex: b.orderIndex,
                        placeholder: b.placeholder,
                    }));
                    // بنك كلمات: الإجابات الصحيحة الأولية فقط (بترتيب عشوائي)
                    const correctAnswers = q.fillAnswers
                        .filter((a) => a.isPrimary)
                        .map((a) => a.answerText);
                    base.fillWordBank = this.shuffleArray([...correctAnswers]);
                    // إجابات صحيحة لكل فراغ (للتصحيح)
                    base.fillCorrectAnswers = q.fillAnswers.reduce((acc: any, a) => {
                        if (!acc[a.blankKey]) acc[a.blankKey] = [];
                        acc[a.blankKey].push(a.answerText.trim().toLowerCase());
                        return acc;
                    }, {});
                    break;
            }

            return base;
        });

        return {
            lessonUuid,
            attemptNumber: attemptCount + 1,
            maxAttempts: MAX_ATTEMPTS,
            canAttempt,
            questions: mappedQuestions,
        };
    }

    // ─────── Check single answer ─────────────────────────────────────────────

    /**
     * تصحيح إجابة واحدة فورياً (DEC: التصحيح بعد كل سؤال)
     */
    async checkAnswer(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        questionUuid: string,
        answerValue: any,
    ) {
        // تحقق فقط أن الدرس والطالب صحيحان
        await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        // جلب السؤال مع الإجابات الصحيحة  
        const question = await this.prisma.question.findFirst({
            where: { uuid: questionUuid, isDeleted: false },
            include: {
                options: { where: { isDeleted: false } },
                matchingPairs: { where: { isDeleted: false } },
                orderingItems: { where: { isDeleted: false } },
                fillAnswers: { where: { isDeleted: false } },
            },
        });

        if (!question) throw new NotFoundException('QUESTION_NOT_FOUND');

        const isCorrect = this.evaluateAnswer(question, answerValue);

        return {
            questionUuid,
            isCorrect,
            scoreAwarded: isCorrect ? question.score : 0,
        };
    }

    // ─────── Submit quiz ─────────────────────────────────────────────────────

    /**
     * إنهاء المحاولة + حفظ النتيجة النهائية + حفظ الإجابات
     */
    async submitQuiz(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        answers: { questionUuid: string; answerValue: any; isCorrect: boolean }[],
    ) {
        const { studentId, lesson } = await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        // التحقق من عدد المحاولات
        const attemptCount = await this.prisma.studentLessonResult.count({
            where: { studentId, lessonId: lesson.id, isDeleted: false },
        });

        if (attemptCount >= MAX_ATTEMPTS) {
            throw new BadRequestException('MAX_ATTEMPTS_EXCEEDED');
        }

        // جلب الأسئلة لحساب الدرجات
        const questions = await this.prisma.question.findMany({
            where: { templateId: lesson.templateId, isDeleted: false },
            select: { id: true, uuid: true, score: true },
        });

        const totalQuestions = questions.length;
        const totalPoints = questions.reduce((sum, q) => sum + q.score, 0);

        let correctCount = 0;
        let earnedPoints = 0;

        // الاعتماد على isCorrect المرسل من العميل (تم تصحيحه فورياً)
        for (const ans of answers) {
            const question = questions.find(q => q.uuid === ans.questionUuid);
            if (!question) continue;

            if (ans.isCorrect) {
                correctCount++;
                earnedPoints += question.score;
            }
        }

        const percent = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;
        const gradeLabel = this.getGradeLabel(percent);

        // حفظ النتيجة
        const result = await this.prisma.studentLessonResult.create({
            data: {
                studentId,
                lessonId: lesson.id,
                totalQuestions,
                correctQuestions: correctCount,
                totalPoints,
                earnedPoints,
                percent,
                gradeLabel,
                calculatedAt: new Date(),
                version: 1,
            },
        });

        // حفظ الإجابات (upsert — الأخيرة تطغى على السابقة)
        for (const ans of answers) {
            const question = questions.find(q => q.uuid === ans.questionUuid);
            if (!question) continue;

            const existing = await this.prisma.studentAnswer.findUnique({
                where: { studentId_questionId: { studentId, questionId: question.id } },
            });

            if (existing) {
                await this.prisma.studentAnswer.update({
                    where: { id: existing.id },
                    data: {
                        resultId: result.id,
                        answerValue: JSON.stringify(ans.answerValue),
                        correctness: ans.isCorrect ? 'CORRECT' : 'WRONG',
                        isCorrect: ans.isCorrect,
                        scoreAwarded: ans.isCorrect ? question.score : 0,
                    },
                });
            } else {
                await this.prisma.studentAnswer.create({
                    data: {
                        studentId,
                        questionId: question.id,
                        resultId: result.id,
                        answerValue: JSON.stringify(ans.answerValue),
                        correctness: ans.isCorrect ? 'CORRECT' : 'WRONG',
                        isCorrect: ans.isCorrect,
                        scoreAwarded: ans.isCorrect ? question.score : 0,
                    },
                });
            }
        }

        // تحديث progress
        await this.prisma.studentLessonProgress.upsert({
            where: {
                id: (await this.prisma.studentLessonProgress.findFirst({
                    where: { studentId, lessonId: lesson.id },
                }))?.id ?? 0,
            },
            update: {
                status: 'COMPLETED',
                updatedAt: new Date(),
            },
            create: {
                studentId,
                lessonId: lesson.id,
                status: 'COMPLETED',
                lastPosition: JSON.stringify({ attemptNumber: attemptCount + 1 }),
            },
        });

        return {
            resultUuid: result.uuid,
            totalQuestions,
            correctQuestions: correctCount,
            totalPoints,
            earnedPoints,
            percent: Math.round(percent),
            gradeLabel,
            attemptNumber: attemptCount + 1,
            remainingAttempts: MAX_ATTEMPTS - (attemptCount + 1),
        };
    }

    // ─────── Get result ──────────────────────────────────────────────────────

    async getResult(schoolId: number, userUuid: string, lessonUuid: string) {
        const { studentId, lesson } = await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        const result = await this.prisma.studentLessonResult.findFirst({
            where: { studentId, lessonId: lesson.id, isDeleted: false },
            orderBy: { calculatedAt: 'desc' },
        });

        if (!result) throw new NotFoundException('RESULT_NOT_FOUND');

        return {
            resultUuid: result.uuid,
            totalQuestions: result.totalQuestions,
            correctQuestions: result.correctQuestions,
            totalPoints: result.totalPoints,
            earnedPoints: result.earnedPoints,
            percent: Math.round(result.percent),
            gradeLabel: result.gradeLabel,
        };
    }

    // ─────── Get review (STD-071) ───────────────────────────────────────────

    /**
     * جلب مراجعة الإجابات: النتيجة + الأسئلة + إجابات الطالب + الإجابات الصحيحة + الشرح
     */
    async getReview(schoolId: number, userUuid: string, lessonUuid: string) {
        const { studentId, lesson } = await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        // 1. جلب آخر نتيجة
        const result = await this.prisma.studentLessonResult.findFirst({
            where: { studentId, lessonId: lesson.id, isDeleted: false },
            orderBy: { calculatedAt: 'desc' },
        });
        if (!result) throw new NotFoundException('RESULT_NOT_FOUND');

        // 2. جلب الأسئلة مع كل البيانات
        const questions = await this.prisma.question.findMany({
            where: { templateId: lesson.templateId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
            include: {
                options: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true, optionText: true,
                        imageAssetId: true, imageAsset: { select: { uuid: true } },
                        audioAssetId: true, audioAsset: { select: { uuid: true } },
                        isCorrect: true, orderIndex: true,
                    },
                },
                matchingPairs: {
                    where: { isDeleted: false },
                    select: {
                        uuid: true, pairKey: true,
                        leftText: true, leftImageAsset: { select: { uuid: true } },
                        rightText: true, rightImageAsset: { select: { uuid: true } },
                        leftOrderIndex: true, rightOrderIndex: true,
                    },
                },
                orderingItems: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        uuid: true, itemText: true,
                        imageAsset: { select: { uuid: true } },
                        correctIndex: true, orderIndex: true,
                    },
                },
                fillBlanks: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: { uuid: true, blankKey: true, orderIndex: true, placeholder: true },
                },
                fillAnswers: {
                    where: { isDeleted: false },
                    select: { blankKey: true, answerText: true, isPrimary: true },
                },
                questionImageAsset: { select: { uuid: true } },
                questionAudioAsset: { select: { uuid: true } },
                explanationImageAsset: { select: { uuid: true } },
                explanationAudioAsset: { select: { uuid: true } },
            },
        });

        // 3. جلب إجابات الطالب لهذه الأسئلة
        const questionIds = questions.map(q => q.id);
        const studentAnswers = await this.prisma.studentAnswer.findMany({
            where: {
                studentId,
                questionId: { in: questionIds },
                isDeleted: false,
            },
        });
        const answerMap = new Map(studentAnswers.map(a => [a.questionId, a]));

        // 4. بناء الاستجابة
        const reviewQuestions = questions.map(q => {
            const studentAns = answerMap.get(q.id);
            
            let parsedAnswer: any = null;
            if (studentAns) {
                try {
                    parsedAnswer = typeof studentAns.answerValue === 'string'
                        ? JSON.parse(studentAns.answerValue)
                        : studentAns.answerValue;
                } catch {
                    parsedAnswer = studentAns.answerValue;
                }
            }

            const base: any = {
                uuid: q.uuid,
                type: q.type,
                orderIndex: q.orderIndex,
                questionText: q.questionText,
                questionImageAssetUuid: q.questionImageAsset?.uuid ?? null,
                questionAudioAssetUuid: q.questionAudioAsset?.uuid ?? null,
                score: q.score ?? 1,
                explanation: {
                    text: q.explanationText ?? null,
                    imageAssetUuid: q.explanationImageAsset?.uuid ?? null,
                    audioAssetUuid: q.explanationAudioAsset?.uuid ?? null,
                },
                studentAnswer: studentAns ? {
                    answerValue: parsedAnswer,
                    isCorrect: studentAns.isCorrect ?? false,
                    scoreAwarded: studentAns.scoreAwarded ?? 0,
                } : null,
            };

            switch (q.type) {
                case 'MCQ':
                case 'TRUE_FALSE':
                    base.options = q.options.map(o => ({
                        uuid: o.uuid, optionText: o.optionText,
                        imageAssetUuid: o.imageAsset?.uuid ?? null,
                        audioAssetUuid: o.audioAsset?.uuid ?? null,
                        isCorrect: o.isCorrect, orderIndex: o.orderIndex,
                    }));
                    break;
                case 'MATCHING':
                    base.matchingPairs = q.matchingPairs.map(p => ({
                        uuid: p.uuid, pairKey: p.pairKey,
                        leftText: p.leftText, leftImageAssetUuid: p.leftImageAsset?.uuid ?? null,
                        rightText: p.rightText, rightImageAssetUuid: p.rightImageAsset?.uuid ?? null,
                        leftOrderIndex: p.leftOrderIndex, rightOrderIndex: p.rightOrderIndex,
                    }));
                    break;
                case 'ORDERING':
                    base.orderingItems = q.orderingItems.map(i => ({
                        uuid: i.uuid, itemText: i.itemText,
                        imageAssetUuid: i.imageAsset?.uuid ?? null,
                        correctIndex: i.correctIndex, orderIndex: i.orderIndex,
                    }));
                    break;
                case 'FILL':
                    base.fillBlanks = q.fillBlanks.map(b => ({
                        uuid: b.uuid, blankKey: b.blankKey,
                        orderIndex: b.orderIndex, placeholder: b.placeholder,
                    }));
                    base.fillCorrectAnswers = q.fillAnswers.reduce((acc: any, a) => {
                        if (!acc[a.blankKey]) acc[a.blankKey] = [];
                        acc[a.blankKey].push(a.answerText.trim());
                        return acc;
                    }, {});
                    break;
            }
            return base;
        });

        return {
            result: {
                resultUuid: result.uuid,
                totalQuestions: result.totalQuestions,
                correctQuestions: result.correctQuestions,
                totalPoints: result.totalPoints,
                earnedPoints: result.earnedPoints,
                percent: Math.round(result.percent),
                gradeLabel: result.gradeLabel,
            },
            questions: reviewQuestions,
        };
    }

    // ─────── Evaluation Logic ────────────────────────────────────────────────

    private evaluateAnswer(question: any, answerValue: any): boolean {
        switch (question.type) {
            case 'MCQ':
            case 'TRUE_FALSE': {
                const correctOption = question.options.find((o: any) => o.isCorrect);
                return correctOption && answerValue?.selectedOptionUuid === correctOption.uuid;
            }

            case 'MATCHING': {
                if (!answerValue?.pairs || !Array.isArray(answerValue.pairs)) return false;
                const correctPairs = question.matchingPairs;
                if (answerValue.pairs.length !== correctPairs.length) return false;
                return correctPairs.every((cp: any) =>
                    answerValue.pairs.some((ap: any) =>
                        ap.leftPairKey === cp.pairKey && ap.rightPairKey === cp.pairKey
                    )
                );
            }

            case 'ORDERING': {
                if (!answerValue?.orderedItemUuids || !Array.isArray(answerValue.orderedItemUuids)) return false;
                const correctOrder = question.orderingItems
                    .sort((a: any, b: any) => a.correctIndex - b.correctIndex)
                    .map((i: any) => i.uuid);
                return JSON.stringify(answerValue.orderedItemUuids) === JSON.stringify(correctOrder);
            }

            case 'FILL': {
                if (!answerValue?.blanks || !Array.isArray(answerValue.blanks)) return false;
                return answerValue.blanks.every((blank: any) => {
                    const correctForBlank = question.fillAnswers
                        .filter((a: any) => a.blankKey === blank.blankKey)
                        .map((a: any) => a.answerText.trim().toLowerCase());
                    return correctForBlank.includes(blank.answer?.trim()?.toLowerCase());
                });
            }

            default:
                return false;
        }
    }

    private getGradeLabel(percent: number): string {
        if (percent >= 90) return 'ممتاز';
        if (percent >= 80) return 'جيد جداً';
        if (percent >= 70) return 'جيد';
        if (percent >= 60) return 'مقبول';
        return 'ضعيف';
    }

    private shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
