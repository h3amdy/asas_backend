// src/school/student/quiz/helpers/answer-evaluator.ts

/**
 * Prisma include الموحّد لجلب كافة بيانات السؤال اللازمة للتصحيح الخادمي الموثوق.
 */
export const QUESTION_EVALUATION_INCLUDE = {
    options: { where: { isDeleted: false } },
    matchingPairs: { where: { isDeleted: false } },
    orderingItems: { where: { isDeleted: false } },
    fillBlanks: { where: { isDeleted: false } },
    fillAnswers: { where: { isDeleted: false } },
} as const;

/**
 * تحليل answerValue سواء أُرسل ككائن JSON (من submitQuiz/checkAnswer)
 * أو كنص JSON مُسلسل (من Flutter Sync Outbox).
 */
export function parseAnswerValue(raw: unknown): any {
    if (typeof raw !== 'string') {
        return raw;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return raw;
    }
}

/**
 * تقييم إجابة طالب لسؤال واحد على الخادم بشكل حتمي وصارم دون أي اعتماد على العميل
 * ودون تعديل مصفوفات السؤال الأصلية.
 */
export function evaluateQuestionAnswer(question: any, rawAnswerValue: unknown): boolean {
    if (!question || !question.type) {
        return false;
    }

    const answerValue = parseAnswerValue(rawAnswerValue);
    if (!answerValue || typeof answerValue !== 'object') {
        return false;
    }

    switch (question.type) {
        case 'MCQ':
        case 'TRUE_FALSE': {
            const selectedUuid = answerValue.selectedOptionUuid;
            if (typeof selectedUuid !== 'string' || selectedUuid.trim().length === 0) {
                return false;
            }
            const options: any[] = Array.isArray(question.options) ? question.options : [];
            return options.some((o) => Boolean(o.isCorrect) && o.uuid === selectedUuid);
        }

        case 'MATCHING': {
            if (!Array.isArray(answerValue.pairs) || answerValue.pairs.length === 0) {
                return false;
            }
            const correctPairs: any[] = Array.isArray(question.matchingPairs)
                ? question.matchingPairs
                : [];
            if (correctPairs.length === 0 || answerValue.pairs.length !== correctPairs.length) {
                return false;
            }

            const seenLeft = new Set<string>();
            const seenRight = new Set<string>();

            for (const pair of answerValue.pairs) {
                if (!pair || typeof pair !== 'object') {
                    return false;
                }
                const leftKey = pair.leftPairKey;
                const rightKey = pair.rightPairKey;
                if (
                    typeof leftKey !== 'string' ||
                    leftKey.trim().length === 0 ||
                    typeof rightKey !== 'string' ||
                    rightKey.trim().length === 0
                ) {
                    return false;
                }
                if (seenLeft.has(leftKey) || seenRight.has(rightKey)) {
                    return false;
                }
                if (leftKey !== rightKey) {
                    return false;
                }
                seenLeft.add(leftKey);
                seenRight.add(rightKey);
            }

            return (
                seenLeft.size === correctPairs.length &&
                correctPairs.every((cp) => typeof cp.pairKey === 'string' && seenLeft.has(cp.pairKey))
            );
        }

        case 'ORDERING':
        case 'IMAGE_STEP_SORTING': {
            if (
                !Array.isArray(answerValue.orderedItemUuids) ||
                answerValue.orderedItemUuids.length === 0
            ) {
                return false;
            }
            const items: any[] = Array.isArray(question.orderingItems) ? question.orderingItems : [];
            if (items.length === 0 || answerValue.orderedItemUuids.length !== items.length) {
                return false;
            }

            const correctOrder = [...items]
                .sort((a, b) => Number(a.correctIndex) - Number(b.correctIndex))
                .map((i) => i.uuid);

            for (let i = 0; i < correctOrder.length; i++) {
                if (answerValue.orderedItemUuids[i] !== correctOrder[i]) {
                    return false;
                }
            }
            return true;
        }

        case 'FILL': {
            if (!Array.isArray(answerValue.blanks)) {
                return false;
            }
            const requiredBlanks: any[] = Array.isArray(question.fillBlanks)
                ? question.fillBlanks
                : [];
            const fillAnswers: any[] = Array.isArray(question.fillAnswers)
                ? question.fillAnswers
                : [];

            // إغلاق ثغرة blanks: [] الفارغة والتأكد من تغطية كل الفراغات
            if (requiredBlanks.length === 0 || answerValue.blanks.length !== requiredBlanks.length) {
                return false;
            }

            const submittedByBlankKey = new Map<string, string>();
            for (const blank of answerValue.blanks) {
                if (!blank || typeof blank !== 'object') {
                    return false;
                }
                const blankKey = blank.blankKey;
                const blankAnswer = blank.answer;
                if (
                    typeof blankKey !== 'string' ||
                    blankKey.trim().length === 0 ||
                    typeof blankAnswer !== 'string' ||
                    blankAnswer.trim().length === 0
                ) {
                    return false;
                }
                if (submittedByBlankKey.has(blankKey)) {
                    return false;
                }
                submittedByBlankKey.set(blankKey, blankAnswer.trim().toLowerCase());
            }

            for (const reqBlank of requiredBlanks) {
                const submitted = submittedByBlankKey.get(reqBlank.blankKey);
                if (!submitted) {
                    return false;
                }
                const acceptedAnswers = fillAnswers
                    .filter((a) => a.blankKey === reqBlank.blankKey && typeof a.answerText === 'string')
                    .map((a) => a.answerText.trim().toLowerCase());

                if (!acceptedAnswers.includes(submitted)) {
                    return false;
                }
            }

            return true;
        }

        default:
            return false;
    }
}

/**
 * اشتقاق التقدير اللفظي على الخادم من النسبة المئوية المحسوبة خادمياً.
 */
export function getGradeLabel(percent: number): string {
    if (percent >= 90) return 'ممتاز';
    if (percent >= 80) return 'جيد جداً';
    if (percent >= 70) return 'جيد';
    if (percent >= 60) return 'مقبول';
    return 'ضعيف';
}
