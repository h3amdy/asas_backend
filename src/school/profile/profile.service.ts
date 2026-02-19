// src/school/profile/profile.service.ts
import {
    BadRequestException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SCHOOL_AUTH_ERRORS } from '../auth/constants';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeMyPasswordDto } from './dto/change-password.dto';

/** الحقول الآمنة للإرجاع (بدون passwordHash) */
const SAFE_USER_SELECT = {
    uuid: true,
    userType: true,
    code: true,
    name: true,
    displayName: true,
    gender: true,
    phone: true,
    email: true,
    province: true,
    district: true,
    addressArea: true,
    addressDetails: true,
    updatedAt: true,
} as const;

@Injectable()
export class ProfileService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * جلب الملف الشخصي
     */
    async getMe(userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, isDeleted: false },
            select: SAFE_USER_SELECT,
        });

        if (!user) throw new NotFoundException(SCHOOL_AUTH_ERRORS.USER_NOT_FOUND);

        return {
            uuid: user.uuid,
            userType: user.userType,
            code: user.code ?? null,
            name: user.name,
            displayName: user.displayName ?? user.name,
            gender: user.gender ?? null,
            phone: user.phone ?? null,
            email: user.email ?? null,
            province: user.province ?? null,
            district: user.district ?? null,
            addressArea: user.addressArea ?? null,
            addressDetails: user.addressDetails ?? null,
            updatedAt: user.updatedAt,
        };
    }

    /**
     * تعديل الملف الشخصي (الحقول المسموحة فقط)
     */
    async updateMe(userUuid: string, dto: UpdateProfileDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, isDeleted: false },
            select: { id: true },
        });

        if (!user) throw new NotFoundException(SCHOOL_AUTH_ERRORS.USER_NOT_FOUND);

        // بناء كائن التحديث فقط من الحقول المُرسلة
        const data: Record<string, any> = {};
        if (dto.displayName !== undefined) data.displayName = dto.displayName;
        if (dto.gender !== undefined) data.gender = dto.gender;
        if (dto.email !== undefined) data.email = dto.email;
        if (dto.province !== undefined) data.province = dto.province;
        if (dto.district !== undefined) data.district = dto.district;
        if (dto.addressArea !== undefined) data.addressArea = dto.addressArea;
        if (dto.addressDetails !== undefined) data.addressDetails = dto.addressDetails;

        await this.prisma.user.update({
            where: { id: user.id },
            data,
        });

        // إرجاع البيانات المحدّثة
        return this.getMe(userUuid);
    }

    /**
     * تغيير كلمة المرور بدون تسجيل خروج
     * لا يتم إلغاء الجلسات أو الـ refresh tokens
     */
    async changePassword(userUuid: string, dto: ChangeMyPasswordDto) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, isDeleted: false },
            select: { id: true, passwordHash: true },
        });

        if (!user) throw new NotFoundException(SCHOOL_AUTH_ERRORS.USER_NOT_FOUND);

        // التحقق من كلمة المرور القديمة
        const isMatch = await bcrypt.compare(dto.oldPassword, user.passwordHash);
        if (!isMatch) {
            throw new UnauthorizedException(SCHOOL_AUTH_ERRORS.OLD_PASSWORD_WRONG);
        }

        // التحقق من أن الجديدة مختلفة عن القديمة
        if (dto.oldPassword === dto.newPassword) {
            throw new BadRequestException(SCHOOL_AUTH_ERRORS.NEW_PASSWORD_SAME_AS_OLD);
        }

        // تحديث كلمة المرور
        const newHash = await bcrypt.hash(dto.newPassword, 10);
        await this.prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash },
        });

        return { success: true };
    }
}
