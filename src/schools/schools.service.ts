// src/schools/schools.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AppType, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { CreateSchoolManagerDto } from './dto/create-school-manager.dto';

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) { }

  // ✅ (1) تم التعديل: حساب الإحصائيات للمدارس غير المحذوفة فقط
  async getStats() {
    const [total, active, inactive] = await Promise.all([
      this.prisma.school.count({
        where: { isDeleted: false }, // كان يحسب المحذوف أيضاً سابقاً
      }),
      this.prisma.school.count({
        where: { isActive: true, isDeleted: false },
      }),
      this.prisma.school.count({
        where: { isActive: false, isDeleted: false },
      }),
    ]);

    return {
      totalSchools: total,
      activeSchools: active,
      inactiveSchools: inactive,
    };
  }

  async findAll() {
    return this.prisma.school.findMany({
      where: { isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUuid(uuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
    });

    if (!school || school.isDeleted) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    return school;
  }

  private async generateNextSchoolCode(): Promise<number> {
    const last = await this.prisma.school.findFirst({
      orderBy: { schoolCode: 'desc' },
      select: { schoolCode: true },
    });

    const base = last?.schoolCode ?? 1000;
    return base + 1;
  }

  async create(dto: CreateSchoolDto) {
    const nextCode = await this.generateNextSchoolCode();

    const data: Prisma.SchoolCreateInput = {
      name: dto.name,
      displayName: dto.name, // ✅ displayName يأخذ نفس قيمة name عند الإنشاء
      appType: dto.appType as AppType,
      schoolCode: nextCode,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      province: dto.province ?? null,
      educationType: dto.educationType ?? null,
      ownerNotes: dto.ownerNotes ?? null,
      primaryColor: dto.primaryColor ?? null,
      secondaryColor: dto.secondaryColor ?? null,
      backgroundColor: dto.backgroundColor ?? null,
    };

    const school = await this.prisma.school.create({ data });
    return school;
  }

  async update(uuid: string, dto: UpdateSchoolDto) {
    await this.ensureExists(uuid);

    const data: Prisma.SchoolUpdateInput = {
      name: dto.name,
      appType: dto.appType as AppType,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
      province: dto.province,
      educationType: dto.educationType,
      ownerNotes: dto.ownerNotes,
      primaryColor: dto.primaryColor,
      secondaryColor: dto.secondaryColor,
      backgroundColor: dto.backgroundColor,
    };

    return this.prisma.school.update({
      where: { uuid },
      data,
    });
  }

  async updateStatus(uuid: string, isActive: boolean) {
    await this.ensureExists(uuid);

    return this.prisma.school.update({
      where: { uuid },
      data: { isActive },
    });
  }

  private async ensureExists(uuid: string) {
    const exists = await this.prisma.school.findUnique({
      where: { uuid },
      select: { id: true, isDeleted: true },
    });

    if (!exists || exists.isDeleted) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }
  }

  async delete(uuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
    });

    if (!school || school.isDeleted) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    const now = new Date();

    await this.prisma.school.update({
      where: { uuid },
      data: {
        isDeleted: true,
        isActive: false,
        deletedAt: now,
        users: {
          updateMany: {
            where: {
              schoolId: school.id,
              isDeleted: false,
            },
            data: {
              isActive: false,
              isDeleted: true,
              deletedAt: now,
            },
          },
        },
      },
    });

    return { success: true };
  }

  private async getNextUserCodeForSchool(schoolId: number): Promise<number> {
    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        nextUserCode: { increment: 1 },
      },
      select: { nextUserCode: true },
    });

    return updated.nextUserCode;
  }

  async createOrUpdateManagerForSchool(
    uuid: string,
    dto: CreateSchoolManagerDto,
  ) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
    });

    if (!school || school.isDeleted) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    let manager = await this.prisma.user.findFirst({
      where: {
        schoolId: school.id,
        userType: UserType.ADMIN,
        isDeleted: false,
      },
    });

    if (!manager) {
      if (!dto.password || dto.password.trim().length < 6) {
        throw new BadRequestException(
          'كلمة المرور مطلوبة عند إنشاء مدير جديد وبطول لا يقل عن 6 أحرف',
        );
      }

      const passwordHash = await bcrypt.hash(dto.password, 10);
      const code = await this.getNextUserCodeForSchool(school.id);

      manager = await this.prisma.user.create({
        data: {
          schoolId: school.id,
          userType: UserType.ADMIN,
          code,
          name: dto.name,
          phone: dto.phone,
          email: null,
          passwordHash,
          isActive: true,
        },
      });
    } else {
      const updateData: Prisma.UserUpdateInput = {
        name: dto.name,
        phone: dto.phone,
      };

      if (dto.password && dto.password.trim().length >= 6) {
        updateData.passwordHash = await bcrypt.hash(dto.password, 10);
      }

      manager = await this.prisma.user.update({
        where: { id: manager.id },
        data: updateData,
      });
    }

    return {
      schoolName: school.name,
      schoolCode: school.schoolCode,
      appType: school.appType,
      managerCode: manager.code,
      managerName: manager.name,
    };
  }

  private generateRandomPassword(length = 8): string {
    const chars = '23456789';
    let result = '';
    const bytes = randomBytes(length);
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  async resetManagerPasswordForSchool(uuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
    });

    if (!school || school.isDeleted) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    const manager = await this.prisma.user.findFirst({
      where: {
        schoolId: school.id,
        userType: UserType.ADMIN,
        isDeleted: false,
      },
    });

    if (!manager) {
      throw new NotFoundException('لا يوجد مدير معين لهذه المدرسة');
    }

    const newPassword = this.generateRandomPassword(8);
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const updated = await this.prisma.user.update({
      where: { id: manager.id },
      data: {
        passwordHash,
      },
    });

    return {
      schoolName: school.name,
      schoolCode: school.schoolCode,
      appType: school.appType,
      managerCode: updated.code,
      managerName: updated.name,
      newPassword,
    };
  }

  // ✅ (2) & (3) تم التعديل: التحقق من حذف المدرسة ومن حذف المدير
  async getManagerForSchool(uuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
      select: {
        id: true,
        name: true,
        schoolCode: true,
        appType: true,
        isDeleted: true, // جلب حالة الحذف
      },
    });

    if (!school || school.isDeleted) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    const manager = await this.prisma.user.findFirst({
      where: {
        schoolId: school.id,
        userType: UserType.ADMIN,
        isDeleted: false, // التأكد أن المدير غير محذوف
      },
      select: {
        name: true,
        phone: true,
        code: true,
        isActive: true,
      },
    });

    if (!manager) {
      return {
        hasManager: false,
        schoolName: school.name,
        schoolCode: school.schoolCode,
        appType: school.appType,
      };
    }

    return {
      hasManager: true,
      schoolName: school.name,
      schoolCode: school.schoolCode,
      appType: school.appType,
      manager: {
        name: manager.name,
        phone: manager.phone,
        code: manager.code,
        isActive: manager.isActive,
      },
    };
  }
}