// src/school/student/timetable/student-timetable.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class StudentTimetableService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * GET /school/student/my-timetable
     * جلب جدول الطالب الأسبوعي حسب شعبته الحالية
     *
     * السلسلة:
     * Student → StudentEnrollment(isCurrent, ACTIVE) → sectionId
     *   → Timetable → TimetableSlot → SubjectSection → Subject + Teacher
     *
     * الفرق عن جدول المعلم:
     * - المعلم يرى "المادة + الصف/الشعبة" في كل خانة
     * - الطالب يرى "المادة + اسم المعلم" في كل خانة (لأنه في شعبة واحدة)
     */
    async getMyTimetable(schoolId: number, userUuid: string) {
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
            include: {
                section: {
                    select: {
                        id: true,
                        name: true,
                        grade: { select: { displayName: true } },
                    },
                },
            },
        });

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        // 3. جلب السنة والفصل الحاليين
        const year = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: { terms: { where: { isCurrent: true, isDeleted: false }, take: 1 } },
        });

        if (!year || year.terms.length === 0) {
            return {
                sectionName: enrollment.section.name,
                gradeName: enrollment.section.grade.displayName,
                yearId: null,
                termId: null,
                slots: [],
            };
        }

        const yearId = year.id;
        const termId = year.terms[0].id;

        // 4. جلب جدول الشعبة
        const timetable = await this.prisma.timetable.findFirst({
            where: {
                sectionId: enrollment.sectionId,
                yearId,
                termId,
                isDeleted: false,
            },
        });

        if (!timetable) {
            return {
                sectionName: enrollment.section.name,
                gradeName: enrollment.section.grade.displayName,
                yearId,
                termId,
                slots: [],
            };
        }

        // 5. جلب حصص الجدول مع المادة والمعلم
        const slots = await this.prisma.timetableSlot.findMany({
            where: {
                timetableId: timetable.id,
                isDeleted: false,
            },
            orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
            include: {
                subjectSection: {
                    include: {
                        subject: {
                            select: {
                                id: true,
                                uuid: true,
                                displayName: true,
                                shortName: true,
                            },
                        },
                        teachers: {
                            where: { isDeleted: false, isActive: true },
                            include: {
                                teacher: {
                                    include: {
                                        user: { select: { name: true } },
                                    },
                                },
                            },
                            take: 1,
                        },
                    },
                },
            },
        });

        return {
            sectionName: enrollment.section.name,
            gradeName: enrollment.section.grade.displayName,
            yearId,
            termId,
            slots: slots.map((slot) => {
                const ss = slot.subjectSection;
                const teacherName = ss?.teachers?.[0]?.teacher?.user?.name ?? null;

                return {
                    weekday: slot.weekday,
                    lessonNumber: slot.lessonNumber,
                    subject: ss ? {
                        id: ss.subject.id,
                        uuid: ss.subject.uuid,
                        displayName: ss.subject.displayName,
                        shortName: ss.subject.shortName,
                    } : null,
                    // الطالب يرى اسم المعلم بدلاً من الصف/الشعبة
                    teacherName,
                };
            }),
        };
    }
}
