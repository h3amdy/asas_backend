// src/school/manager/students/students.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto, TransferStudentDto } from './dto/students.dto';

@Injectable()
export class StudentsService {
    constructor(private readonly prisma: PrismaService) { }

    async listStudents(schoolId: number, query: { gradeId?: number; sectionId?: number; yearId?: number; q?: string }) {
        const yearFilter = query.yearId
            ? { yearId: query.yearId }
            : { year: { isCurrent: true, isDeleted: false } };

        return this.prisma.studentEnrollment.findMany({
            where: {
                isDeleted: false,
                ...yearFilter,
                ...(query.gradeId ? { gradeId: query.gradeId } : {}),
                ...(query.sectionId ? { sectionId: query.sectionId } : {}),
                student: {
                    user: {
                        schoolId,
                        isDeleted: false,
                        ...(query.q ? {
                            OR: [
                                { name: { contains: query.q, mode: 'insensitive' as const } },
                                { code: query.q && !isNaN(+query.q) ? +query.q : undefined },
                            ].filter(Boolean)
                        } : {}),
                    },
                },
            },
            include: {
                student: { include: { user: { select: { uuid: true, name: true, code: true, phone: true, isActive: true } } } },
                grade: { select: { displayName: true } },
                section: { select: { name: true } },
            },
            orderBy: { student: { user: { name: 'asc' } } },
        });
    }

    async createStudent(schoolId: number, dto: CreateStudentDto) {
        // Generate unique code
        const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
        const code = school.nextUserCode;
        await this.prisma.school.update({ where: { id: schoolId }, data: { nextUserCode: code + 1 } });

        const password = dto.password ?? Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 10);

        // Get current year
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
        });

        const result = await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    schoolId, userType: 'STUDENT', code, name: dto.name, gender: dto.gender,
                    phone: dto.phone, province: dto.province, district: dto.district,
                    addressArea: dto.addressArea, passwordHash, isActive: true,
                },
            });

            await tx.student.create({
                data: {
                    userId: user.id,
                    birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
                },
            });

            if (currentYear) {
                await tx.studentEnrollment.create({
                    data: {
                        studentId: user.id, yearId: currentYear.id,
                        gradeId: dto.gradeId, sectionId: dto.sectionId,
                        status: 'ACTIVE', isCurrent: true, joinedAt: new Date(),
                    },
                });
            }

            return { user, code, password };
        });

        return {
            uuid: result.user.uuid,
            name: result.user.name,
            code: result.code,
            password: result.password,
            schoolCode: school.schoolCode,
        };
    }

    async getStudentProfile(userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'STUDENT', isDeleted: false },
            select: {
                uuid: true, name: true, displayName: true, code: true, gender: true,
                phone: true, email: true, province: true, district: true, addressArea: true,
                isActive: true, createdAt: true,
                student: {
                    select: {
                        birthDate: true,
                        enrollments: {
                            where: { isDeleted: false, isCurrent: true },
                            include: {
                                grade: { select: { id: true, displayName: true } },
                                section: { select: { id: true, name: true } },
                                year: { select: { id: true, name: true } },
                            },
                        },
                        parentLinks: {
                            where: { isDeleted: false },
                            include: { parent: { include: { user: { select: { uuid: true, name: true, phone: true } } } } },
                        },
                    },
                },
            },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');
        return user;
    }

    async updateStudent(userUuid: string, dto: UpdateStudentDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'STUDENT', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');

        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.gender !== undefined) data.gender = dto.gender;
        if (dto.phone !== undefined) data.phone = dto.phone;
        if (dto.province !== undefined) data.province = dto.province;
        if (dto.district !== undefined) data.district = dto.district;
        if (dto.addressArea !== undefined) data.addressArea = dto.addressArea;
        await this.prisma.user.update({ where: { id: user.id }, data });

        if (dto.birthDate !== undefined) {
            await this.prisma.student.update({
                where: { userId: user.id },
                data: { birthDate: new Date(dto.birthDate) },
            });
        }

        return this.getStudentProfile(userUuid);
    }

    async transferStudent(userUuid: string, dto: TransferStudentDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'STUDENT', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');

        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: { studentId: user.id, isCurrent: true, isDeleted: false },
        });
        if (!enrollment) throw new NotFoundException('NO_CURRENT_ENROLLMENT');

        await this.prisma.studentEnrollment.update({
            where: { id: enrollment.id },
            data: { gradeId: dto.gradeId, sectionId: dto.sectionId },
        });

        return this.getStudentProfile(userUuid);
    }

    async toggleStudentActive(userUuid: string, isActive: boolean) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'STUDENT', isDeleted: false },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');
        await this.prisma.user.update({ where: { id: user.id }, data: { isActive } });
        return { success: true };
    }

    async resetPassword(userUuid: string, newPassword?: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'STUDENT', isDeleted: false },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');

        const password = newPassword ?? Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
        return { password, code: user.code };
    }
}
