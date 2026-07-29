// src/owner/backup/backup.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { BackupOrchestratorService } from './services/backup-orchestrator.service';
import { RestoreOrchestratorService } from './services/restore-orchestrator.service';
import { BackupSchedulerService } from './services/backup-scheduler.service';
import { TriggerBackupDto } from './dto/trigger-backup.dto';
import { TriggerRestoreDto } from './dto/trigger-restore.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

/**
 * API النسخ الاحتياطي والاستعادة (BKP-001)
 *
 * جميع المسارات تحت owner/ ومحمية بـ PlatformJwtAuthGuard + PlatformAdminGuard
 * فقط Platform Owner يصل إلى هذه العمليات (DEC-006)
 */
@Controller('owner/backups')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class BackupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: BackupOrchestratorService,
    private readonly restoreOrchestrator: RestoreOrchestratorService,
    private readonly scheduler: BackupSchedulerService,
  ) {}

  // ══════════════════════════════════════════════
  // ──  BACKUP OPERATIONS
  // ══════════════════════════════════════════════

  /**
   * POST /owner/backups/trigger
   * بدء نسخ احتياطي يدوي
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED) // 202 — العملية تعمل في الخلفية
  async triggerBackup(@Body() dto: TriggerBackupDto) {
    try {
      const result = await this.orchestrator.startBackup({
        triggeredBy: 'MANUAL',
        planId: dto.planId,
        // TODO: initiatedByUserUuid from JWT
      });

      return {
        message: 'Backup started',
        jobUuid: result.jobUuid,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'BACKUP_ALREADY_RUNNING') {
          throw new ConflictException(
            'A backup operation is already running',
          );
        }
        if (error.message === 'RESTORE_ALREADY_RUNNING') {
          throw new ConflictException(
            'A restore operation is currently running',
          );
        }
      }
      throw error;
    }
  }

  // ══════════════════════════════════════════════
  // ──  BACKUP JOBS (سجل العمليات)
  // ══════════════════════════════════════════════

  /**
   * GET /owner/backups/jobs
   * قائمة عمليات النسخ (مع pagination)
   */
  @Get('jobs')
  async getJobs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(
      50,
      Math.max(1, parseInt(limit ?? '20', 10) || 20),
    );
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total] = await Promise.all([
      this.prisma.backupJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          plan: { select: { name: true } },
          backupInstance: {
            select: { uuid: true, backupName: true, status: true },
          },
        },
      }),
      this.prisma.backupJob.count(),
    ]);

    return {
      data: jobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * GET /owner/backups/jobs/:uuid
   * تفاصيل عملية نسخ واحدة مع السجلات
   */
  @Get('jobs/:uuid')
  async getJob(@Param('uuid') uuid: string) {
    const job = await this.prisma.backupJob.findUnique({
      where: { uuid },
      include: {
        plan: true,
        backupInstance: true,
        logs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Backup job not found');
    }

    return job;
  }

  // ══════════════════════════════════════════════
  // ──  BACKUP INSTANCES (النسخ المتاحة)
  // ══════════════════════════════════════════════

  /**
   * GET /owner/backups/instances
   * قائمة النسخ المتاحة (غير المحذوفة)
   */
  @Get('instances')
  async getInstances(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    // الحد الأقصى 200 نسخة — يكفي لأي حالة عملية
    const limitNum = Math.min(
      200,
      Math.max(1, parseInt(limit ?? '20', 10) || 20),
    );
    const skip = (pageNum - 1) * limitNum;

    const [instances, total] = await Promise.all([
      this.prisma.backupInstance.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.backupInstance.count({
        where: { isDeleted: false },
      }),
    ]);

    return {
      data: instances,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * GET /owner/backups/instances/:uuid
   * تفاصيل نسخة واحدة
   */
  @Get('instances/:uuid')
  async getInstance(@Param('uuid') uuid: string) {
    const instance = await this.prisma.backupInstance.findUnique({
      where: { uuid },
    });

    if (!instance || instance.isDeleted) {
      throw new NotFoundException('Backup instance not found');
    }

    return instance;
  }

  /**
   * PATCH /owner/backups/instances/:uuid/pin
   * تثبيت/إلغاء تثبيت نسخة (منع الحذف التلقائي)
   */
  @Patch('instances/:uuid/pin')
  async togglePin(@Param('uuid') uuid: string) {
    const instance = await this.prisma.backupInstance.findUnique({
      where: { uuid },
    });

    if (!instance || instance.isDeleted) {
      throw new NotFoundException('Backup instance not found');
    }

    // نُعيد الكائن الكامل ليتوافق مع BackupInstanceModel في Flutter
    const updated = await this.prisma.backupInstance.update({
      where: { uuid },
      data: { isPinned: !instance.isPinned },
    });

    return updated;
  }

  /**
   * DELETE /owner/backups/instances/:uuid
   * حذف نسخة (soft delete)
   */
  @Delete('instances/:uuid')
  async deleteInstance(@Param('uuid') uuid: string) {
    const instance = await this.prisma.backupInstance.findUnique({
      where: { uuid },
    });

    if (!instance || instance.isDeleted) {
      throw new NotFoundException('Backup instance not found');
    }

    if (instance.isPinned) {
      throw new BadRequestException(
        'Cannot delete a pinned backup. Unpin it first.',
      );
    }

    // ── حماية الحد الأدنى: لا يُسمح بالحذف إذا سيُبقي أقل من 3 نسخ ناجحة ──
    // يُطبَّق فقط على النسخ الناجحة لأنها هي التي يمكن الاستعادة منها
    if (instance.status === 'SUCCESS') {
      const successCount = await this.prisma.backupInstance.count({
        where: {
          isDeleted: false,
          status: 'SUCCESS',
        },
      });

      if (successCount <= 3) {
        throw new BadRequestException(
          `Cannot delete: system requires a minimum of 3 successful backups. ` +
          `Currently only ${successCount} exist. Create more backups first.`,
        );
      }
    }

    await this.prisma.backupInstance.update({
      where: { uuid },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return { message: 'Backup deleted' };
  }

  // ══════════════════════════════════════════════
  // ──  BACKUP PLANS (الخطط)
  // ══════════════════════════════════════════════

  /**
   * GET /owner/backups/plans
   * قائمة خطط النسخ
   */
  @Get('plans')
  async getPlans() {
    return this.prisma.backupPlan.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * GET /owner/backups/plans/:id
   * تفاصيل خطة
   */
  @Get('plans/:id')
  async getPlan(@Param('id', ParseIntPipe) id: number) {
    const plan = await this.prisma.backupPlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException('Backup plan not found');
    }

    return plan;
  }

  /**
   * PATCH /owner/backups/plans/:id
   * تحديث خطة
   */
  @Patch('plans/:id')
  async updatePlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlanDto,
  ) {
    const plan = await this.prisma.backupPlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException('Backup plan not found');
    }

    const updated = await this.prisma.backupPlan.update({
      where: { id },
      data: dto,
    });

    // إعادة مزامنة Cron Jobs بعد تحديث الخطة
    await this.scheduler.syncSchedules();

    return updated;
  }

  // ══════════════════════════════════════════════
  // ──  DASHBOARD / STATS
  // ══════════════════════════════════════════════

  /**
   * GET /owner/backups/dashboard
   * إحصائيات لوحة التحكم
   */
  @Get('dashboard')
  async getDashboard() {
    const [
      totalInstances,
      totalSizeResult,
      latestInstance,
      latestJob,
      latestRestore,
      runningJobs,
      failedJobs24h,
      activePlan,
    ] = await Promise.all([
      // 1. إجمالي النسخ
      this.prisma.backupInstance.count({
        where: { isDeleted: false },
      }),
      // 2. الحجم الكلي (aggregate)
      this.prisma.backupInstance.aggregate({
        where: { isDeleted: false, fileSizeBytes: { gt: 0 } },
        _sum: { fileSizeBytes: true },
      }),
      // 3. آخر نسخة (latestInstance — يتوافق مع Flutter model)
      this.prisma.backupInstance.findFirst({
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
      }),
      // 4. آخر عملية نسخ (latestJob)
      this.prisma.backupJob.findFirst({
        orderBy: { createdAt: 'desc' },
      }),
      // 5. آخر عملية استعادة (latestRestore)
      this.prisma.restoreJob.findFirst({
        orderBy: { createdAt: 'desc' },
        include: {
          backupInstance: {
            select: { uuid: true, backupName: true },
          },
        },
      }),
      // 6. عمليات قيد التنفيذ
      this.prisma.backupJob.count({
        where: { status: 'RUNNING' },
      }),
      // 7. فشل آخر 24 ساعة
      this.prisma.backupJob.count({
        where: {
          status: 'FAILED',
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
      // 8. الخطة النشطة
      this.prisma.backupPlan.findFirst({
        where: { enabled: true },
        select: {
          name: true,
          scheduleType: true,
          runTime: true,
          enabled: true,
        },
      }),
    ]);

    return {
      // حقول تتوافق مع BackupDashboardModel في Flutter
      totalInstances,
      totalSizeBytes: totalSizeResult._sum?.fileSizeBytes ?? 0,
      latestInstance,
      latestJob,
      latestRestore,
      // حقول إضافية للـ Dashboard UI
      runningJobs,
      failedJobs24h,
      activePlan,
    };
  }

  // ══════════════════════════════════════════════
  // ──  RESTORE OPERATIONS
  // ══════════════════════════════════════════════

  /**
   * POST /owner/backups/restore
   * بدء عملية استعادة
   */
  @Post('restore')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerRestore(@Body() dto: TriggerRestoreDto) {
    // التحقق من وجود النسخة
    const instance = await this.prisma.backupInstance.findUnique({
      where: { uuid: dto.backupInstanceUuid },
    });

    if (!instance || instance.isDeleted) {
      throw new NotFoundException('Backup instance not found');
    }

    // التحقق من أن هناك شيء لاستعادته
    if (
      !dto.restoreDatabase &&
      !dto.restoreMedia &&
      !dto.restoreConfiguration
    ) {
      throw new BadRequestException(
        'At least one component must be selected for restore',
      );
    }

    try {
      const result = await this.restoreOrchestrator.startRestore({
        backupInstanceId: instance.id,
        restoreDatabase: dto.restoreDatabase ?? true,
        restoreMedia: dto.restoreMedia ?? true,
        restoreConfiguration: dto.restoreConfiguration ?? true,
        initiatedByUserUuid: 'owner', // TODO: from JWT
      });

      return {
        message: 'Restore started',
        jobUuid: result.jobUuid,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'BACKUP_ALREADY_RUNNING') {
          throw new ConflictException(
            'A backup operation is currently running',
          );
        }
        if (error.message === 'RESTORE_ALREADY_RUNNING') {
          throw new ConflictException(
            'A restore operation is already running',
          );
        }
      }
      throw error;
    }
  }

  /**
   * GET /owner/backups/restore-jobs
   * قائمة عمليات الاستعادة
   */
  @Get('restore-jobs')
  async getRestoreJobs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(
      50,
      Math.max(1, parseInt(limit ?? '20', 10) || 20),
    );
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total] = await Promise.all([
      this.prisma.restoreJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          backupInstance: {
            select: { uuid: true, backupName: true },
          },
          safetyBackup: {
            select: { uuid: true, backupName: true },
          },
        },
      }),
      this.prisma.restoreJob.count(),
    ]);

    return {
      data: jobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  /**
   * GET /owner/backups/restore-jobs/:uuid
   * تفاصيل عملية استعادة مع السجلات
   */
  @Get('restore-jobs/:uuid')
  async getRestoreJob(@Param('uuid') uuid: string) {
    const job = await this.prisma.restoreJob.findUnique({
      where: { uuid },
      include: {
        backupInstance: true,
        safetyBackup: true,
        logs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('Restore job not found');
    }

    return job;
  }
}
