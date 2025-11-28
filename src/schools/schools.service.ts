// src/schools/schools.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AppType } from '@prisma/client';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';

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
}
