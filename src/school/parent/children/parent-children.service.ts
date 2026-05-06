// src/school/parent/children/parent-children.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StudentProgressSummaryService } from '../../common/services/student-progress-summary.service';

/**
 * 👨‍👧‍👦 خدمة قائمة أبناء ولي الأمر
 *
 * SRS-PAR-010: استعراض قائمة الأبناء مع ملخص الإنجاز
 * المرجع: doc/srs/parent/SRS-PAR-010-children-list.md
 */
@Injectable()
export class ParentChildrenService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly progressService: StudentProgressSummaryService,
    ) { }

    /**
     * GET /school/parent/my-children
     * جلب قائمة الأبناء المرتبطين بحساب ولي الأمر مع ملخص الإنجاز
     *
     * السلسلة:
     * Parent → ParentStudent → Student → User + Enrollment(isCurrent)
     *   → StudentProgressSummaryService (الفصل الحالي)
     */
    async getMyChildren(schoolId: number, parentUserUuid: string) {
        // 1. جلب Parent من UUID المستخدم
        const user = await this.prisma.user.findFirst({
            where: {
                uuid: parentUserUuid,
                schoolId,
                userType: 'PARENT',
                isDeleted: false,
            },
            include: { parent: { select: { userId: true } } },
        });

        if (!user || !user.parent) {
            throw new ForbiddenException('USER_IS_NOT_PARENT');
        }

        const parentId = user.parent.userId;

        // 2. جلب الأبناء المرتبطين (مع بيانات القيد) — batch query
        const childLinks = await this.prisma.parentStudent.findMany({
            where: { parentId, isDeleted: false },
            include: {
                student: {
                    include: {
                        user: {
                            select: {
                                uuid: true,
                                name: true,
                                isActive: true,
                                isDeleted: true,
                            },
                        },
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                            include: {
                                grade: { select: { displayName: true } },
                                section: { select: { name: true } },
                            },
                            take: 1,
                        },
                    },
                },
            },
        });

        // 3. فلترة: إخفاء الطلاب المحذوفين
        const validLinks = childLinks.filter(
            link => !link.student.user.isDeleted,
        );

        // 4. حساب الإنجاز لكل ابن (عبر StudentProgressSummaryService)
        const result = await Promise.all(
            validLinks.map(async (link) => {
                const student = link.student;
                const enrollment = student.enrollments[0] ?? null;

                const progress = enrollment
                    ? await this.progressService.getStudentProgressSummary(
                        schoolId,
                        student.userId,
                        enrollment.sectionId,
                    )
                    : { totalLessons: 0, completedLessons: 0, progressPercent: 0, termName: null, isFallbackTerm: false };

                return {
                    uuid: student.user.uuid,
                    name: student.user.name,
                    isActive: student.user.isActive,
                    enrollment: enrollment
                        ? {
                            gradeName: enrollment.grade.displayName,
                            sectionName: enrollment.section.name,
                            status: enrollment.status,
                        }
                        : null,
                    progress,
                };
            }),
        );

        // 5. ترتيب حسب الاسم
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }
}
