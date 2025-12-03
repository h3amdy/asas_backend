// src/schools/schools-sync.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, School, UserType } from '@prisma/client';
import {
  SchoolSyncItemDto,
  SchoolsSyncPushDto,
} from './dto/school-sync.dto';

const SCHOOL_RETENTION_DAYS = 90;

@Injectable()
export class SchoolsSyncService {
  constructor(private prisma: PrismaService) {}

  // ============================
  // PULL
  // ============================
  async pullSync(params: { since?: string; full?: boolean }) {
    const serverTime = new Date();
    const { since, full } = params;

    let where: Prisma.SchoolWhereInput = {};

    if (full) {
      where = {};
    } else if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        throw new BadRequestException('قيمة since غير صالحة');
      }

      const diffDays =
        (serverTime.getTime() - sinceDate.getTime()) /
        (1000 * 60 * 60 * 24);

      if (diffDays > SCHOOL_RETENTION_DAYS) {
        // قديمة جداً → خلي التطبيق يعمل Full Sync
        where = {};
      } else {
        // Incremental
        where = {
          updatedAt: { gt: sinceDate },
        };
      }
    } else {
      // أول مرة → Full
      where = {};
    }

    const items = await this.prisma.school.findMany({
      where,
      orderBy: { updatedAt: 'asc' }, // أفضل من createdAt لمزامنة التغييرات
      include: {
        users: {
          where: {
            userType: UserType.ADMIN,
            isDeleted: false,
          },
          select: {
            name: true,
            phone: true,
            code: true,
            isActive: true,
          },
          take: 1,
        },
      },
    });

    const mapped = items.map((s) => ({
      ...s,
      manager:
        s.users && s.users.length > 0
          ? {
              name: s.users[0].name,
              phone: s.users[0].phone,
              code: s.users[0].code,
              isActive: s.users[0].isActive,
            }
          : null,
    }));

    return {
      serverTime: serverTime.toISOString(),
      items: mapped,
    };
  }

  // ============================
  // PUSH
  // ============================
  async pushSync(body: SchoolsSyncPushDto) {
    if (!body.changes || body.changes.length === 0) {
      throw new BadRequestException('changes must be a non-empty array');
    }

    for (const change of body.changes) {
      await this.applyChange(change);
    }

    const serverTime = new Date().toISOString();
    return { serverTime };
  }

  private async applyChange(change: SchoolSyncItemDto) {
    if (!change.uuid) {
      throw new BadRequestException('كل سجل يحتاج uuid');
    }

    const existing: School | null = await this.prisma.school.findUnique({
      where: { uuid: change.uuid },
    });

    const action = change.action ?? 'UPSERT';

    // DELETE (Soft Delete)
    if (action === 'DELETE') {
      if (!existing || existing.isDeleted) return;

      const now = new Date();

      await this.prisma.school.update({
        where: { uuid: change.uuid },
        data: {
          isDeleted: true,
          isActive: false,
          deletedAt: now,
          users: {
            updateMany: {
              where: {
                schoolId: existing.id,
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

      return;
    }

    // UPSERT (تعديل فقط للمدارس الموجودة — لا نسمح بإنشاء Offline)
    if (action === 'UPSERT') {
      if (!existing) {
        throw new BadRequestException(
          'إنشاء المدارس الجديدة يجب أن يتم أونلاين عبر /schools',
        );
      }

      await this.prisma.school.update({
        where: { uuid: change.uuid },
        data: {
          name: change.name ?? existing.name,
          phone: change.phone ?? existing.phone,
          email: change.email ?? existing.email,
          address: change.address ?? existing.address,
          province: change.province ?? existing.province,
          educationType: change.educationType ?? existing.educationType,
          ownerNotes: change.ownerNotes ?? existing.ownerNotes,
          primaryColor: change.primaryColor ?? existing.primaryColor,
          secondaryColor: change.secondaryColor ?? existing.secondaryColor,
          backgroundColor:
            change.backgroundColor ?? existing.backgroundColor,
          isActive:
            typeof change.isActive === 'boolean'
              ? change.isActive
              : existing.isActive,
          isDeleted: false,
          deletedAt: null,
        },
      });

      return;
    }

    throw new BadRequestException(`Unknown action: ${action}`);
  }

  // حذف نهائي قديم (اختياري عبر Cron)
  async hardDeleteOldSchools() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SCHOOL_RETENTION_DAYS);

    const result = await this.prisma.school.deleteMany({
      where: {
        isDeleted: true,
        deletedAt: { lt: cutoff },
      },
    });

    return { deletedCount: result.count };
  }
}