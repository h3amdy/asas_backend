// src/school/manager/parents/parents.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateParentDto, UpdateParentDto, LinkChildrenDto } from './dto/parents.dto';

/**
 * 👨‍👩‍👧 خدمة إدارة أولياء الأمور — SRS-PAR
 *
 * تنفذ العمليات المحددة في SRS-PAR-01→08:
 * - قائمة أولياء الأمور مع البحث
 * - إنشاء ولي أمر (مع فحص تكرار الهاتف)
 * - عرض ملف ولي الأمر (مع الأبناء)
 * - تعديل البيانات الشخصية
 * - إعادة تعيين كلمة المرور
 * - عرض بيانات الدخول
 * - إيقاف/تفعيل الحساب
 * - ربط/فك ارتباط أبناء
 */
@Injectable()
export class ParentsService {
    constructor(private readonly prisma: PrismaService) { }

    // ─── SRS-PAR-01: List & Search ──────────────────────────

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
                uuid: true, name: true, phone: true, isActive: true, updatedAt: true,
                parent: {
                    select: { _count: { select: { childLinks: { where: { isDeleted: false } } } } },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    // ─── SRS-PAR-02: Create Parent ──────────────────────────

    async createParent(schoolId: number, dto: CreateParentDto) {
        // BR-02: فحص تكرار الهاتف
        const existing = await this.prisma.user.findFirst({
            where: { schoolId, userType: 'PARENT', phone: dto.phone, isDeleted: false },
        });
        if (existing) {
            return { existing: true, uuid: existing.uuid, name: existing.name, phone: existing.phone };
        }

        const password = dto.password ?? this.generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);

        const result = await this.prisma.$transaction(async (tx) => {
            const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });

            const user = await tx.user.create({
                data: {
                    schoolId, userType: 'PARENT',
                    name: dto.name,
                    gender: dto.gender,        // ← SRS-PAR: gender إلزامي
                    phone: dto.phone,
                    email: dto.email ?? null,
                    province: dto.province ?? null,
                    district: dto.district ?? null,
                    addressArea: dto.addressArea ?? null,
                    passwordHash,
                    isActive: true,
                },
            });
            await tx.parent.create({ data: { userId: user.id } });

            return { user, schoolCode: school.schoolCode };
        });

        return {
            uuid: result.user.uuid,
            name: result.user.name,
            phone: result.user.phone,
            password,
            schoolCode: result.schoolCode,
        };
    }

    // ─── SRS-PAR-03: Parent Profile ─────────────────────────

    async getParentProfile(userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
            select: {
                uuid: true, name: true, phone: true, email: true,
                gender: true,
                province: true, district: true, addressArea: true,
                isActive: true, createdAt: true, updatedAt: true,
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

    // ─── SRS-PAR-04: Update Parent ──────────────────────────

    async updateParent(userUuid: string, dto: UpdateParentDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
            select: { id: true, schoolId: true },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        // BR-01: فحص تكرار الهاتف عند التعديل
        if (dto.phone !== undefined) {
            const duplicatePhone = await this.prisma.user.findFirst({
                where: {
                    schoolId: user.schoolId!,
                    userType: 'PARENT',
                    phone: dto.phone,
                    isDeleted: false,
                    id: { not: user.id },  // استبعاد نفس المستخدم
                },
            });
            if (duplicatePhone) {
                throw new BadRequestException('PHONE_ALREADY_EXISTS');
            }
        }

        const data: Record<string, any> = {};
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.phone !== undefined) data.phone = dto.phone;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.province !== undefined) data.province = dto.province;
        if (dto.district !== undefined) data.district = dto.district;
        if (dto.addressArea !== undefined) data.addressArea = dto.addressArea;

        if (Object.keys(data).length > 0) {
            await this.prisma.user.update({ where: { id: user.id }, data });
        }

        // إرجاع الملف المحدّث
        return this.getParentProfile(userUuid);
    }

    // ─── SRS-PAR-05: Toggle Active (Block/Unblock) ──────────

    async toggleActive(uuid: string, isActive: boolean) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'PARENT', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        const updated = await this.prisma.user.update({
            where: { id: user.id },
            data: { isActive },
            select: { uuid: true, isActive: true, updatedAt: true },
        });
        return updated;
    }

    // ─── SRS-PAR-06: Reset Password ─────────────────────────

    async resetPassword(userUuid: string, newPassword?: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
            select: { id: true, phone: true, schoolId: true },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        const password = newPassword ?? this.generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

        // جلب كود المدرسة لبيانات الدخول
        const school = await this.prisma.school.findUnique({
            where: { id: user.schoolId! },
            select: { schoolCode: true },
        });

        return { password, phone: user.phone, schoolCode: school?.schoolCode };
    }

    // ─── SRS-PAR-07: Get Credentials ────────────────────────

    async getCredentials(uuid: string, schoolId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'PARENT', isDeleted: false, schoolId },
            select: { phone: true },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        const school = await this.prisma.school.findUnique({
            where: { id: schoolId },
            select: { schoolCode: true },
        });

        // ⚠️ كلمة المرور الأصلية غير قابلة للاسترجاع من hash
        // السيرفر يحتاج آلية تخزين النص الصريح — يُحسم في التنفيذ
        // حالياً نرجع null مع ملاحظة للعميل
        return {
            schoolCode: school?.schoolCode,
            phone: user.phone,
            password: null as string | null,  // يحتاج تصميم آلية التخزين
        };
    }

    // ─── SRS-PAR-08: Link Children ──────────────────────────

    async linkChildren(userUuid: string, dto: LinkChildrenDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
            select: { id: true },
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

    // ─── SRS-PAR-08: Unlink Child ───────────────────────────

    async unlinkChild(userUuid: string, studentUserId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, userType: 'PARENT', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('PARENT_NOT_FOUND');

        await this.prisma.parentStudent.updateMany({
            where: { parentId: user.id, studentId: studentUserId, isDeleted: false },
            data: { isDeleted: true, deletedAt: new Date() },
        });
        return { success: true };
    }

    // ─── Helpers ─────────────────────────────────────────────

    /**
     * توليد كلمة مرور عشوائية — 8 أحرف (حروف كبيرة + أرقام، بدون ملتبسة)
     * مشترك مع إدارة المعلمين والطلاب (نفس المنطق)
     */
    private generatePassword(): string {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 8 }, () =>
            chars.charAt(Math.floor(Math.random() * chars.length)),
        ).join('');
    }
}
