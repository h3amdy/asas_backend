// src/school/manager/teachers/teachers.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTeacherDto, UpdateTeacherDto, SetSupervisorDto, SetExtraPermissionsDto, AddTeacherScopeDto } from './dto/teachers.dto';

@Injectable()
export class TeachersService {
    constructor(private readonly prisma: PrismaService) { }

    async listTeachers(schoolId: number, q?: string) {
        return this.prisma.user.findMany({
            where: {
                schoolId, userType: 'TEACHER', isDeleted: false,
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: 'insensitive' as const } },
                        { phone: { contains: q } },
                    ]
                } : {}),
            },
            select: {
                uuid: true, name: true, code: true, phone: true, isActive: true,
                teacher: {
                    select: { isSupervisor: true, specialization: true },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    async createTeacher(schoolId: number, dto: CreateTeacherDto) {
        const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
        const code = school.nextUserCode;
        await this.prisma.school.update({ where: { id: schoolId }, data: { nextUserCode: code + 1 } });

        const password = dto.password ?? Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 10);

        const user = await this.prisma.$transaction(async (tx) => {
            const u = await tx.user.create({
                data: {
                    schoolId, userType: 'TEACHER', code, name: dto.name, gender: dto.gender,
                    phone: dto.phone, email: dto.email, passwordHash, isActive: true,
                },
            });
            await tx.teacher.create({
                data: {
                    userId: u.id,
                    specialization: dto.specialization,
                    qualification: dto.qualification,
                    hireDate: dto.hireDate ? new Date(dto.hireDate) : null,
                },
            });
            return u;
        });

        return {
            uuid: user.uuid, name: user.name, code,
            password, schoolCode: school.schoolCode,
        };
    }

    async getTeacherProfile(userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
            select: {
                uuid: true, name: true, code: true, gender: true, phone: true, email: true,
                province: true, district: true, addressArea: true, isActive: true, createdAt: true,
                teacher: {
                    select: {
                        hireDate: true, isSupervisor: true, specialization: true, qualification: true,
                        experience: true, notes: true,
                        scopes: {
                            where: { isDeleted: false },
                            include: {
                                grade: { select: { displayName: true } },
                                section: { select: { name: true } },
                            },
                        },
                        extraPermissions: true,
                        subjectSectionTeachers: {
                            where: { isDeleted: false },
                            include: {
                                subjectSection: {
                                    include: {
                                        subject: { select: { displayName: true } },
                                        section: { select: { name: true, grade: { select: { displayName: true } } } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');
        return user;
    }

    async updateTeacher(userUuid: string, dto: UpdateTeacherDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        const userData: Record<string, any> = {};
        if (dto.name !== undefined) userData.name = dto.name;
        if (dto.gender !== undefined) userData.gender = dto.gender;
        if (dto.phone !== undefined) userData.phone = dto.phone;
        if (dto.email !== undefined) userData.email = dto.email;
        if (Object.keys(userData).length > 0) {
            await this.prisma.user.update({ where: { id: user.id }, data: userData });
        }

        const teacherData: Record<string, any> = {};
        if (dto.specialization !== undefined) teacherData.specialization = dto.specialization;
        if (dto.qualification !== undefined) teacherData.qualification = dto.qualification;
        if (dto.experience !== undefined) teacherData.experience = dto.experience;
        if (dto.notes !== undefined) teacherData.notes = dto.notes;
        if (Object.keys(teacherData).length > 0) {
            await this.prisma.teacher.update({ where: { userId: user.id }, data: teacherData });
        }

        return this.getTeacherProfile(userUuid);
    }

    async setSupervisor(userUuid: string, dto: SetSupervisorDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');
        await this.prisma.teacher.update({ where: { userId: user.id }, data: { isSupervisor: dto.isSupervisor } });
        return { success: true };
    }

    async setExtraPermissions(userUuid: string, dto: SetExtraPermissionsDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        await this.prisma.teacherExtraPermission.upsert({
            where: { teacherId: user.id },
            create: { teacherId: user.id, ...dto },
            update: dto,
        });
        return { success: true };
    }

    async addScope(userUuid: string, dto: AddTeacherScopeDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        const scope = await this.prisma.teacherScope.create({
            data: { teacherId: user.id, gradeId: dto.gradeId, sectionId: dto.sectionId ?? null },
        });
        return scope;
    }

    async removeScope(scopeId: number) {
        await this.prisma.teacherScope.update({
            where: { id: scopeId },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    async toggleActive(userUuid: string, isActive: boolean) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');
        await this.prisma.user.update({ where: { id: user.id }, data: { isActive } });
        return { success: true };
    }

    async resetPassword(userUuid: string, newPassword?: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'TEACHER', isDeleted: false },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        const password = newPassword ?? Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
        return { password, code: user.code };
    }
}
