// src/school/common/helpers/lesson-revision.helper.ts
//
// DEC-026: Revision Infrastructure — Phase 2
//
// Helpers لزيادة contentRevision / questionsRevision
// وتحديث Lesson.updatedAt كـ Sync signal.
//
// قواعد (من DEC-026 + SRS-LSN-026):
//   - Revision يزيد بغض النظر عن حالة الدرس (DRAFT/READY/SCHEDULED/PUBLISHED)
//   - contentRevision مستقل عن questionsRevision
//   - Lesson.updatedAt = Sync signal مستقل عن Revision وعن حالة النشر
//   - كل العمليات داخل Transaction واحدة (ذرية)
//   - لا نستخدم DB Trigger — العملية في Service
//
import { PrismaService } from '../../../prisma/prisma.service';

type PrismaTransaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * تحديث `Lesson.updatedAt` لكل Lessons المرتبطة بالـ Template.
 *
 * هذا Sync signal يخبر أي مستهلك (Student / Teacher / Admin)
 * أن نسخته المحلية من الـ Lesson قد تكون قديمة.
 *
 * - يعمل على كل الحالات (DRAFT/READY/SCHEDULED/PUBLISHED) عدا ARCHIVED
 * - يستبعد الـ Lessons المحذوفة (isDeleted = true)
 * - مستقل عن النشر — DEC-026 §21
 *
 * @param tx         — Prisma transaction client
 * @param templateId — ID الـ LessonTemplate المتأثر
 */
export async function touchRelatedLessons(
    tx: PrismaTransaction,
    templateId: number,
): Promise<void> {
    await tx.lesson.updateMany({
        where: {
            templateId,
            status: { not: 'ARCHIVED' },
            isDeleted: false,
        },
        data: {
            updatedAt: new Date(),
        },
    });
}

/**
 * زيادة `contentRevision` على LessonTemplate وتحديث Sync signal.
 *
 * يُستدعى عند أي mutation على المحتوى التعليمي:
 *   createBlock, updateBlock, deleteBlock, reorderBlocks,
 *   createBlockItem, updateBlockItem, deleteBlockItem, reorderBlockItems
 *
 * - لا يزيد questionsRevision
 * - يعمل بغض النظر عن حالة الدرس — DEC-026 §5
 * - يجب أن يُستدعى داخل نفس Transaction مع الـ mutation
 *
 * @param tx         — Prisma transaction client
 * @param templateId — ID الـ LessonTemplate المتأثر
 */
export async function bumpContentRevision(
    tx: PrismaTransaction,
    templateId: number,
): Promise<void> {
    await tx.lessonTemplate.update({
        where: { id: templateId },
        data: {
            contentRevision: { increment: 1 },
        },
    });
    await touchRelatedLessons(tx, templateId);
}

/**
 * زيادة `questionsRevision` على LessonTemplate وتحديث Sync signal.
 *
 * يُستدعى عند أي mutation على الأسئلة:
 *   createQuestion, updateQuestion, deleteQuestion, reorderQuestions
 *
 * - لا يزيد contentRevision
 * - يعمل بغض النظر عن حالة الدرس — DEC-026 §5
 * - يجب أن يُستدعى داخل نفس Transaction مع الـ mutation
 *
 * @param tx         — Prisma transaction client
 * @param templateId — ID الـ LessonTemplate المتأثر
 */
export async function bumpQuestionsRevision(
    tx: PrismaTransaction,
    templateId: number,
): Promise<void> {
    await tx.lessonTemplate.update({
        where: { id: templateId },
        data: {
            questionsRevision: { increment: 1 },
        },
    });
    await touchRelatedLessons(tx, templateId);
}
