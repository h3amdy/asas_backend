// src/school/common/helpers/subject-import.helper.ts
import { PrismaService } from '../../../prisma/prisma.service';

type PrismaTransaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * استيراد المواد الرسمية تلقائياً عند إضافة صف من القاموس الرسمي.
 *
 * يُستخدم من:
 *   1. GradesService.createGrade()
 *   2. GradesService.createGradesBulk()
 *   3. SetupService.initializeAcademic()
 *
 * @param tx            — Prisma transaction client
 * @param schoolId      — المدرسة
 * @param gradeId       — الصف المُنشأ في المدرسة
 * @param dictionaryId  — ID القاموس الرسمي للصف (GradeDictionary.id)
 * @returns عدد المواد المُستوردة
 */
export async function autoImportSubjectsForGrade(
    tx: PrismaTransaction,
    schoolId: number,
    gradeId: number,
    dictionaryId: number,
): Promise<number> {
    // 1. جلب المواد الرسمية المفعلة التابعة لهذا الصف
    const dictSubjects = await tx.subjectDictionary.findMany({
        where: {
            gradeDictionaryId: dictionaryId,
            isDeleted: false,
            isActive: true,
        },
        orderBy: { sortOrder: 'asc' },
    });

    if (dictSubjects.length === 0) return 0;

    // 2. جلب الشعب الموجودة للصف (لربط المواد بها)
    const sections = await tx.section.findMany({
        where: { gradeId, isDeleted: false },
    });

    let importedCount = 0;

    for (const dictSubject of dictSubjects) {
        // 3. منع التكرار — إذا المادة مُستوردة سابقاً في هذه المدرسة
        const exists = await tx.subject.findFirst({
            where: { schoolId, dictionaryId: dictSubject.id, isDeleted: false },
        });
        if (exists) continue;

        // 4. إنشاء المادة مع وراثة البيانات من القاموس
        const subject = await tx.subject.create({
            data: {
                schoolId,
                gradeId,
                dictionaryId: dictSubject.id,
                displayName: dictSubject.defaultName,
                shortName: dictSubject.shortName,
                code: dictSubject.code,
            },
        });

        // 5. ربط المادة بكل شعب الصف
        for (const section of sections) {
            await tx.subjectSection.create({
                data: { subjectId: subject.id, sectionId: section.id },
            });
        }

        importedCount++;
    }

    return importedCount;
}
