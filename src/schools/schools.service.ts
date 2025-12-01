// src/schools/schools.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AppType, UserType } from '@prisma/client'; // ✅ أضف UserType
import * as bcrypt from 'bcrypt';                             // ✅ أضف bcrypt
import { randomBytes } from 'crypto';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { CreateSchoolManagerDto } from './dto/create-school-manager.dto'; 

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) {}
// ✅ دالة الإحصائيات (يستخدمها المالك في الـ Dashboard)
async getStats() {
  const [total, active, inactive] = await Promise.all([
    this.prisma.school.count(),
    this.prisma.school.count({ where: { isActive: true } }),
    this.prisma.school.count({ where: { isActive: false } }),
  ]);

  return {
    totalSchools: total,
    activeSchools: active,
    inactiveSchools: inactive,
  };
}
  // قائمة المدارس (للوحة المالك)
  async findAll() {
    return this.prisma.school.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // مدرسة واحدة بالـ uuid
  async findByUuid(uuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
    });

    if (!school) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    return school;
  }

  // توليد كود مدرسة جديد (schoolCode)
  private async generateNextSchoolCode(): Promise<number> {
    const last = await this.prisma.school.findFirst({
      orderBy: { schoolCode: 'desc' },
      select: { schoolCode: true },
    });

    const base = last?.schoolCode ?? 1000;
    return base + 1;
  }

  // إنشاء مدرسة جديدة
  async create(dto: CreateSchoolDto) {
    const nextCode = await this.generateNextSchoolCode();

    const data: Prisma.SchoolCreateInput = {
      name: dto.name,
      appType: dto.appType as AppType, // "PUBLIC" أو "PRIVATE"
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
      // isActive و createdAt لهم قيم افتراضية من Prisma
    };

    const school = await this.prisma.school.create({ data });
    return school;
  }

  // تحديث بيانات مدرسة
  async update(uuid: string, dto: UpdateSchoolDto) {
    // نتأكد أنها موجودة
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

  // تفعيل/إيقاف مدرسة
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
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }
  }
  // حذف مدرسة
async delete(uuid: string) {
  await this.ensureExists(uuid);

  await this.prisma.school.delete({
    where: { uuid },
  });

  return { success: true };
}
/**
   * توليد كود مستخدم جديد داخل مدرسة معينة
   * prefixDigit:
   *  1 للطلاب
   *  2 للموظفين (مدير، معلم، مشرف)
   */
// داخل class SchoolsService

private async getNextUserCodeForSchool(schoolId: number): Promise<number> {
  const updated = await this.prisma.school.update({
    where: { id: schoolId },
    data: {
      nextUserCode: { increment: 1 },
    },
    select: { nextUserCode: true },
  });

  // بما أن default = 1
  // أول استدعاء يرجّع 1، ثم 2، ثم 3...
  return updated.nextUserCode;
}
// إنشاء أو تحديث مدير مدرسة
async createOrUpdateManagerForSchool(
  uuid: string,
  dto: CreateSchoolManagerDto,
) {
  const school = await this.prisma.school.findUnique({
    where: { uuid },
  });

  if (!school) {
    throw new NotFoundException('لم يتم العثور على المدرسة');
  }

  let manager = await this.prisma.user.findFirst({
    where: {
      schoolId: school.id,
      userType: UserType.ADMIN,
    },
  });

  const passwordHash = await bcrypt.hash(dto.password, 10);

  if (manager) {
    // تحديث مدير موجود
    manager = await this.prisma.user.update({
      where: { id: manager.id },
      data: {
        name: dto.name,
        phone: dto.phone,
        passwordHash,
      },
    });
  } else {
    // إنشاء مدير جديد مع كود متسلسل عام داخل المدرسة
    const code = await this.getNextUserCodeForSchool(school.id);

    manager = await this.prisma.user.create({
      data: {
        schoolId: school.id,
        userType: UserType.ADMIN,
        code, // 1، 2، 3… داخل المدرسة
        name: dto.name,
        phone: dto.phone,
        email: null,
        passwordHash,
        isActive: true,
      },
    });
  }

  return {
    schoolName: school.name,
    schoolCode: school.schoolCode,
    appType: school.appType, // PUBLIC / PRIVATE
    managerCode: manager.code,
    managerName: manager.name,
  };
}

private generateRandomPassword(length = 8): string {
  // توليد باسورد بسيط من أرقام وحروف (ممكن تخليه أرقام فقط لو تحب)
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

  if (!school) {
    throw new NotFoundException('لم يتم العثور على المدرسة');
  }

  const manager = await this.prisma.user.findFirst({
    where: {
      schoolId: school.id,
      userType: UserType.ADMIN,
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
    newPassword, // 👈 نرجّعها مرة واحدة للمالك
  };
}

  // ✅ جديد: جلب مدير مدرسة بشكل مستقل
  async getManagerForSchool(uuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid },
      select: {
        id: true,
        name: true,
        schoolCode: true,
        appType: true,
      },
    });

    if (!school) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    const manager = await this.prisma.user.findFirst({
      where: {
        schoolId: school.id,
        userType: UserType.ADMIN,
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

