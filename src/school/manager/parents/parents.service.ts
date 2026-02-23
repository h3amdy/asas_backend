// src/school/manager/parents/parents.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateParentDto, UpdateParentDto, LinkChildrenDto } from './dto/parents.dto';

@Injectable()
export class ParentsService {
    constructor(private readonly prisma: PrismaService) { }

    async listParents(schoolId: number, q?: string) {
        return this.prisma.user.findMany({
            where: {
                schoolId, userType: 'PARENT', isDeleted: false,
                ...(q ? {
                    OR: [
                        { name: { contains: q, mode: 'insensitive' as const } },
                        { phone: { contains: q } },
                    ]
                } : {}),
            },
            select: {
                uuid: true, name: true, phone: true, isActive: true,
                parent: {
                    select: { _count: { select: { childLinks: { where: { isDeleted: false } } } } },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    async createParent(schoolId: number, dto: CreateParentDto) {
        // Check phone uniqueness among parents in this school
        const existing = await this.prisma.user.findFirst({
            where: { schoolId, userType: 'PARENT', phone: dto.phone, isDeleted: false },
        });
        if (existing) {
            return { existing: true, uuid: existing.uuid, name: existing.name, phone: existing.phone };
        }

        const password = dto.password ?? Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 10);

        const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });

        const user = await this.prisma.$transaction(async (tx) => {
            const u = await tx.user.create({
                data: {
                    schoolId, userType: 'PARENT', name: dto.name, phone: dto.phone,
                    email: dto.email, province: dto.province, district: dto.district,
                    addressArea: dto.addressArea, passwordHash, isActive: true,
                },
            });
            await tx.parent.create({ data: { userId: u.id } });
            return u;
        });

        return {
            uuid: user.uuid, name: user.name, phone: user.phone, password,
            schoolCode: school.schoolCode,
        };
    }

    async getParentProfile(userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
            select: {
                uuid: true, name: true, phone: true, email: true,
                province: true, district: true, addressArea: true,
                isActive: true,
                parent: {
                    select: {
                        childLinks: {
                            where: { isDeleted: false },
                            include: {
                                student: {
                                    include: {
                                        user: { select: { uuid: true, name: true, code: true, isActive: true } },
                                        enrollments: {
                                            where: { isDeleted: false, isCurrent: true },
                                            include: {
                                                grade: { select: { displayName: true } },
                                                section: { select: { name: true } },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');
        return user;
    }

    async updateParent(userUuid: string, dto: UpdateParentDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.phone !== undefined) data.phone = dto.phone;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.province !== undefined) data.province = dto.province;
        if (dto.district !== undefined) data.district = dto.district;
        if (dto.addressArea !== undefined) data.addressArea = dto.addressArea;
        await this.prisma.user.update({ where: { id: user.id }, data });
        return this.getParentProfile(userUuid);
    }

    async linkChildren(userUuid: string, dto: LinkChildrenDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        for (const studentId of dto.studentUserIds) {
            await this.prisma.parentStudent.upsert({
                where: { parentId_studentId: { parentId: user.id, studentId } },
                create: { parentId: user.id, studentId },
                update: { isDeleted: false, deletedAt: null },
            });
        }

        return { success: true, linked: dto.studentUserIds.length };
    }

    async unlinkChild(userUuid: string, studentUserId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        await this.prisma.parentStudent.updateMany({
            where: { parentId: user.id, studentId: studentUserId, isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    async resetPassword(userUuid: string, newPassword?: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        const password = newPassword ?? Math.random().toString(36).slice(-8);
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
        return { password, phone: user.phone };
    }
}
