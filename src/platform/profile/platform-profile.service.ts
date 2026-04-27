// src/platform/profile/platform-profile.service.ts
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto, ChangePasswordDto } from './dto/update-profile.dto';
import { PLATFORM_AUTH_ERRORS } from '../auth/constants';

@Injectable()
export class PlatformProfileService {
  constructor(private prisma: PrismaService) {}

  /**
   * جلب الملف الشخصي (PLT-002)
   */
  async getProfile(userUuid: string) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid: userUuid, isDeleted: false },
      select: {
        uuid: true,
        username: true,
        email: true,
        name: true,
        displayName: true,
        phone: true,
        role: true,
        isActive: true,
        assignedSubjects: {
          where: { isDeleted: false },
          select: {
            uuid: true,
            subjectDictionary: {
              select: {
                uuid: true,
                defaultName: true,
                code: true,
                gradeDictionary: {
                  select: {
                    uuid: true,
                    defaultName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(PLATFORM_AUTH_ERRORS.USER_NOT_FOUND);
    }

    return user;
  }

  /**
   * تعديل الملف الشخصي (PLT-002)
   */
  async updateProfile(userUuid: string, dto: UpdateProfileDto) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid: userUuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException(PLATFORM_AUTH_ERRORS.USER_NOT_FOUND);
    }

    return this.prisma.platformUser.update({
      where: { id: user.id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
      },
      select: {
        uuid: true,
        username: true,
        email: true,
        name: true,
        displayName: true,
        phone: true,
        role: true,
        isActive: true,
      },
    });
  }

  /**
   * تغيير كلمة المرور (PLT-002)
   */
  async changePassword(userUuid: string, dto: ChangePasswordDto) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid: userUuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException(PLATFORM_AUTH_ERRORS.USER_NOT_FOUND);
    }

    // التحقق من كلمة المرور الحالية
    const isMatch = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.WRONG_PASSWORD);
    }

    // تشفير كلمة المرور الجديدة
    const newHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return { message: 'تم تحديث كلمة المرور بنجاح' };
  }
}
