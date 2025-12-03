import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GradeDictionary, Prisma } from '@prisma/client';
import {
  GradeSyncItemDto,
  GradesSyncPushDto,
} from './dto/grade-sync.dto';

const GRADE_RETENTION_DAYS = 90; // مدة الاحتفاظ قبل الحذف النهائي

@Injectable()
export class GradesSyncService {
  constructor(private prisma: PrismaService) {}

  // ==============
  // SYNC – PULL
  // ==============

  async pullSync(params: { since?: string; full?: boolean }) {
    const serverTime = new Date();
    const { since, full } = params;

    let where: Prisma.GradeDictionaryWhereInput = {};

    if (full) {
      // Full sync: نرسل كل الصفوف (محذوفة وغير محذوفة)
      where = {};
    } else if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        throw new BadRequestException('قيمة since غير صالحة');
      }

      const diffDays =
        (serverTime.getTime() - sinceDate.getTime()) /
        (1000 * 60 * 60 * 24);

      if (diffDays > GRADE_RETENTION_DAYS) {
        // قديمة جداً → Full sync
        where = {};
      } else {
        // Incremental
        where = {
          updatedAt: { gt: sinceDate },
        };
      }
    } else {
      // أول مرة → Full sync
      where = {};
    }

    const items = await this.prisma.gradeDictionary.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });

    return {
      serverTime: serverTime.toISOString(),
      items,
    };
  }

  // ==============
  // SYNC – PUSH
  // ==============

  async pushSync(body: GradesSyncPushDto) {
    if (!body.changes || body.changes.length === 0) {
      throw new BadRequestException('changes must be a non-empty array');
    }

    for (const change of body.changes) {
      await this.applyChange(change);
    }

    const serverTime = new Date().toISOString();
    return { serverTime };
  }

  private async applyChange(change: GradeSyncItemDto) {
    if (!change.uuid) {
      throw new BadRequestException('كل سجل يحتاج uuid');
    }

    let existing: GradeDictionary | null =
      await this.prisma.gradeDictionary.findUnique({
        where: { uuid: change.uuid },
      });

    const action = change.action ?? 'UPSERT';

    if (action === 'DELETE') {
      if (!existing) return; // لا شيء
      if (existing.isDeleted) return;

      await this.prisma.gradeDictionary.update({
        where: { uuid: change.uuid },
        data: {
          isDeleted: true,
          isActive: false,
          deletedAt: new Date(),
        },
      });

      return;
    }

    if (action === 'UPSERT') {
      const data: Prisma.GradeDictionaryUncheckedCreateInput = {
        uuid: change.uuid,
        code: change.code,
        defaultName: change.defaultName,
        shortName: change.shortName ?? null,
        stage: change.stage ?? null,
        sortOrder: change.sortOrder ?? existing?.sortOrder ?? 0,
        isActive: typeof change.isActive === 'boolean'
          ? change.isActive
          : existing?.isActive ?? true,
        isDeleted: false,
        deletedAt: null,
      };

      if (!existing) {
        await this.prisma.gradeDictionary.create({ data });
      } else {
        await this.prisma.gradeDictionary.update({
          where: { uuid: change.uuid },
          data,
        });
      }

      return;
    }

    throw new BadRequestException(`Unknown action: ${action}`);
  }

  // ==============
  // حذف نهائي اختياري
  // ==============

  async hardDeleteOldGrades() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - GRADE_RETENTION_DAYS);

    const result = await this.prisma.gradeDictionary.deleteMany({
      where: {
        isDeleted: true,
        deletedAt: { lt: cutoff },
      },
    });

    return {
      deletedCount: result.count,
    };
  }
}