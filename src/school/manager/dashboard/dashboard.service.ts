// src/school/manager/dashboard/dashboard.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DashboardService {
    constructor(private readonly prisma: PrismaService) { }

    async getStats(schoolId: number, adminName: string) {
        const [studentsCount, teachersCount, subjectsCount, gradesCount, sectionsCount] =
            await Promise.all([
                this.prisma.studentEnrollment.count({
                    where: {
                        section: { grade: { schoolId } },
                        isDeleted: false,
                        isCurrent: true,
                    },
                }),
                this.prisma.user.count({
                    where: { schoolId, userType: 'TEACHER', isDeleted: false, isActive: true },
                }),
                this.prisma.subject.count({
                    where: { schoolId, isDeleted: false },
                }),
                this.prisma.schoolGrade.count({
                    where: { schoolId, isDeleted: false },
                }),
                this.prisma.section.count({
                    where: { grade: { schoolId }, isDeleted: false },
                }),
            ]);

        return {
            adminName,
            studentsCount,
            teachersCount,
            subjectsCount,
            gradesCount,
            sectionsCount,
        };
    }
}
