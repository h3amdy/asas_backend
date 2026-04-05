// src/school/student/subjects/student-subjects.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StudentSubjectsService {
    constructor(private readonly prisma: PrismaService) { }

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
                    },
                },
            },
        });

        // 4. تجميع بدون تكرار
        const seen = new Set<string>();
        const result: {
            uuid: string;
            displayName: string;
            shortName: string | null;
            coverMediaAssetUuid: string | null;
        }[] = [];

        for (const ss of subjectSections) {
            const subject = ss.subject;
            if (!seen.has(subject.uuid)) {
                seen.add(subject.uuid);
                result.push({
                    uuid: subject.uuid,
                    displayName: subject.displayName,
                    shortName: subject.shortName,
                    coverMediaAssetUuid: subject.coverMediaAsset?.uuid ?? null,
                });
            }
        }

        // 5. ترتيب حسب اسم المادة
        return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
}
