// src/owner/backup/services/retention.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';

/**
 * خدمة الاحتفاظ بالنسخ (Retention Policy)
 *
 * تعمل يومياً لتنظيف النسخ القديمة حسب إعدادات الخطة:
 * - maxBackups: الحد الأقصى لعدد النسخ
 * - maxAgeDays: الحد الأقصى لعمر النسخة
 *
 * القواعد:
 * - النسخ المثبتة (isPinned) لا تُحذف أبداً
 * - نسخ الأمان (SYSTEM_SAFETY) لا تُحذف تلقائياً
 * - الحذف soft delete — لا يحذف الملف الفعلي فوراً
 * - التنظيف الفعلي بعد 7 أيام (safety net للتراجع)
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  /** عدد أيام الانتظار بعد soft delete قبل الحذف الفعلي */
  private readonly PURGE_AFTER_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageProvider,
  ) {}

  /**
   * Cron: يعمل يومياً الساعة 03:30 صباحاً
   * (بعد وقت النسخ الافتراضي 02:00)
   */
  @Cron('30 3 * * *')
  async runRetention(): Promise<void> {
    this.logger.log('Starting retention check...');

    const plans = await this.prisma.backupPlan.findMany({
      where: { enabled: true, autoCleanup: true },
    });

    let totalDeleted = 0;

    for (const plan of plans) {
      try {
        const deleted = await this.applyRetentionForPlan(plan);
        totalDeleted += deleted;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Retention failed for plan "${plan.name}": ${errorMsg}`,
        );
      }
    }

    // تنظيف النسخ المحذوفة soft delete القديمة
    const purged = await this.purgeDeletedInstances();

    this.logger.log(
      `Retention completed: ${totalDeleted} soft-deleted, ${purged} purged from disk`,
    );
  }

  /**
   * تطبيق سياسة الاحتفاظ لخطة واحدة
   * ⚠️ كل عمليات الحذف داخل Transaction واحد لمنع حالة نصف مكتملة
   */
  private async applyRetentionForPlan(plan: {
    id: number;
    name: string;
    maxBackups: number;
    maxAgeDays: number;
  }): Promise<number> {
    // جمع IDs المرشحة للحذف
    const idsToDelete: number[] = [];

    // 1. حذف بالعمر (maxAgeDays)
    const cutoffDate = new Date(
      Date.now() - plan.maxAgeDays * 24 * 60 * 60 * 1000,
    );

    const oldInstances = await this.prisma.backupInstance.findMany({
      where: {
        planId: plan.id,
        isDeleted: false,
        isPinned: false,
        category: 'NORMAL',
        createdAt: { lt: cutoffDate },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    idsToDelete.push(...oldInstances.map((i) => i.id));

    // 2. حذف بالعدد (maxBackups)
    const activeCount = await this.prisma.backupInstance.count({
      where: {
        planId: plan.id,
        isDeleted: false,
        isPinned: false,
        category: 'NORMAL',
      },
    });

    // نحسب العدد المتبقي بعد حذف القديمة
    const remainingAfterAge = activeCount - idsToDelete.length;
    if (remainingAfterAge > plan.maxBackups) {
      const excess = remainingAfterAge - plan.maxBackups;
      const excessInstances = await this.prisma.backupInstance.findMany({
        where: {
          planId: plan.id,
          isDeleted: false,
          isPinned: false,
          category: 'NORMAL',
          id: { notIn: idsToDelete }, // استبعاد المحذوفة بالعمر
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: excess,
      });

      idsToDelete.push(...excessInstances.map((i) => i.id));
    }

    if (idsToDelete.length === 0) return 0;

    // ⚠️ تنفيذ كل الحذف في Transaction واحد
    await this.prisma.$transaction(async (tx) => {
      await tx.backupInstance.updateMany({
        where: { id: { in: idsToDelete } },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    });

    this.logger.log(
      `Retention for "${plan.name}": ${idsToDelete.length} backups marked for deletion`,
    );

    return idsToDelete.length;
  }

  /**
   * حذف فعلي للنسخ التي تم soft delete قبل أكثر من PURGE_AFTER_DAYS
   * هذا يمنح وقتاً للتراجع إذا حُذفت نسخة بالخطأ
   *
   * الترتيب (من الأقل أهمية للأكثر):
   * 1. حذف checksum — ملف فرعي
   * 2. حذف archive — الملف الأساسي
   * 3. حذف سجل DB — المرجع
   *
   * إذا فشل حذف الملف، لا نحذف السجل (سيُعاد المحاولة غداً)
   */
  private async purgeDeletedInstances(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    const toPurge = await this.prisma.backupInstance.findMany({
      where: {
        isDeleted: true,
        deletedAt: { lt: cutoff },
      },
    });

    let purgedCount = 0;

    for (const instance of toPurge) {
      try {
        if (instance.storagePath) {
          // 1. حذف checksum أولاً (الأقل أهمية)
          try {
            await this.storage.deleteFile(
              `${instance.storagePath}.sha256`,
            );
          } catch {
            // checksum مفقود — مقبول
          }

          // 2. حذف الأرشيف
          await this.storage.deleteFile(instance.storagePath);
        }

        // 3. حذف سجل DB — فقط إذا نجح حذف الملفات
        await this.prisma.backupInstance.delete({
          where: { id: instance.id },
        });

        purgedCount++;
        this.logger.debug(`Purged from disk: ${instance.backupName}`);
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        // لا نحذف السجل — سيُعاد المحاولة في الدورة القادمة
        this.logger.warn(
          `Failed to purge ${instance.backupName}: ${errorMsg}`,
        );
      }
    }

    return purgedCount;
  }
}
