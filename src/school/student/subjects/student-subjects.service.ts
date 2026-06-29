// src/school/student/subjects/student-subjects.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StudentBooksService } from '../books/student-books.service';

@Injectable()
export class StudentSubjectsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly booksService: StudentBooksService,
    ) { }

    /**
     * GET /school/student/my-subjects
     * جلب المواد المسجّلة للطالب حسب شعبته الحالية
     *
     * السلسلة:
     * Student → StudentEnrollment(isCurrent, ACTIVE) → sectionId
     *   → SubjectSection → Subject
     */
    async getMySubjects(schoolId: number, userUuid: string) {
        // 1. جلب Student من UUID المستخدم
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { student: { select: { userId: true } } },
        });

        if (!user || !user.student) {
            throw new ForbiddenException('USER_IS_NOT_STUDENT');
        }

        const studentId = user.student.userId;

        // 2. جلب enrollment الحالي النشط
        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
        });

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        // 3. جلب المواد المرتبطة بالشعبة
        const subjectSections = await this.prisma.subjectSection.findMany({
            where: {
                sectionId: enrollment.sectionId,
                isDeleted: false,
                isActive: true,
                subject: {
                    schoolId,
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                subject: {
                    include: {
                        coverMediaAsset: { select: { uuid: true } },
                        grade: { select: { dictionaryId: true } },
                    },
                },
            },
        });

        // 4. جلب إحصائيات الدروس لكل مادة (المنشورة والمستهدفة لهذه الشعبة)
        // DEC-020 v3.0: Per-Target visibility
        const targetedLessons = await this.prisma.lessonTarget.findMany({
            where: {
                sectionId: enrollment.sectionId,
                publishedAt: { not: null },
                lesson: {
                    schoolId,
                    status: { not: 'ARCHIVED' },
                    isDeleted: false,
                    isActive: true,
                },
            },
            include: {
                lesson: {
                    select: { id: true, subjectId: true },
                },
            },
        });

        const completedProgress = await this.prisma.studentLessonProgress.findMany({
            where: { studentId, status: 'COMPLETED', isDeleted: false },
            select: { lessonId: true },
        });
        const completedLessonIds = new Set(completedProgress.map(p => p.lessonId));

        // تجميع الإحصائيات حسب subjectId
        const statsMap = new Map<number, { total: number, completed: number, hasNew: boolean }>();

        for (const target of targetedLessons) {
            const subjectId = target.lesson.subjectId;
            if (!statsMap.has(subjectId)) {
                statsMap.set(subjectId, { total: 0, completed: 0, hasNew: false });
            }

            const stats = statsMap.get(subjectId)!;
            stats.total++;

            const isCompleted = completedLessonIds.has(target.lessonId);
            if (isCompleted) {
                stats.completed++;
            } else {
                // درس غير منجز.. نعتبره "جديد" بناءً على طلب المستخدم
                stats.hasNew = true;
            }
        }

        // 5. حساب hasBooks لكل مادة
        const allowedSemesters = await this.booksService._getAllowedSemesters(schoolId);

        // 6. تجميع الرد بدون تكرار للمواد
        const seen = new Set<string>();
        const result: {
            uuid: string;
            displayName: string;
            shortName: string | null;
            coverMediaAssetUuid: string | null;
            totalLessons: number;
            completedLessons: number;
            hasNewLessons: boolean;
            hasBooks: boolean;
        }[] = [];

        for (const ss of subjectSections) {
            const subject = ss.subject;
            if (!seen.has(subject.uuid)) {
                seen.add(subject.uuid);
                
                const stats = statsMap.get(subject.id) || { total: 0, completed: 0, hasNew: false };

                const bookCount = await this.booksService.countBooksForSubject(
                    subject.dictionaryId,
                    (subject as any).grade?.dictionaryId ?? null,
                    allowedSemesters,
                );
                
                result.push({
                    uuid: subject.uuid,
                    displayName: subject.displayName,
                    shortName: subject.shortName,
                    coverMediaAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                    totalLessons: stats.total,
                    completedLessons: stats.completed,
                    hasNewLessons: stats.hasNew,
                    hasBooks: bookCount > 0,
                });
            }
        }

        // 7. ترتيب حسب اسم المادة
        return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
}
