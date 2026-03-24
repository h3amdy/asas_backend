// src/school/teacher/subjects/teacher-subjects.service.ts
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class TeacherSubjectsService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * GET /school/teacher/my-subjects
     * جلب المواد المسندة للمعلم الحالي مع الصفوف والشعب
     *
     * يجمع النتائج بحيث:
     * - كل مادة تظهر مرة واحدة
     * - تحتها قائمة الشعب المسندة لهذا المعلم
     */
    async getMySubjects(schoolId: number, userUuid: string) {
        // 1. جلب Teacher ID من UUID المستخدم
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
            include: { teacher: { select: { userId: true } } },
        });

        if (!user || !user.teacher) {
            throw new UnauthorizedException('USER_IS_NOT_TEACHER');
        }

        const teacherId = user.teacher.userId;

        // 2. جلب كل SubjectSectionTeacher records لهذا المعلم
        const assignments = await this.prisma.subjectSectionTeacher.findMany({
            where: {
                teacherId,
                isDeleted: false,
                isActive: true,
                subjectSection: {
                    isDeleted: false,
                    subject: { schoolId, isDeleted: false },
                },
            },
            include: {
                subjectSection: {
                    include: {
                        subject: {
                            include: {
                                grade: { select: { id: true, displayName: true } },
                                coverMediaAsset: { select: { uuid: true } },
                            },
                        },
                        section: { select: { id: true, name: true, orderIndex: true } },
                    },
                },
            },
        });

        // 3. تجميع حسب المادة (subject)
        const subjectsMap = new Map<string, {
            uuid: string;
            displayName: string;
            shortName: string | null;
            coverMediaAssetUuid: string | null;
            grade: { id: number; displayName: string };
            sections: { id: number; name: string; orderIndex: number | null }[];
        }>();

        for (const a of assignments) {
            const subject = a.subjectSection.subject;
            const section = a.subjectSection.section;

            if (!subjectsMap.has(subject.uuid)) {
                subjectsMap.set(subject.uuid, {
                    uuid: subject.uuid,
                    displayName: subject.displayName,
                    shortName: subject.shortName,
                    coverMediaAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                    grade: subject.grade,
                    sections: [],
                });
            }

            subjectsMap.get(subject.uuid)!.sections.push({
                id: section.id,
                name: section.name,
                orderIndex: section.orderIndex,
            });
        }

        // 4. ترتيب وإرجاع
        const result = Array.from(subjectsMap.values());

        // ترتيب الشعب داخل كل مادة
        for (const subject of result) {
            subject.sections.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
        }

        return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
}
