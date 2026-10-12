// src/owner/backup/services/retention.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupCategory } from '@prisma/client';
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

  /**
   * الحد الأدنى المطلق للنسخ الناجحة في النظام — لا يمكن النزول عنه
   * حتى لو كانت إعدادات الخطة تسمح بأقل من ذلك
   */
  private readonly MIN_SAFE_BACKUPS = 3;

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
        const errorMsg = error instanceof Error ? error.message : String(error);
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
    // الحد الفعلي المعمول به = الأكبر بين إعداد الخطة و MIN_SAFE_BACKUPS
    // يمنع هذا حذف نسخ تُبقي النظام بأقل من الحد الآمن
    const effectiveMaxBackups = Math.max(
      plan.maxBackups,
      this.MIN_SAFE_BACKUPS,
    );

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
      select: { id: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const oldIds = oldInstances.map((i) => i.id);

    // 2. حذف بالعدد — يستخدم effectiveMaxBackups بدلاً من plan.maxBackups
    const activeCount = await this.prisma.backupInstance.count({
      where: {
        planId: plan.id,
        isDeleted: false,
        isPinned: false,
        category: 'NORMAL',
      },
    });

    // نحسب العدد المتبقي بعد حذف القديمة
    const remainingAfterAge = activeCount - oldIds.length;
    let excessInstances: { id: number; status: any }[] = [];
    if (remainingAfterAge > effectiveMaxBackups) {
      const excess = remainingAfterAge - effectiveMaxBackups;
      excessInstances = await this.prisma.backupInstance.findMany({
        where: {
          planId: plan.id,
          isDeleted: false,
          isPinned: false,
          category: 'NORMAL',
          id: { notIn: oldIds }, // استبعاد المحذوفة بالعمر
        },
        select: { id: true, status: true },
        orderBy: { createdAt: 'asc' },
        take: excess,
      });
    }

    const candidateInstances = [...oldInstances, ...excessInstances];
    if (candidateInstances.length === 0) return 0;

    // ── حماية نهائية: التحقق من عدد النسخ الناجحة على مستوى النظام كله ──
    // العد يشمل فقط النسخ SUCCESS وغير المحذوفة منطقياً
    const globalSuccessCount = await this.prisma.backupInstance.count({
      where: { isDeleted: false, status: 'SUCCESS' },
    });

    const successCandidates = candidateInstances.filter(
      (i) => i.status === 'SUCCESS',
    );
    const nonSuccessCandidates = candidateInstances.filter(
      (i) => i.status !== 'SUCCESS',
    );

    // الحد الأقصى للنسخ الناجحة المسموح بحذفها دون النزول عن MIN_SAFE_BACKUPS
    const maxSuccessToDelete = Math.max(
      0,
      globalSuccessCount - this.MIN_SAFE_BACKUPS,
    );

    let allowedSuccessCandidates = successCandidates;
    if (successCandidates.length > maxSuccessToDelete) {
      // نُقلّص النسخ الناجحة المرشحة للحذف لتحافظ على الحد الأدنى (الأقدم أولاً)
      allowedSuccessCandidates = successCandidates.slice(0, maxSuccessToDelete);
      const protectedCount =
        successCandidates.length - allowedSuccessCandidates.length;
      this.logger.warn(
        `Retention for "${plan.name}": protected ${protectedCount} successful backup(s) to preserve MIN_SAFE_BACKUPS (${this.MIN_SAFE_BACKUPS})`,
      );
    }

    // القائمة النهائية للحذف: النسخ الناجحة المسموح بحذفها + النسخ غير الناجحة المرشحة
    const finalCandidates = [
      ...allowedSuccessCandidates,
      ...nonSuccessCandidates,
    ];

    if (finalCandidates.length === 0) {
      this.logger.warn(
        `Retention for "${plan.name}": skipped — no eligible backups to delete after safety checks`,
      );
      return 0;
    }

    const idsToDelete = finalCandidates.map((i) => i.id);

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
        isPinned: false,
        category: { not: BackupCategory.SYSTEM_SAFETY },
      },
    });

    let purgedCount = 0;

    for (const instance of toPurge) {
      // حماية دفاعية مضاعفة: استثناء صريح لأي نسخة مثبتة أو أمان
      if (
        instance.isPinned ||
        instance.category === BackupCategory.SYSTEM_SAFETY
      ) {
        this.logger.warn(
          `Skipping purge for protected instance: ${instance.backupName} (isPinned=${instance.isPinned}, category=${instance.category})`,
        );
        continue;
      }

      try {
        if (instance.storagePath) {
          // 1. حذف الملفات الجانبية (checksum + sidecar manifest)
          for (const suffix of ['.sha256', '.manifest.json']) {
            try {
              await this.storage.deleteFile(`${instance.storagePath}${suffix}`);
            } catch {
              // ملف جانبي مفقود — مقبول
            }
          }

          // 2. حذف الأرشيف — متسامح مع ENOENT
          // إذا الملف محذوف مسبقاً (تنظيف يدوي مثلاً) لا نمنع حذف السجل
          try {
            await this.storage.deleteFile(instance.storagePath);
          } catch (fileErr: any) {
            if (fileErr?.code === 'ENOENT') {
              this.logger.debug(
                `Archive already removed from disk: ${instance.backupName}`,
              );
            } else {
              throw fileErr; // خطأ حقيقي (صلاحيات، IO) — لا نحذف السجل
            }
          }
        }

        // 3. حذف سجل DB — يصل هنا حتى لو الملف كان مفقوداً
        await this.prisma.backupInstance.delete({
          where: { id: instance.id },
        });

        purgedCount++;
        this.logger.debug(`Purged from disk: ${instance.backupName}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // لا نحذف السجل — سيُعاد المحاولة في الدورة القادمة
        this.logger.warn(`Failed to purge ${instance.backupName}: ${errorMsg}`);
      }
    }

    return purgedCount;
  }
}
