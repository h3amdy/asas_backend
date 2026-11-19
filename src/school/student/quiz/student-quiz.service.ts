// src/school/student/quiz/student-quiz.service.ts
import {
    Injectable,
    ForbiddenException,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
    QUESTION_EVALUATION_INCLUDE,
    evaluateQuestionAnswer,
    getGradeLabel,
} from './helpers/answer-evaluator';
import { SubmitQuizAnswerDto, SubmitQuizDto } from './dto/submit-quiz.dto';

// TODO: لاحقاً سيكون من إعدادات المدرسة
const MAX_ATTEMPTS = 999;

@Injectable()
export class StudentQuizService {
    constructor(private readonly prisma: PrismaService) { }

    // ─────── Helpers ─────────────────────────────────────────────────────────

    private async getStudentAndLesson(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ) {
        // 1. جلب الطالب
        const user = await db.user.findFirst({
            where: { uuid: userUuid, schoolId, userType: 'STUDENT', isDeleted: false },
            include: { student: { select: { userId: true } } },
        });
        if (!user || !user.student) throw new ForbiddenException('USER_IS_NOT_STUDENT');

        // 2. جلب الالتحاق
        const enrollment = await db.studentEnrollment.findFirst({
            where: {
                studentId: user.student.userId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
        });
        if (!enrollment) throw new NotFoundException('ENROLLMENT_NOT_FOUND');

        // 3. جلب الدرس مع التحقق من الاستهداف
        // DEC-020 v3.0: Per-Target visibility
        const lesson = await db.lesson.findFirst({
            where: {
                uuid: lessonUuid,
                schoolId,
                isDeleted: false,
                isActive: true,
                status: { not: 'ARCHIVED' },
                targets: { some: { sectionId: enrollment.sectionId, publishedAt: { not: null } } },
            },
            include: {
                template: { select: { questionsRevision: true } },
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

        // DEC-026 Phase 6: جلب questionsRevision لإرساله مع الأسئلة
        const template = await this.prisma.lessonTemplate.findUnique({
            where: { id: lesson.templateId },
            select: { questionsRevision: true },
        });

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
                        leftAudioAssetId: true,
                        leftAudioAsset: { select: { uuid: true } },
                        rightText: true,
                        rightImageAssetId: true,
                        rightImageAsset: { select: { uuid: true } },
                        rightAudioAssetId: true,
                        rightAudioAsset: { select: { uuid: true } },
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
                instructionText: q.instructionText ?? null,
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
                        leftAudioAssetUuid: p.leftAudioAsset?.uuid ?? null,
                        rightText: p.rightText,
                        rightImageAssetUuid: p.rightImageAsset?.uuid ?? null,
                        rightAudioAssetUuid: p.rightAudioAsset?.uuid ?? null,
                        leftOrderIndex: p.leftOrderIndex,
                        rightOrderIndex: p.rightOrderIndex,
                    }));
                    break;

                case 'ORDERING':
                case 'IMAGE_STEP_SORTING':
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
            questionsRevision: template?.questionsRevision ?? 1,
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
        // التحقق من الطالب والدرس، ثم ربط السؤال بنفس قالب الدرس (SEC-QUIZ-02)
        const { lesson } = await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        const question = await this.prisma.question.findFirst({
            where: {
                uuid: questionUuid,
                templateId: lesson.templateId,
                isDeleted: false,
            },
            include: QUESTION_EVALUATION_INCLUDE,
        });

        if (!question) throw new NotFoundException('QUESTION_NOT_FOUND');

        const isCorrect = evaluateQuestionAnswer(question, answerValue);

        return {
            questionUuid,
            isCorrect,
            scoreAwarded: isCorrect ? question.score : 0,
        };
    }

    // ─────── Submit quiz ─────────────────────────────────────────────────────

    /**
     * إنهاء المحاولة + حفظ النتيجة النهائية + حفظ الإجابات ذرياً مع إعادة التقييم الكامل على الخادم
     */
    async submitQuiz(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
        dtoOrAnswers: SubmitQuizDto | SubmitQuizAnswerDto[],
        _legacyQuestionsRevision?: number,
    ) {
        const answers: SubmitQuizAnswerDto[] = Array.isArray(dtoOrAnswers)
            ? dtoOrAnswers
            : dtoOrAnswers?.answers;
        const clientAttemptUuid =
            !Array.isArray(dtoOrAnswers) &&
            typeof dtoOrAnswers?.clientAttemptUuid === 'string' &&
            dtoOrAnswers.clientAttemptUuid.trim().length > 0
                ? dtoOrAnswers.clientAttemptUuid.trim()
                : undefined;

        if (!Array.isArray(answers)) {
            throw new BadRequestException('INVALID_ANSWERS_PAYLOAD');
        }

        // رفض تكرار السؤال داخل المحاولة الواحدة (Decision #6 / SEC-QUIZ-01)
        const seenQuestionUuids = new Set<string>();
        for (const ans of answers) {
            if (!ans || typeof ans.questionUuid !== 'string' || ans.questionUuid.trim().length === 0) {
                throw new BadRequestException('INVALID_QUESTION_FOR_LESSON');
            }
            if (seenQuestionUuids.has(ans.questionUuid)) {
                throw new BadRequestException('DUPLICATE_QUESTION_IN_SUBMISSION');
            }
            seenQuestionUuids.add(ans.questionUuid);
        }

        let resolvedStudentId: number | undefined;
        let resolvedLessonId: number | undefined;

        try {
            return await this.prisma.$transaction(async (tx) => {
                const { studentId, lesson } = await this.getStudentAndLesson(
                    schoolId,
                    userUuid,
                    lessonUuid,
                    tx,
                );
                resolvedStudentId = studentId;
                resolvedLessonId = lesson.id;

                // قفل استشاري لمنع تداخل المحاولات المتزامنة (SEC-R3-02)
                await tx.$executeRaw(
                    Prisma.sql`SELECT pg_advisory_xact_lock(CAST(${studentId} AS INTEGER), CAST(${lesson.id} AS INTEGER))`,
                );

                // التحقق من تكرار الإرسال الآمن إذا وفّر العميل clientAttemptUuid (SEC-R3-02 / SEC-R3-03)
                if (clientAttemptUuid) {
                    const existingAttempt = await tx.processedClientChange.findUnique({
                        where: { clientChangeUuid: clientAttemptUuid },
                        select: { studentId: true, entityType: true, entityUuid: true },
                    });
                    if (existingAttempt) {
                        if (
                            existingAttempt.studentId !== studentId ||
                            existingAttempt.entityType !== 'quiz_submission'
                        ) {
                            throw new ConflictException('CLIENT_ATTEMPT_CONFLICT');
                        }
                        const priorResult = await tx.studentLessonResult.findFirst({
                            where: {
                                uuid: existingAttempt.entityUuid,
                                studentId,
                                lessonId: lesson.id,
                                isDeleted: false,
                            },
                        });
                        if (!priorResult) {
                            throw new ConflictException('CLIENT_ATTEMPT_CONFLICT');
                        }
                        const currentAttempts = await tx.studentLessonResult.count({
                            where: { studentId, lessonId: lesson.id, isDeleted: false },
                        });
                        return {
                            resultUuid: priorResult.uuid,
                            totalQuestions: priorResult.totalQuestions,
                            correctQuestions: priorResult.correctQuestions,
                            totalPoints: priorResult.totalPoints,
                            earnedPoints: priorResult.earnedPoints,
                            percent: Math.round(priorResult.percent),
                            gradeLabel: priorResult.gradeLabel,
                            attemptNumber: priorResult.version,
                            remainingAttempts: Math.max(0, MAX_ATTEMPTS - currentAttempts),
                            idempotentReplay: true,
                        };
                    }
                }

                // التحقق من عدد المحاولات داخل القفل
                const attemptCount = await tx.studentLessonResult.count({
                    where: { studentId, lessonId: lesson.id, isDeleted: false },
                });

                if (attemptCount >= MAX_ATTEMPTS) {
                    throw new BadRequestException('MAX_ATTEMPTS_EXCEEDED');
                }

                // جلب كافة أسئلة القالب مع بيانات التصحيح الكاملة من الخادم
                const questions = await tx.question.findMany({
                    where: { templateId: lesson.templateId, isDeleted: false },
                    include: QUESTION_EVALUATION_INCLUDE,
                });

                // الدرس الخالي من الأسئلة يُغلق عبر mark-read فقط ولا يُسمح له بنتيجة 0% في submit-quiz
                if (questions.length === 0) {
                    throw new BadRequestException('LESSON_HAS_NO_QUESTIONS');
                }

                if (answers.length > questions.length) {
                    throw new BadRequestException('TOO_MANY_ANSWERS');
                }

                const questionMap = new Map(questions.map((q) => [q.uuid, q]));
                const totalQuestions = questions.length;
                const totalPoints = questions.reduce((sum, q) => sum + q.score, 0);

                let correctCount = 0;
                let earnedPoints = 0;

                const evaluatedAnswers: Array<{
                    question: any;
                    answerValue: any;
                    isCorrect: boolean;
                    scoreAwarded: number;
                }> = [];

                for (const ans of answers) {
                    const question = questionMap.get(ans.questionUuid);
                    if (!question) {
                        throw new BadRequestException('INVALID_QUESTION_FOR_LESSON');
                    }

                    // التصحيح الكامل على الخادم وتجاهل ans.isCorrect كلياً
                    const isCorrect = evaluateQuestionAnswer(question, ans.answerValue);
                    const scoreAwarded = isCorrect ? question.score : 0;

                    if (isCorrect) {
                        correctCount++;
                        earnedPoints += question.score;
                    }

                    evaluatedAnswers.push({
                        question,
                        answerValue: ans.answerValue,
                        isCorrect,
                        scoreAwarded,
                    });
                }

                const percent =
                    totalPoints > 0
                        ? Math.max(0, Math.min(100, (earnedPoints / totalPoints) * 100))
                        : 0;
                const gradeLabel = getGradeLabel(percent);

                // ترقيم الإصدار بشكل تصاعدي رتيب داخل القفل (SEC-R3-02)
                const versionAgg = await tx.studentLessonResult.aggregate({
                    where: { studentId, lessonId: lesson.id },
                    _max: { version: true },
                });
                const nextVersion = (versionAgg._max.version ?? 0) + 1;

                // الخادم هو المرجع لرقم المراجعة وقت التسليم (SEC-R3-07)
                const serverQuestionsRevision = lesson.template?.questionsRevision ?? 1;

                const result = await tx.studentLessonResult.create({
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
                        version: nextVersion,
                        questionsRevisionAtSubmit: serverQuestionsRevision,
                    },
                });

                if (clientAttemptUuid) {
                    await tx.processedClientChange.create({
                        data: {
                            clientChangeUuid: clientAttemptUuid,
                            entityType: 'quiz_submission',
                            entityUuid: result.uuid,
                            studentId,
                        },
                    });
                }

                // حفظ الإجابات المقيّمة خادمياً بالـ upsert الذري
                for (const ev of evaluatedAnswers) {
                    const serializedAnswer =
                        typeof ev.answerValue === 'string'
                            ? ev.answerValue
                            : JSON.stringify(ev.answerValue ?? null);

                    await tx.studentAnswer.upsert({
                        where: {
                            studentId_questionId: { studentId, questionId: ev.question.id },
                        },
                        update: {
                            resultId: result.id,
                            answerValue: serializedAnswer,
                            correctness: ev.isCorrect ? 'CORRECT' : 'WRONG',
                            isCorrect: ev.isCorrect,
                            scoreAwarded: ev.scoreAwarded,
                            isDeleted: false,
                            deletedAt: null,
                        },
                        create: {
                            studentId,
                            questionId: ev.question.id,
                            resultId: result.id,
                            answerValue: serializedAnswer,
                            correctness: ev.isCorrect ? 'CORRECT' : 'WRONG',
                            isCorrect: ev.isCorrect,
                            scoreAwarded: ev.scoreAwarded,
                        },
                    });
                }

                // تحديث progress بالمفتاح المركّب الفريد لتفادي خطأ id: 0 (SEC-R3-01)
                await tx.studentLessonProgress.upsert({
                    where: {
                        studentId_lessonId: { studentId, lessonId: lesson.id },
                    },
                    update: {
                        status: 'COMPLETED',
                        isDeleted: false,
                        deletedAt: null,
                    },
                    create: {
                        studentId,
                        lessonId: lesson.id,
                        status: 'COMPLETED',
                        lastPosition: JSON.stringify({ attemptNumber: nextVersion }),
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
                    remainingAttempts: Math.max(0, MAX_ATTEMPTS - (attemptCount + 1)),
                };
            });
        } catch (error: any) {
            const isUniqueViolation =
                error?.code === 'P2002' ||
                (typeof error?.message === 'string' && error.message.includes('Unique constraint'));
            const metaTarget = error?.meta?.target;
            const targetsClientChangeUuid =
                !metaTarget ||
                (Array.isArray(metaTarget) &&
                    metaTarget.some(
                        (t: unknown) =>
                            String(t).includes('client_change_uuid') ||
                            String(t).includes('clientChangeUuid'),
                    )) ||
                (typeof metaTarget === 'string' &&
                    (metaTarget.includes('client_change_uuid') ||
                        metaTarget.includes('clientChangeUuid')));

            if (clientAttemptUuid && isUniqueViolation && targetsClientChangeUuid) {
                const processedClientChangeDelegate = (this.prisma as any).processedClientChange;
                if (typeof processedClientChangeDelegate?.findUnique === 'function') {
                    const existing = await processedClientChangeDelegate.findUnique({
                        where: { clientChangeUuid: clientAttemptUuid },
                        select: { studentId: true, entityType: true, entityUuid: true },
                    });
                    if (
                        existing &&
                        resolvedStudentId !== undefined &&
                        resolvedLessonId !== undefined &&
                        existing.studentId === resolvedStudentId &&
                        existing.entityType === 'quiz_submission'
                    ) {
                        const priorResult = await this.prisma.studentLessonResult.findFirst({
                            where: {
                                uuid: existing.entityUuid,
                                studentId: resolvedStudentId,
                                lessonId: resolvedLessonId,
                                isDeleted: false,
                            },
                        });
                        if (priorResult) {
                            const currentAttempts = await this.prisma.studentLessonResult.count({
                                where: {
                                    studentId: resolvedStudentId,
                                    lessonId: resolvedLessonId,
                                    isDeleted: false,
                                },
                            });
                            return {
                                resultUuid: priorResult.uuid,
                                totalQuestions: priorResult.totalQuestions,
                                correctQuestions: priorResult.correctQuestions,
                                totalPoints: priorResult.totalPoints,
                                earnedPoints: priorResult.earnedPoints,
                                percent: Math.round(priorResult.percent),
                                gradeLabel: priorResult.gradeLabel,
                                attemptNumber: priorResult.version,
                                remainingAttempts: Math.max(0, MAX_ATTEMPTS - currentAttempts),
                                idempotentReplay: true,
                            };
                        }
                    }
                }
                throw new ConflictException('CLIENT_ATTEMPT_CONFLICT');
            }
            throw error;
        }
    }

    // ─────── Get result ──────────────────────────────────────────────────────

    async getResult(schoolId: number, userUuid: string, lessonUuid: string) {
        const { studentId, lesson } = await this.getStudentAndLesson(schoolId, userUuid, lessonUuid);

        const result = await this.prisma.studentLessonResult.findFirst({
            where: { studentId, lessonId: lesson.id, isDeleted: false },
            orderBy: [{ calculatedAt: 'desc' }, { version: 'desc' }],
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
            orderBy: [{ calculatedAt: 'desc' }, { version: 'desc' }],
        });
        if (!result) throw new NotFoundException('RESULT_NOT_FOUND');

        // DEC-026 Phase 9: جلب questionsRevision لمقارنة revision
        const template = await this.prisma.lessonTemplate.findUnique({
            where: { id: lesson.templateId },
            select: { questionsRevision: true },
        });

        const reviewAvailable =
            result.questionsRevisionAtSubmit === null ||
            result.questionsRevisionAtSubmit === template?.questionsRevision;

        // إذا الأسئلة تغيرت — نرجع النتيجة فقط بدون أسئلة
        if (!reviewAvailable) {
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
                reviewAvailable: false,
                questions: [],
            };
        }

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
                        leftAudioAsset: { select: { uuid: true } },
                        rightText: true, rightImageAsset: { select: { uuid: true } },
                        rightAudioAsset: { select: { uuid: true } },
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
                instructionText: q.instructionText ?? null,
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
                        leftAudioAssetUuid: (p as any).leftAudioAsset?.uuid ?? null,
                        rightText: p.rightText, rightImageAssetUuid: p.rightImageAsset?.uuid ?? null,
                        rightAudioAssetUuid: (p as any).rightAudioAsset?.uuid ?? null,
                        leftOrderIndex: p.leftOrderIndex, rightOrderIndex: p.rightOrderIndex,
                    }));
                    break;
                case 'ORDERING':
                case 'IMAGE_STEP_SORTING':
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
            reviewAvailable: true,
            questions: reviewQuestions,
        };
    }

    // ─────── Mark lesson as read (no quiz) ─────────────────────────────────────

    /**
     * تأكيد قراءة درس بدون أسئلة — يسمح للطالب بالتقدم
     */
    async markLessonRead(
        schoolId: number,
        userUuid: string,
        lessonUuid: string,
    ) {
        return this.prisma.$transaction(async (tx) => {
            const { studentId, lesson } = await this.getStudentAndLesson(
                schoolId,
                userUuid,
                lessonUuid,
                tx,
            );

            // قفل استشاري لمنع إنشاء عدة نتائج 100% بالتوازي (SEC-R3-02)
            await tx.$executeRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(CAST(${studentId} AS INTEGER), CAST(${lesson.id} AS INTEGER))`,
            );

            // التحقق أن الدرس ليس فيه أسئلة
            const questionCount = await tx.question.count({
                where: { templateId: lesson.templateId, isDeleted: false },
            });

            if (questionCount > 0) {
                throw new BadRequestException('هذا الدرس يحتوي على أسئلة — استخدم submit-quiz');
            }

            // التحقق أنه لم يُكمل من قبل داخل القفل
            const existing = await tx.studentLessonResult.findFirst({
                where: { studentId, lessonId: lesson.id, isDeleted: false },
            });

            if (existing) {
                await tx.studentLessonProgress.upsert({
                    where: {
                        studentId_lessonId: { studentId, lessonId: lesson.id },
                    },
                    update: {
                        status: 'COMPLETED',
                        isDeleted: false,
                        deletedAt: null,
                    },
                    create: {
                        studentId,
                        lessonId: lesson.id,
                        status: 'COMPLETED',
                        lastPosition: JSON.stringify({ type: 'mark_read' }),
                    },
                });
                return { message: 'تم إنجاز الدرس مسبقاً', alreadyCompleted: true };
            }

            const versionAgg = await tx.studentLessonResult.aggregate({
                where: { studentId, lessonId: lesson.id },
                _max: { version: true },
            });
            const nextVersion = (versionAgg._max.version ?? 0) + 1;

            // إنشاء نتيجة 100% (درس قرائي)
            const result = await tx.studentLessonResult.create({
                data: {
                    studentId,
                    lessonId: lesson.id,
                    totalQuestions: 0,
                    correctQuestions: 0,
                    totalPoints: 0,
                    earnedPoints: 0,
                    percent: 100,
                    gradeLabel: 'تمت القراءة',
                    calculatedAt: new Date(),
                    version: nextVersion,
                    questionsRevisionAtSubmit: lesson.template?.questionsRevision ?? 1,
                },
            });

            // تحديث progress بالمفتاح المركّب لتفادي خطأ id: 0 (SEC-R3-01)
            await tx.studentLessonProgress.upsert({
                where: {
                    studentId_lessonId: { studentId, lessonId: lesson.id },
                },
                update: {
                    status: 'COMPLETED',
                    isDeleted: false,
                    deletedAt: null,
                },
                create: {
                    studentId,
                    lessonId: lesson.id,
                    status: 'COMPLETED',
                    lastPosition: JSON.stringify({ type: 'mark_read' }),
                },
            });

            return {
                message: 'تم إنجاز الدرس بنجاح',
                resultUuid: result.uuid,
                alreadyCompleted: false,
            };
        });
    }

    private shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
