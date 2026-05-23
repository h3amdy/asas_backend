// src/school/student/books/student-books.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * 📚 Student Books Service
 *
 * جلب الكتب المدرسية المرتبطة بمادة الطالب عبر سلسلة القاموس:
 * Subject.dictionaryId → SubjectDictionary.id
 * Subject.grade.dictionaryId → GradeDictionary.id
 * ↓
 * SchoolBook WHERE (subjectDictionaryId, gradeDictionaryId, semester)
 */
@Injectable()
export class StudentBooksService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * GET /school/student/my-books?subjectUuid=xxx
     * جلب كتب مادة محددة للطالب
     */
    async getMyBooks(schoolId: number, userUuid: string, subjectUuid: string) {
        // 1. جلب Student
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { student: { select: { userId: true } } },
        });

        if (!user || !user.student) {
            throw new ForbiddenException('USER_IS_NOT_STUDENT');
        }

        const studentId = user.student.userId;

        // 2. جلب enrollment الحالي
        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
            include: {
                section: {
                    include: {
                        grade: { select: { id: true, dictionaryId: true } },
                    },
                },
            },
        });

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        // 3. جلب المادة والتحقق من ارتباطها بالشعبة
        const subjectSection = await this.prisma.subjectSection.findFirst({
            where: {
                sectionId: enrollment.sectionId,
                isDeleted: false,
                isActive: true,
                subject: {
                    uuid: subjectUuid,
                    schoolId,
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                subject: {
                    select: {
                        id: true,
                        dictionaryId: true,
                        gradeId: true,
                        grade: { select: { dictionaryId: true } },
                    },
                },
            },
        });

        if (!subjectSection) {
            throw new NotFoundException('SUBJECT_NOT_FOUND_FOR_STUDENT');
        }

        const { dictionaryId } = subjectSection.subject;
        const gradeDictionaryId = subjectSection.subject.grade.dictionaryId;

        // إذا المادة ليست مرتبطة بقاموس رسمي — لا كتب
        if (!dictionaryId || !gradeDictionaryId) {
            return [];
        }

        // 4. تحديد الفصل الحالي → semester mapping
        const allowedSemesters = await this._getAllowedSemesters(schoolId);

        // 5. جلب الكتب
        const books = await this.prisma.schoolBook.findMany({
            where: {
                subjectDictionaryId: dictionaryId,
                gradeDictionaryId: gradeDictionaryId,
                semester: { in: allowedSemesters as any },
                isActive: true,
                isDeleted: false,
            },
            include: {
                coverMediaAsset: { select: { uuid: true } },
                pdfMediaAsset: { select: { uuid: true, sizeBytes: true } },
            },
            orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        });

        return books.map((b) => ({
            uuid: b.uuid,
            title: b.title,
            description: b.description,
            semester: b.semester,
            coverMediaAssetUuid: b.coverMediaAsset?.uuid ?? null,
            pdfMediaAssetUuid: b.pdfMediaAsset?.uuid ?? null,
            pdfSizeBytes: b.pdfMediaAsset?.sizeBytes
                ? Number(b.pdfMediaAsset.sizeBytes)
                : 0,
            sortOrder: b.sortOrder,
        }));
    }

    /**
     * حساب hasBooks لمادة معينة — يُستخدم من student-subjects.service
     */
    async countBooksForSubject(
        subjectDictionaryId: number | null,
        gradeDictionaryId: number | null,
        allowedSemesters: string[],
    ): Promise<number> {
        if (!subjectDictionaryId || !gradeDictionaryId) return 0;

        return this.prisma.schoolBook.count({
            where: {
                subjectDictionaryId,
                gradeDictionaryId,
                semester: { in: allowedSemesters as any },
                isActive: true,
                isDeleted: false,
            },
        });
    }

    /**
     * جلب الفصول المسموحة بناءً على الفصل الحالي للمدرسة
     *
     * القاعدة:
     * | orderIndex | allowedSemesters    |
     * |------------|---------------------|
     * | 1          | ['FIRST', 'FULL']   |
     * | 2          | ['SECOND', 'FULL']  |
     * | 3+         | ['SECOND', 'FULL']  |
     * | لا فصل     | ['FULL']            |
     */
    async _getAllowedSemesters(schoolId: number): Promise<string[]> {
        // جلب السنة الحالية والفصل الحالي
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: {
                terms: {
                    where: { isCurrent: true, isDeleted: false },
                    take: 1,
                    select: { orderIndex: true },
                },
            },
        });

        if (!currentYear || currentYear.terms.length === 0) {
            // لا يوجد فصل حالي — اعرض FULL فقط
            return ['FULL'];
        }

        const orderIndex = currentYear.terms[0].orderIndex;

        if (orderIndex === 1) return ['FIRST', 'FULL'];
        // orderIndex >= 2 (الثاني أو الثالث أو أكثر)
        return ['SECOND', 'FULL'];
    }
}
