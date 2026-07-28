// src/owner/backup/services/backup-scheduler.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { BackupOrchestratorService } from './backup-orchestrator.service';
import { BackupScheduleType } from '@prisma/client';
import { CronJob } from 'cron';

/**
 * خدمة جدولة النسخ الاحتياطي التلقائي
 *
 * تقرأ الخطط النشطة وتنشئ Cron Jobs ديناميكياً.
 *
 * الأنماط:
 * - DAILY: يومياً في الوقت المحدد
 * - WEEKLY: أسبوعياً (الأحد)
 * - MONTHLY: شهرياً (اليوم الأول)
 */
@Injectable()
export class BackupSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(BackupSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: BackupOrchestratorService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * عند بدء التطبيق — إنشاء خطة افتراضية إن لم توجد + تحميل Cron Jobs
   */
  async onModuleInit(): Promise<void> {
    await this.seedDefaultPlan();
    await this.syncSchedules();
  }

  /**
   * إنشاء خطة افتراضية تلقائياً عند أول تشغيل (Seed)
   *
   * إذا لا توجد أي خطة → ينشئ "نسخ يومي" الساعة 02:00
   * لا يفعل شيئاً إذا وُجدت خطة مسبقاً
   */
  private async seedDefaultPlan(): Promise<void> {
    const existing = await this.prisma.backupPlan.findFirst();
    if (existing) return;

    this.logger.log('No backup plans found — creating default plan...');

    await this.prisma.backupPlan.create({
      data: {
        name: 'نسخ يومي افتراضي',
        enabled: true,
        scheduleType: 'DAILY',
        runTime: '02:00',
        timezone: 'Asia/Aden',
        storageType: 'LOCAL',
        storagePath: process.env.BACKUP_STORAGE_PATH ?? '/var/backups/mafhooom',
        maxBackups: 30,
        maxAgeDays: 90,
        autoCleanup: true,
      },
    });

    this.logger.log('✅ Default backup plan created (Daily at 02:00)');
  }

  /**
   * مزامنة Cron Jobs مع الخطط في قاعدة البيانات
   * تُستدعى عند بدء التطبيق وعند تحديث الخطط
   */
  async syncSchedules(): Promise<void> {
    // حذف جميع Cron Jobs القديمة
    this.clearAllBackupCrons();

    // تحميل الخطط النشطة
    const plans = await this.prisma.backupPlan.findMany({
      where: { enabled: true },
    });

    for (const plan of plans) {
      try {
        const cronExpression = this.buildCronExpression(
          plan.scheduleType,
          plan.runTime,
        );

        const job = new CronJob(
          cronExpression,
          () => this.executeScheduledBackup(plan.id, plan.name),
          null,
          false, // لا يبدأ تلقائياً
          plan.timezone,
        );

        const jobName = `backup-plan-${plan.id}`;
        this.schedulerRegistry.addCronJob(jobName, job);
        job.start();

        this.logger.log(
          `Scheduled backup "${plan.name}" (${cronExpression}) in ${plan.timezone}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to schedule plan "${plan.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Backup scheduler synced: ${plans.length} active plans`,
    );
  }

  /**
   * تنفيذ نسخ مجدول
   */
  private async executeScheduledBackup(
    planId: number,
    planName: string,
  ): Promise<void> {
    this.logger.log(`⏰ Scheduled backup starting: "${planName}"`);

    try {
      const result = await this.orchestrator.startBackup({
        triggeredBy: 'SCHEDULED',
        planId,
      });

      this.logger.log(
        `Scheduled backup started: "${planName}" → Job ${result.jobUuid}`,
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);

      if (errorMsg === 'BACKUP_ALREADY_RUNNING') {
        this.logger.warn(
          `Scheduled backup skipped: "${planName}" — another backup is running`,
        );
      } else if (errorMsg === 'RESTORE_ALREADY_RUNNING') {
        this.logger.warn(
          `Scheduled backup skipped: "${planName}" — a restore is running`,
        );
      } else {
        this.logger.error(
          `Scheduled backup failed: "${planName}" — ${errorMsg}`,
        );
      }
    }
  }

  /**
   * بناء Cron Expression من نوع الجدولة والوقت
   *
   * مثال: DAILY + "02:00" → "0 2 * * *"
   */
  private buildCronExpression(
    scheduleType: BackupScheduleType,
    runTime: string,
  ): string {
    const [hours, minutes] = runTime.split(':').map(Number);

    switch (scheduleType) {
      case 'DAILY':
        return `${minutes} ${hours} * * *`;
      case 'WEEKLY':
        // الأحد = 0
        return `${minutes} ${hours} * * 0`;
      case 'MONTHLY':
        // اليوم الأول من كل شهر
        return `${minutes} ${hours} 1 * *`;
      default:
        // لا نخفي الأخطاء — إذا وصل نوع غير معروف فهذا خطأ في الإعدادات
        throw new Error(
          `Unknown schedule type: ${scheduleType}`,
        );
    }
  }

  /**
   * حذف جميع Cron Jobs المرتبطة بالنسخ الاحتياطي
   */
  private clearAllBackupCrons(): void {
    const cronJobs = this.schedulerRegistry.getCronJobs();
    for (const [name, job] of cronJobs) {
      if (name.startsWith('backup-plan-')) {
        job.stop();
        this.schedulerRegistry.deleteCronJob(name);
        this.logger.debug(`Removed cron: ${name}`);
      }
    }
  }
}
