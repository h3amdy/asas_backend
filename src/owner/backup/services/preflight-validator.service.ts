// src/owner/backup/services/preflight-validator.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { BackupErrorCodes, BackupErrorCode } from '../types/error-codes';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * نتيجة فحص واحد
 */
export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  errorCode?: BackupErrorCode;
}

/**
 * نتيجة فحص Pre-flight الكامل
 */
export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
  failedChecks: PreflightCheck[];
}

/**
 * خدمة التحقق من البيئة قبل النسخ (DEC-010)
 *
 * يتحقق من:
 * - مساحة القرص المتاحة
 * - صلاحيات الكتابة
 * - توفر أدوات النظام (pg_dump, tar, gzip, sha256sum)
 * - اتصال قاعدة البيانات
 * - عدم وجود عملية نسخ أخرى قيد التنفيذ
 *
 * إذا فشل أي فحص → لا تبدأ عملية النسخ
 */
@Injectable()
export class PreflightValidatorService {
  private readonly logger = new Logger(PreflightValidatorService.name);

  /** الحد الأدنى للمساحة المطلوبة (1 GB) */
  private readonly MIN_DISK_SPACE_BYTES = BigInt(1_073_741_824);

  /** أدوات النظام المطلوبة */
  private readonly REQUIRED_TOOLS = [
    'pg_dump',
    'tar',
    'gzip',
    'sha256sum',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageProvider,
  ) {}

  /**
   * تنفيذ جميع فحوصات Pre-flight
   */
  async validate(storagePath: string, currentJobId?: number): Promise<PreflightResult> {
    this.logger.log('Starting pre-flight validation...');

    const checks: PreflightCheck[] = [];

    // 1. فحص اتصال قاعدة البيانات
    checks.push(await this.checkDatabaseConnection());

    // 2. فحص مساحة القرص
    checks.push(await this.checkDiskSpace(storagePath));

    // 3. فحص صلاحيات الكتابة
    checks.push(await this.checkWritePermissions(storagePath));

    // 4. فحص أدوات النظام
    for (const tool of this.REQUIRED_TOOLS) {
      checks.push(await this.checkToolAvailable(tool));
    }

    // 5. فحص عدم وجود عملية نسخ أخرى
    checks.push(await this.checkNoConcurrentBackup(currentJobId));

    // 6. فحص عدم وجود عملية استعادة
    checks.push(await this.checkNoConcurrentRestore());

    const failedChecks = checks.filter((c) => !c.passed);
    const passed = failedChecks.length === 0;

    if (passed) {
      this.logger.log(
        `Pre-flight validation passed (${checks.length} checks)`,
      );
    } else {
      this.logger.warn(
        `Pre-flight validation failed: ${failedChecks.map((c) => c.name).join(', ')}`,
      );
    }

    return { passed, checks, failedChecks };
  }

  // ── الفحوصات الفردية ──

  private async checkDatabaseConnection(): Promise<PreflightCheck> {
    const name = 'database_connection';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name, passed: true, message: 'Database connection OK' };
    } catch (error) {
      return {
        name,
        passed: false,
        message: `Database connection failed: ${error.message}`,
        errorCode: BackupErrorCodes.DATABASE_CONNECTION_FAILED,
      };
    }
  }

  private async checkDiskSpace(
    storagePath: string,
  ): Promise<PreflightCheck> {
    const name = 'disk_space';
    try {
      const available = await this.storage.getAvailableSpace(storagePath);
      if (available >= this.MIN_DISK_SPACE_BYTES) {
        const availableGB = Number(available / BigInt(1_073_741_824));
        return {
          name,
          passed: true,
          message: `${availableGB.toFixed(1)} GB available`,
        };
      }
      return {
        name,
        passed: false,
        message: `Insufficient disk space: ${Number(available / BigInt(1_048_576))} MB available, need at least 1 GB`,
        errorCode: BackupErrorCodes.INSUFFICIENT_DISK_SPACE,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        message: `Failed to check disk space: ${error.message}`,
        errorCode: BackupErrorCodes.INSUFFICIENT_DISK_SPACE,
      };
    }
  }

  private async checkWritePermissions(
    storagePath: string,
  ): Promise<PreflightCheck> {
    const name = 'write_permissions';
    try {
      // التأكد من وجود المجلد أولاً
      await this.storage.ensureDirectory(storagePath);
      const canWrite = await this.storage.canWrite(storagePath);
      if (canWrite) {
        return { name, passed: true, message: 'Write permissions OK' };
      }
      return {
        name,
        passed: false,
        message: `Cannot write to ${storagePath}`,
        errorCode: BackupErrorCodes.WRITE_PERMISSION_DENIED,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        message: `Permission check failed: ${error.message}`,
        errorCode: BackupErrorCodes.WRITE_PERMISSION_DENIED,
      };
    }
  }

  private async checkToolAvailable(
    toolName: string,
  ): Promise<PreflightCheck> {
    const name = `tool_${toolName}`;
    try {
      const { stdout } = await execFileAsync('which', [toolName]);
      return {
        name,
        passed: true,
        message: `${toolName} found at ${stdout.trim()}`,
      };
    } catch {
      return {
        name,
        passed: false,
        message: `${toolName} not found in PATH`,
        errorCode: BackupErrorCodes.TOOL_NOT_AVAILABLE,
      };
    }
  }

  private async checkNoConcurrentBackup(currentJobId?: number): Promise<PreflightCheck> {
    const name = 'no_concurrent_backup';
    const runningJob = await this.prisma.backupJob.findFirst({
      where: {
        status: 'RUNNING',
        ...(currentJobId ? { id: { not: currentJobId } } : {}),
      },
      select: { uuid: true, createdAt: true },
    });
    if (!runningJob) {
      return {
        name,
        passed: true,
        message: 'No backup job currently running',
      };
    }
    return {
      name,
      passed: false,
      message: `Backup job ${runningJob.uuid} is currently running (started ${runningJob.createdAt.toISOString()})`,
      errorCode: BackupErrorCodes.BACKUP_ALREADY_RUNNING,
    };
  }

  private async checkNoConcurrentRestore(): Promise<PreflightCheck> {
    const name = 'no_concurrent_restore';
    const runningRestore = await this.prisma.restoreJob.findFirst({
      where: { status: 'RUNNING' },
      select: { uuid: true, createdAt: true },
    });
    if (!runningRestore) {
      return {
        name,
        passed: true,
        message: 'No restore job currently running',
      };
    }
    return {
      name,
      passed: false,
      message: `Restore job ${runningRestore.uuid} is currently running`,
      errorCode: BackupErrorCodes.RESTORE_ALREADY_RUNNING,
    };
  }
}
