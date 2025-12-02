// src/grades/grades.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, GradeDictionary } from '@prisma/client';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { GradeSyncItemDto } from './dto/grade-sync.dto'; // 👈 استيراد جديد

@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.gradeDictionary.findMany({
      orderBy: {
        sortOrder: 'asc',
      },
    });
  }

  async findByUuid(uuid: string) {
    const grade = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
    });

    if (!grade) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }

    return grade;
  }

  async create(dto: CreateGradeDto) {
    const data: Prisma.GradeDictionaryCreateInput = {
      code: dto.code,
      defaultName: dto.defaultName,
      shortName: dto.shortName ?? null,
      stage: dto.stage ?? null,
      sortOrder: dto.sortOrder ?? 0,
      // isActive, createdAt, updatedAt لها قيم افتراضية
    };

    return this.prisma.gradeDictionary.create({ data });
  }

  async update(uuid: string, dto: UpdateGradeDto) {
    await this.ensureExists(uuid);

    const data: Prisma.GradeDictionaryUpdateInput = {
      code: dto.code,
      defaultName: dto.defaultName,
      shortName: dto.shortName ?? null,
      stage: dto.stage ?? null,
      sortOrder: dto.sortOrder ?? 0,
    };

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data,
    });
  }

  async updateStatus(uuid: string, isActive: boolean) {
    await this.ensureExists(uuid);

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data: { isActive },
    });
  }

  private async ensureExists(uuid: string) {
    const exists = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }
  }

  // ============================
  // 🔄 دوال المزامنة (Sync)
  // ============================

  /**
   * Pull: جلب التغييرات منذ وقت معيّن
   */
  async pullSync(since?: Date) {
    const where: Prisma.GradeDictionaryWhereInput = since
      ? {
          updatedAt: {
            gt: since,
          },
        }
      : {};

    const items = await this.prisma.gradeDictionary.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });

    return {
      serverTime: new Date().toISOString(),
      items,
    };
  }

  /**
   * Push: استقبال تغييرات من الجهاز (Last-write-wins بسيط)
   */
  async pushSync(changes: GradeSyncItemDto[]) {
    let updatedCount = 0;

    for (const item of changes) {
      // 👈 هنا نصرّح بالنوع صراحةً
      let existing: GradeDictionary | null = null;

      // نحاول إيجاد الصف إما بالـ uuid
      if (item.uuid) {
        existing = await this.prisma.gradeDictionary.findUnique({
          where: { uuid: item.uuid },
        });
      }

      // أو بالـ code كاحتياط
      if (!existing) {
        // ملاحظة: findUnique لا ترمي استثناء إذا لم تجد شيء، ترجع null فقط
        existing = await this.prisma.gradeDictionary.findUnique({
          where: { code: item.code },
        });
      }

      // حالياً لا ندعم DELETE حقيقي هنا، نركز على UPSERT
      if (item.action === 'DELETE') {
        // مستقبلاً ممكن تخلي عندك حقل isDeleted أو تعمل delete حقيقي
        continue;
      }

      if (!existing) {
        // ✅ إنشاء جديد
        await this.prisma.gradeDictionary.create({
          data: {
            code: item.code,
            defaultName: item.defaultName,
            shortName: item.shortName ?? null,
            stage: item.stage ?? null,
            sortOrder: item.sortOrder ?? 0,
            isActive: item.isActive ?? true,
          },
        });
        updatedCount++;
      } else {
        // ✅ تحديث موجود
        await this.prisma.gradeDictionary.update({
          where: { id: existing.id },
          data: {
            code: item.code,
            defaultName: item.defaultName,
            shortName: item.shortName ?? null,
            stage: item.stage ?? null,
            sortOrder: item.sortOrder ?? existing.sortOrder,
            isActive:
              typeof item.isActive === 'boolean'
                ? item.isActive
                : existing.isActive,
          },
        });
        updatedCount++;
      }
    }

    return {
      success: true,
      updatedCount,
    };
  }
}