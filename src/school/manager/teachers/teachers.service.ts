// src/school/manager/teachers/teachers.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teachers.dto';

/**
 * 🧑‍🏫 خدمة إدارة المعلمين — SRS-TCH
 *
 * تنفذ العمليات المحددة في SRS-TCH-01→07:
 * - قائمة المعلمين مع البحث والفلترة
 * - إنشاء معلّم جديد (مع توليد الرقم المدرسي)
 * - عرض ملف المعلّم
 * - تعديل البيانات الشخصية والمهنية
 * - إعادة تعيين كلمة المرور
 * - عرض بيانات الدخول
 * - إيقاف/تفعيل الحساب
 */
@Injectable()
export class TeachersService {
    constructor(private readonly prisma: PrismaService) { }

    // ─── SRS-TCH-01: List & Search ──────────────────────────

    async listTeachers(
        schoolId: number,
        search?: string,
        isSupervisor?: boolean,
        isActive?: boolean,
    ) {
        return this.prisma.user.findMany({
            where: {
                schoolId,
                userType: 'TEACHER',
                isDeleted: false,
                ...(isActive !== undefined ? { isActive } : {}),
                ...(search ? {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' as const } },
                        { code: !isNaN(Number(search)) ? Number(search) : undefined },
                    ].filter(Boolean),
                } : {}),
                ...(isSupervisor !== undefined ? {
                    teacher: { isSupervisor },
                } : {}),
            },
            select: {
                uuid: true,
                name: true,
                code: true,
                isActive: true,
                updatedAt: true,
                teacher: {
                    select: {
                        isSupervisor: true,
                        specialization: true,
                    },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    // ─── SRS-TCH-02: Create Teacher ─────────────────────────

    async createTeacher(schoolId: number, dto: CreateTeacherDto) {
        // توليد كلمة المرور إذا لم تُرسل
        const password = dto.password ?? this.generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);

        // ✅ كل شيء داخل Transaction واحدة (بما في ذلك next_user_code)
        const result = await this.prisma.$transaction(async (tx) => {
            // Step 1: توليد الرقم المدرسي (داخل Transaction لتجنب race condition)
            const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });
            const code = school.nextUserCode;
            await tx.school.update({
                where: { id: schoolId },
                data: { nextUserCode: code + 1 },
            });

            // Step 2: إنشاء حساب المستخدم
            const user = await tx.user.create({
                data: {
                    schoolId,
                    userType: 'TEACHER',
                    code,
                    name: dto.name,
                    displayName: dto.name,
                    gender: dto.gender,
                    phone: dto.phone,
                    email: dto.email ?? null,
                    province: dto.province ?? null,
                    district: dto.district ?? null,
                    addressArea: dto.addressArea ?? null,
                    passwordHash,
                    isActive: true,
                },
            });

            // Step 3: إنشاء سجل المعلّم
            await tx.teacher.create({
                data: {
                    userId: user.id,
                    isSupervisor: false,
                    specialization: dto.specialization ?? null,
                    qualification: dto.qualification ?? null,
                    experience: dto.experience ?? null,
                    notes: dto.notes ?? null,
                },
            });

            return { user, code, schoolCode: school.schoolCode };
        });

        // SRS §6.5: استجابة النجاح (مع بيانات الدخول)
        return {
            teacher: {
                uuid: result.user.uuid,
                name: result.user.name,
                code: result.code,
            },
            credentials: {
                schoolCode: result.schoolCode,
                teacherCode: result.code,
                password,
            },
        };
    }

    // ─── SRS-TCH-03: Teacher Profile ────────────────────────

    async getTeacherProfile(uuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'TEACHER', isDeleted: false },
            select: {
                uuid: true,
                name: true,
                displayName: true,
                code: true,
                gender: true,
                phone: true,
                email: true,
                province: true,
                district: true,
                addressArea: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                teacher: {
                    select: {
                        isSupervisor: true,
                        specialization: true,
                        qualification: true,
                        experience: true,
                        notes: true,
                    },
                },
            },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');
        return user;
    }

    // ─── SRS-TCH-04: Update Teacher ─────────────────────────

    async updateTeacher(uuid: string, dto: UpdateTeacherDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'TEACHER', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        await this.prisma.$transaction(async (tx) => {
            // Step 1: تحديث users (البيانات الشخصية)
            const userData: Record<string, any> = {};
            if (dto.name !== undefined) userData.name = dto.name;
            if (dto.gender !== undefined) userData.gender = dto.gender;
            if (dto.phone !== undefined) userData.phone = dto.phone;
            if (dto.email !== undefined) userData.email = dto.email;
            if (dto.province !== undefined) userData.province = dto.province;
            if (dto.district !== undefined) userData.district = dto.district;
            if (dto.addressArea !== undefined) userData.addressArea = dto.addressArea;

            if (Object.keys(userData).length > 0) {
                await tx.user.update({ where: { id: user.id }, data: userData });
            }

            // Step 2: تحديث teachers (البيانات المهنية)
            const teacherData: Record<string, any> = {};
            if (dto.specialization !== undefined) teacherData.specialization = dto.specialization;
            if (dto.qualification !== undefined) teacherData.qualification = dto.qualification;
            if (dto.experience !== undefined) teacherData.experience = dto.experience;
            if (dto.notes !== undefined) teacherData.notes = dto.notes;

            if (Object.keys(teacherData).length > 0) {
                await tx.teacher.update({ where: { userId: user.id }, data: teacherData });
            }
        });

        // إرجاع الملف المحدّث
        return this.getTeacherProfile(uuid);
    }

    // ─── SRS-TCH-05: Reset Password ─────────────────────────

    async resetPassword(uuid: string, newPassword?: string, schoolId?: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'TEACHER', isDeleted: false },
            select: { id: true, code: true, schoolId: true },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        const password = newPassword ?? this.generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
        });

        // جلب كود المدرسة
        const school = await this.prisma.school.findUnique({
            where: { id: user.schoolId! },  // المعلّم دائمًا تابع لمدرسة
            select: { schoolCode: true },
        });

        return {
            credentials: {
                schoolCode: school?.schoolCode,
                teacherCode: user.code,
                password,
            },
        };
    }

    // ─── SRS-TCH-06: Get Credentials ────────────────────────

    async getCredentials(uuid: string, schoolId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'TEACHER', isDeleted: false, schoolId },
            select: { code: true, passwordHash: true },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        const school = await this.prisma.school.findUnique({
            where: { id: schoolId },
            select: { schoolCode: true },
        });

        // ⚠️ كلمة المرور الأصلية غير قابلة للاسترجاع من hash
        // السيرفر يحتاج آلية تخزين النص الصريح — يُحسم في التنفيذ
        // حالياً نرجع null مع ملاحظة للعميل
        return {
            schoolCode: school?.schoolCode,
            teacherCode: user.code,
            password: null as string | null,  // يحتاج تصميم آلية التخزين
        };
    }

    // ─── SRS-TCH-07: Toggle Active (Block/Unblock) ──────────

    async toggleActive(uuid: string, isActive: boolean) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'TEACHER', isDeleted: false },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('TEACHER_NOT_FOUND');

        const updated = await this.prisma.user.update({
            where: { id: user.id },
            data: { isActive },
            select: { uuid: true, isActive: true, updatedAt: true },
        });
        return updated;
    }

    // ─── Helpers ─────────────────────────────────────────────

    /**
     * توليد كلمة مرور عشوائية — 8 أحرف (حروف كبيرة + أرقام، بدون ملتبسة)
     * مشترك مع إدارة الطلاب (نفس المنطق)
     */
    private generatePassword(): string {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 8 }, () =>
            chars.charAt(Math.floor(Math.random() * chars.length)),
        ).join('');
    }
}
