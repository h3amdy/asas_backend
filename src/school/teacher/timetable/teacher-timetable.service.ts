// src/school/teacher/timetable/teacher-timetable.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class TeacherTimetableService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * جلب جدول المعلم الحالي — يكتشف السنة والفصل الحاليين تلقائياً
     */
    async getMyTimetable(schoolId: number, teacherUuid: string) {
        // 1. جلب السنة والفصل الحاليين
        const year = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: { terms: { where: { isCurrent: true, isDeleted: false }, take: 1 } },
        });

        if (!year || year.terms.length === 0) {
            return {
                teacherUuid,
                teacherName: '',
                teacherCode: null,
                yearId: null,
                termId: null,
                slots: [],
            };
        }

        const yearId = year.id;
        const termId = year.terms[0].id;

        // 2. التعرف على المعلم
        const teacher = await this.prisma.teacher.findFirst({
            where: {
                user: { uuid: teacherUuid, schoolId, isActive: true },
            },
            include: {
                user: { select: { uuid: true, name: true, code: true } },
            },
        });
        if (!teacher) throw new NotFoundException('TEACHER_NOT_FOUND');

        // 3. جلب كل حصص المعلم
        const slots = await this.prisma.timetableSlot.findMany({
            where: {
                isDeleted: false,
                timetable: {
                    yearId,
                    termId,
                    isDeleted: false,
                    section: {
                        isDeleted: false,
                        grade: { schoolId, isDeleted: false },
                    },
                },
                subjectSection: {
                    isDeleted: false,
                    teachers: {
                        some: {
                            teacherId: teacher.userId,
                            isDeleted: false,
                            isActive: true,
                        },
                    },
                },
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
                        section: {
                            select: {
                                id: true,
                                name: true,
                                grade: { select: { displayName: true } },
                            },
                        },
                    },
                },
            },
        });

        return {
            teacherUuid: teacher.user.uuid,
            teacherName: teacher.user.name,
            teacherCode: teacher.user.code,
            yearId,
            termId,
            slots: slots.map((slot) => ({
                weekday: slot.weekday,
                lessonNumber: slot.lessonNumber,
                subject: slot.subjectSection ? {
                    id: slot.subjectSection.subject.id,
                    uuid: slot.subjectSection.subject.uuid,
                    displayName: slot.subjectSection.subject.displayName,
                    shortName: slot.subjectSection.subject.shortName,
                } : null,
                section: slot.subjectSection ? {
                    id: slot.subjectSection.section.id,
                    name: slot.subjectSection.section.name,
                    gradeName: slot.subjectSection.section.grade.displayName,
                } : null,
            })),
        };
    }
}
