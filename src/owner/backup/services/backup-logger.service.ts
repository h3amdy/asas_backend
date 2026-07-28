// src/owner/backup/services/backup-logger.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BackupLogLevel, BackupLogPhase } from '@prisma/client';

/**
 * خدمة تسجيل أحداث النسخ الاحتياطي (Structured Logging)
 *
 * كل مرحلة تُسجل مع:
 * - المستوى (INFO/WARN/ERROR)
 * - المرحلة (PREFLIGHT, DB_DUMP, MEDIA_COPY, ...)
 * - الرسالة
 * - metadata إضافية (اختيارية)
 * - مدة التنفيذ بالمللي ثانية (اختيارية)
 */
@Injectable()
export class BackupLoggerService {
  private readonly logger = new Logger(BackupLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * تسجيل حدث مرتبط بعملية نسخ
   */
  async logBackupEvent(params: {
    backupJobId: number;
    level: BackupLogLevel;
    phase: BackupLogPhase;
    message: string;
    metadata?: Record<string, unknown>;
    durationMs?: number;
  }): Promise<void> {
    await this.writeLog(params);
  }

  /**
   * تسجيل حدث مرتبط بعملية استعادة
   */
  async logRestoreEvent(params: {
    restoreJobId: number;
    level: BackupLogLevel;
    phase: BackupLogPhase;
    message: string;
    metadata?: Record<string, unknown>;
    durationMs?: number;
  }): Promise<void> {
    await this.writeLog(params);
  }

  /**
   * الدالة الموحدة للتسجيل — تدعم backup و restore
   * يمكن استدعاؤها مباشرة مع restoreJobId أو عبر الاختصارات
   */
  async writeLog(
    params: {
      backupJobId?: number;
      restoreJobId?: number;
      level: BackupLogLevel;
      phase: BackupLogPhase;
      message: string;
      metadata?: Record<string, unknown>;
      durationMs?: number;
    },
  ): Promise<void> {
    const jobRef: { backupJobId?: number; restoreJobId?: number } = {};
    let prefix: string;

    if (params.restoreJobId) {
      jobRef.restoreJobId = params.restoreJobId;
      prefix = `[RestoreJob:${params.restoreJobId}]`;
    } else if (params.backupJobId) {
      jobRef.backupJobId = params.backupJobId;
      prefix = `[BackupJob:${params.backupJobId}]`;
    } else {
      prefix = '[Unknown]';
    }
    try {
      await this.prisma.backupLog.create({
        data: {
          ...jobRef,
          level: params.level,
          phase: params.phase,
          message: params.message,
          metadata: (params.metadata as any) ?? undefined,
          durationMs: params.durationMs ?? undefined,
        },
      });

      const logMessage = `${prefix}[${params.phase}] ${params.message}`;
      switch (params.level) {
        case 'ERROR':
          this.logger.error(logMessage);
          break;
        case 'WARN':
          this.logger.warn(logMessage);
          break;
        default:
          this.logger.log(logMessage);
      }
    } catch (error) {
      // لا نريد أن يفشل النسخ بسبب فشل التسجيل
      // نكتب في stderr كحل أخير
      this.logger.error(
        `Failed to write log: ${error.message}`,
      );
      process.stderr.write(
        `[BackupLogger FALLBACK] ${prefix}[${params.phase}] ${params.message}\n`,
      );
    }
  }

  // ── اختصارات لعمليات النسخ ──

  async info(
    backupJobId: number,
    phase: BackupLogPhase,
    message: string,
    metadata?: Record<string, unknown>,
    durationMs?: number,
  ): Promise<void> {
    await this.logBackupEvent({
      backupJobId,
      level: 'INFO',
      phase,
      message,
      metadata,
      durationMs,
    });
  }

  async warn(
    backupJobId: number,
    phase: BackupLogPhase,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.logBackupEvent({
      backupJobId,
      level: 'WARN',
      phase,
      message,
      metadata,
    });
  }

  async error(
    backupJobId: number,
    phase: BackupLogPhase,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.logBackupEvent({
      backupJobId,
      level: 'ERROR',
      phase,
      message,
      metadata,
    });
  }
}
