// src/platform/users/platform-users.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';

// الحقول التي تُرجع في الاستجابات (بدون passwordHash)
const USER_SELECT = {
  uuid: true,
  username: true,
  email: true,
  name: true,
  displayName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class PlatformUsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * قائمة معلمي المنصة (PLT-010)
   */
  async findAll() {
    return this.prisma.platformUser.findMany({
      where: { isDeleted: false },
      select: {
        ...USER_SELECT,
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
                    code: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * تفاصيل معلم منصة (PLT-013)
   */
  async findOne(uuid: string) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid, isDeleted: false },
      select: {
        ...USER_SELECT,
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
                    code: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    return user;
  }

  /**
   * إضافة معلم منصة (PLT-011)
   */
  async create(dto: CreatePlatformUserDto) {
    // التحقق من عدم تكرار اسم المستخدم
    const existingUsername = await this.prisma.platformUser.findFirst({
      where: { username: dto.username, isDeleted: false },
    });
    if (existingUsername) {
      throw new ConflictException('اسم المستخدم مستخدم بالفعل');
    }

    // التحقق من عدم تكرار البريد
    const existingEmail = await this.prisma.platformUser.findFirst({
      where: { email: dto.email, isDeleted: false },
    });
    if (existingEmail) {
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    }

    // تشفير كلمة المرور
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.platformUser.create({
      data: {
        name: dto.name,
        username: dto.username,
        email: dto.email,
        passwordHash,
        phone: dto.phone || null,
        role: 'PLATFORM_TEACHER',
        isActive: true,
      },
      select: USER_SELECT,
    });

    return user;
  }

  /**
   * تعديل بيانات معلم (PLT-012)
   * ملاحظة: اسم المستخدم ثابت ولا يُعدّل
   */
  async update(uuid: string, dto: UpdatePlatformUserDto) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // التحقق من عدم تكرار البريد عند التعديل
    if (dto.email && dto.email !== user.email) {
      const existingEmail = await this.prisma.platformUser.findFirst({
        where: { email: dto.email, isDeleted: false, NOT: { id: user.id } },
      });
      if (existingEmail) {
        throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
      }
    }

    return this.prisma.platformUser.update({
      where: { id: user.id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.email && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
      },
      select: USER_SELECT,
    });
  }

  /**
   * تعطيل/تفعيل حساب معلم (PLT-014)
   */
  async toggleStatus(uuid: string, isActive: boolean) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    return this.prisma.platformUser.update({
      where: { id: user.id },
      data: { isActive },
      select: USER_SELECT,
    });
  }

  /**
   * إعادة تعيين كلمة المرور (PLT-013 — إجراء من صفحة الملف)
   * تولّد كلمة مرور عشوائية (8 أرقام) تُعرض مرة واحدة
   */
  async resetPassword(uuid: string) {
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // توليد كلمة مرور عشوائية (8 أرقام)
    const newPassword = Math.floor(10000000 + Math.random() * 90000000).toString();
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return {
      uuid: user.uuid,
      name: user.name,
      username: user.username,
      newPassword, // تُعرض مرة واحدة فقط
    };
  }
}
