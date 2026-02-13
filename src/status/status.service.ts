// src/status/status.service.ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * نوع الـ Payload من JWT (نفس SafeUserPayload في school-auth.service)
 */
type SchoolJwtPayload = {
    sub: string; // user uuid
    sc: string; // school uuid
    ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
    sid: string; // session uuid
    uc?: number; // user code
};

/**
 * ⚙️ خدمة الحالة (Boot Gate + Account Gate)
 * توفر معلومات خفيفة للتطبيقات عند البدء وبعد تسجيل الدخول
 */
@Injectable()
export class StatusService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * 🚀 Boot Gate (Public):
     * - موجودة/غير موجودة
     * - مفعّلة/موقوفة
     * - نوع التطبيق PUBLIC/PRIVATE
     */
    async getSchoolStatus(uuid: string) {
        const school = await this.prisma.school.findFirst({
            where: { uuid, isDeleted: false },
            select: {
                uuid: true,
                isActive: true,
                appType: true,
                displayName: true,
            },
        });

        if (!school) {
            throw new NotFoundException('School not found');
        }

        return {
            school_uuid: school.uuid,
            is_active: school.isActive,
            app_type: school.appType, // PUBLIC / PRIVATE
            display_name: school.displayName ?? null,
            reason: school.isActive ? null : 'SCHOOL_DISABLED',
        };
    }

    /**
     * 🔐 Account Gate (بعد تسجيل الدخول):
     * - هل حسابي مفعّل؟
     * - هل مدرستي (في الجلسة) مفعّلة؟
     */
    async getMyStatus(jwtPayload: SchoolJwtPayload) {
        const userUuid = jwtPayload?.sub;
        if (!userUuid) {
            throw new ForbiddenException('INVALID_SESSION');
        }

        const user = await this.prisma.user.findFirst({
            where: {
                uuid: userUuid,
                isDeleted: false,
            },
            select: {
                uuid: true,
                isActive: true,
                schoolId: true,
                userType: true,
                displayName: true,
                name: true,
            },
        });

        if (!user) {
            throw new NotFoundException('USER_NOT_FOUND');
        }

        // OWNER ما يدخل هنا عادة، لكن لو حصل (مستخدم بدون مدرسة):
        if (!user.schoolId) {
            return {
                user_uuid: user.uuid,
                user_type: user.userType,
                user_display_name: user.displayName ?? user.name,
                user_is_active: user.isActive,
                school_uuid: null,
                school_is_active: null,
                reason: user.isActive ? null : 'USER_DISABLED',
            };
        }

        const school = await this.prisma.school.findFirst({
            where: {
                uuid: jwtPayload.sc,
                isDeleted: false,
            },
            select: {
                id: true,
                uuid: true,
                isActive: true,
                displayName: true,
                name: true,
            },
        });

        if (!school) {
            throw new NotFoundException('SCHOOL_NOT_FOUND');
        }

        // ✅ تحقق أن المستخدم فعلاً ينتمي لهذه المدرسة
        if (user.schoolId !== school.id) {
            throw new ForbiddenException('INVALID_SESSION');
        }

        // ترتيب الأسباب: المدرسة أولاً ثم المستخدم
        let reason: string | null = null;
        if (!school.isActive) reason = 'SCHOOL_DISABLED';
        else if (!user.isActive) reason = 'USER_DISABLED';

        return {
            user_uuid: user.uuid,
            user_type: user.userType,
            user_display_name: user.displayName ?? user.name,
            user_is_active: user.isActive,
            school_uuid: school.uuid,
            school_display_name: school.displayName ?? school.name,
            school_is_active: school.isActive,
            reason,
        };
    }
}
