// src/owner/backup/services/backup-orchestrator.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { STORAGE_DIRS } from '../storage/storage-provider.interface';
import { PreflightValidatorService } from './preflight-validator.service';
import { BackupLoggerService } from './backup-logger.service';
import { PgDumpEngine } from '../engines/pg-dump.engine';
import { MediaBackupEngine } from '../engines/media-backup.engine';
import { ConfigBackupEngine } from '../engines/config-backup.engine';
import { BackupManifest } from '../types/manifest.type';
import {
  DatabaseBackupResult,
  MediaBackupResult,
  ConfigBackupResult,
} from '../engines/backup-engine.interface';
import {
  BackupTriggerType,
  BackupCategory,
  BackupInstanceStatus,
} from '@prisma/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

/**
 * المنسق الرئيسي لعمليات النسخ الاحتياطي (DEC-009)
 *
 * أساس ليس محرك نسخ — بل نظام إدارة وتنسيق يعتمد على أدوات موثوقة.
 *
 * Pipeline:
 * 1. PREFLIGHT → 2. CREATE JOB → 3. DB DUMP → 4. MEDIA COPY
 * → 5. CONFIG COPY → 6. MANIFEST → 7. COMPRESS → 8. CHECKSUM
 * → 9. VERIFY → 10. ACTIVATE → 11. RETENTION → 12. CLEANUP
 */
@Injectable()
export class BackupOrchestratorService {
  private readonly logger = new Logger(BackupOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageProvider,
    private readonly preflight: PreflightValidatorService,
    private readonly backupLogger: BackupLoggerService,
    private readonly pgDumpEngine: PgDumpEngine,
    private readonly mediaEngine: MediaBackupEngine,
    private readonly configEngine: ConfigBackupEngine,
  ) {}

  /**
   * بدء عملية نسخ احتياطي
   *
   * العملية تعمل كـ Background Job — لا تنتظر HTTP Response
   */
  async startBackup(params: {
    triggeredBy: BackupTriggerType;
    category?: BackupCategory;
    initiatedByUserUuid?: string;
    planId?: number;
  }): Promise<{ jobUuid: string }> {
    // الحصول على إعدادات الخطة (أو القيم الافتراضية)
    const plan = params.planId
      ? await this.prisma.backupPlan.findUnique({
          where: { id: params.planId },
        })
      : await this.getDefaultPlan();

    const defaultStoragePath = path.resolve(
      process.env.BACKUP_STORAGE_PATH || './backups',
    );
    const storagePath =
      plan?.storagePath && plan.storagePath !== '/var/backups/mafhooom'
        ? plan.storagePath
        : defaultStoragePath;
    const category = params.category ?? 'NORMAL';

    // ⚠️ إنشاء Job بحماية من Race Condition
    // نستخدم PostgreSQL Advisory Lock داخل Transaction
    // لمنع طلبين متزامنين من إنشاء Job في نفس الوقت
    const job = await this.prisma.$transaction(async (tx) => {
      // Advisory Lock (رقم ثابت وفريد لعمليات النسخ)
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(8675309)');

      // التحقق من عدم وجود Job أو Restore قيد التنفيذ
      const runningBackup = await tx.backupJob.findFirst({
        where: { status: 'RUNNING' },
      });
      if (runningBackup) {
        throw new Error('BACKUP_ALREADY_RUNNING');
      }

      // Safety Backup (PRE_RESTORE) يتجاوز فحص Restore القيد التنفيذ
      // لأنه يُستدعى من داخل عملية Restore نفسها
      if (params.triggeredBy !== 'PRE_RESTORE') {
        const runningRestore = await tx.restoreJob.findFirst({
          where: { status: 'RUNNING' },
        });
        if (runningRestore) {
          throw new Error('RESTORE_ALREADY_RUNNING');
        }
      }

      // إنشاء Job — محمي بالـ Lock
      return tx.backupJob.create({
        data: {
          triggeredBy: params.triggeredBy,
          planId: plan?.id,
          initiatedByUserUuid: params.initiatedByUserUuid,
          status: 'PENDING',
        },
      });
    });

    // تشغيل Pipeline في الخلفية
    this.runPipeline(job.id, storagePath, category, plan?.id).catch(
      (err) => {
        this.logger.error(
          `Pipeline crashed for job ${job.uuid}: ${err.message}`,
        );
      },
    );

    return { jobUuid: job.uuid };
  }

  /**
   * Pipeline النسخ الاحتياطي الكامل
   */
  private async runPipeline(
    jobId: number,
    storagePath: string,
    category: BackupCategory,
    planId?: number,
  ): Promise<void> {
    const job = await this.prisma.backupJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;

    const workDir = path.join(
      storagePath,
      STORAGE_DIRS.TEMP,
      job.uuid,
    );

    try {
      // ── 1. PREFLIGHT ──
      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      const preflightStart = Date.now();
      const preflightResult = await this.preflight.validate(storagePath, jobId);

      await this.backupLogger.info(
        jobId,
        'PREFLIGHT',
        preflightResult.passed
          ? `Pre-flight passed (${preflightResult.checks.length} checks)`
          : `Pre-flight failed: ${preflightResult.failedChecks.map((c) => c.name).join(', ')}`,
        { checks: preflightResult.checks },
        Date.now() - preflightStart,
      );

      if (!preflightResult.passed) {
        await this.failJob(
          jobId,
          `Pre-flight validation failed: ${preflightResult.failedChecks.map((c) => c.message).join('; ')}`,
        );
        return;
      }

      // ── 2. PREPARE WORKSPACE ──
      await this.storage.ensureDirectory(workDir);

      // ── 3. DATABASE DUMP ──
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        await this.failJob(jobId, 'DATABASE_URL not configured');
        return;
      }

      const dbResult = await this.pgDumpEngine.execute(
        workDir,
        databaseUrl,
      );

      await this.backupLogger.info(
        jobId,
        'DB_DUMP',
        dbResult.success
          ? `Database dump completed (${Number(dbResult.sizeBytes / BigInt(1048576))} MB)`
          : `Database dump failed: ${dbResult.errorMessage}`,
        { sizeBytes: Number(dbResult.sizeBytes) },
        dbResult.durationMs,
      );

      if (!dbResult.success) {
        await this.failJob(
          jobId,
          `Database dump failed: ${dbResult.errorMessage}`,
          workDir,
        );
        return;
      }

      // ── 4. MEDIA COPY ──
      const mediaBasePath =
        path.resolve(process.env.MEDIA_STORAGE_PATH ?? './storage');
      const mediaResult = await this.mediaEngine.execute(
        workDir,
        mediaBasePath,
        dbResult.details.mediaStorageKeys,
      );

      const mediaStatus =
        mediaResult.details.missingStorageKeys.length > 0
          ? 'PARTIAL_SUCCESS'
          : 'SUCCESS';

      await this.backupLogger.logBackupEvent({
        backupJobId: jobId,
        level:
          mediaResult.details.missingStorageKeys.length > 0 ? 'WARN' : 'INFO',
        phase: 'MEDIA_COPY',
        message: `Media copy: ${mediaResult.details.filesCopied}/${mediaResult.details.filesExpected} files`,
        metadata: {
          filesCopied: mediaResult.details.filesCopied,
          filesExpected: mediaResult.details.filesExpected,
          missingCount: mediaResult.details.missingStorageKeys.length,
        },
        durationMs: mediaResult.durationMs,
      });

      if (!mediaResult.success) {
        await this.failJob(
          jobId,
          `Media backup failed: ${mediaResult.errorMessage}`,
          workDir,
        );
        return;
      }

      // ── 5. CONFIG COPY ──
      const projectRoot =
        process.env.PROJECT_ROOT ??
        path.resolve(__dirname, '../../../../');
      const configResult = await this.configEngine.execute(
        workDir,
        projectRoot,
      );

      await this.backupLogger.info(
        jobId,
        'CONFIG_COPY',
        `Config copy: ${configResult.details.files.length} files`,
        { files: configResult.details.files },
        configResult.durationMs,
      );

      // ── 6. BUILD MANIFEST ──
      const manifestStart = Date.now();
      const manifest = this.buildManifest(
        job.uuid,
        category,
        job.triggeredBy,
        dbResult,
        mediaResult,
        configResult,
        mediaStatus,
      );

      const manifestPath = path.join(workDir, 'manifest.json');
      await fsp.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );

      await this.backupLogger.info(
        jobId,
        'MANIFEST',
        'Manifest created',
        undefined,
        Date.now() - manifestStart,
      );

      // ── 7. COMPRESS ──
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      const archiveName = `backup_${timestamp}.tar.gz`;
      const archivePath = path.join(
        storagePath,
        STORAGE_DIRS.TEMP,
        archiveName,
      );

      const compressStart = Date.now();
      await execFileAsync('tar', [
        '-czf',
        archivePath,
        '-C',
        workDir,
        '.',
      ]);

      const archiveStats = await fsp.stat(archivePath);
      const archiveSizeBytes = BigInt(archiveStats.size);

      await this.backupLogger.info(
        jobId,
        'COMPRESS',
        `Archive created: ${archiveName} (${Number(archiveSizeBytes / BigInt(1048576))} MB)`,
        { archiveName },
        Date.now() - compressStart,
      );

      // ── 8. CHECKSUM (خارج الأرشيف — DEC-003) ──
      const checksumStart = Date.now();
      const archiveSha256 = await this.computeFileSha256(archivePath);
      const checksumPath = `${archivePath}.sha256`;
      await fsp.writeFile(
        checksumPath,
        `${archiveSha256}  ${archiveName}\n`,
        'utf-8',
      );

      await this.backupLogger.info(
        jobId,
        'CHECKSUM',
        `Checksum: ${archiveSha256.slice(0, 16)}...`,
        { sha256: archiveSha256 },
        Date.now() - checksumStart,
      );

      // ── 9. ACTIVATE (نقل من temp إلى completed) ──
      const completedDir = path.join(storagePath, STORAGE_DIRS.COMPLETED);
      await this.storage.ensureDirectory(completedDir);

      const finalArchivePath = path.join(completedDir, archiveName);
      const finalChecksumPath = `${finalArchivePath}.sha256`;

      await this.storage.moveFile(archivePath, finalArchivePath);
      await this.storage.moveFile(checksumPath, finalChecksumPath);

      await this.backupLogger.info(
        jobId,
        'ACTIVATE',
        `Backup activated: ${archiveName}`,
      );

      // ── 10. CREATE INSTANCE RECORD ──
      // الحصول على آخر migration لتسجيل databaseSchemaVersion
      let dbSchemaVersion: string | null = null;
      try {
        const lastMigration = await this.prisma.$queryRaw<
          { migration_name: string }[]
        >`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`;
        if (lastMigration?.length > 0) {
          dbSchemaVersion = lastMigration[0].migration_name;
        }
      } catch {
        // ignore
      }

      // تحديث manifest بـ databaseSchemaVersion الحقيقي (إصلاح باغ null)
      if (dbSchemaVersion) {
        manifest.databaseSchemaVersion = dbSchemaVersion;
        await fsp.writeFile(
          manifestPath,
          JSON.stringify(manifest, null, 2),
          'utf-8',
        );
      }

      const instanceStatus: BackupInstanceStatus =
        mediaStatus === 'PARTIAL_SUCCESS'
          ? 'PARTIAL_SUCCESS'
          : 'SUCCESS';

      // ⚠️ إنشاء Instance + تحديث Job في Transaction واحد
      // لمنع حالة Instance بدون Job أو العكس
      await this.prisma.$transaction(async (tx) => {
        const instance = await tx.backupInstance.create({
          data: {
            planId: planId,
            backupName: archiveName,
            backupType: 'FULL',
            category: category,
            status: instanceStatus,
            fileSizeBytes: archiveSizeBytes,
            sha256: archiveSha256,
            storagePath: finalArchivePath,
            storageProvider: 'LOCAL',
            systemVersion: process.env.APP_VERSION ?? 'unknown',
            databaseSchemaVersion: dbSchemaVersion,
            containsDatabase: true,
            containsMedia: mediaResult.details.filesExpected > 0,
            containsConfiguration: configResult.details.files.length > 0,
            dbSizeBytes: dbResult.sizeBytes,
            mediaFilesCount: mediaResult.details.filesExpected,
            mediaFilesCopied: mediaResult.details.filesCopied,
            mediaSizeBytes: mediaResult.sizeBytes,
            configSizeBytes: configResult.sizeBytes,
            missingMedia:
              mediaResult.details.missingStorageKeys.length > 0
                ? mediaResult.details.missingStorageKeys
                : undefined,
          },
        });

        await tx.backupJob.update({
          where: { id: jobId },
          data: {
            status: 'COMPLETED',
            backupInstanceId: instance.id,
            finishedAt: new Date(),
          },
        });
      });

      // ── 11. CLEANUP ──
      await this.storage.deleteDirectory(workDir);

      await this.backupLogger.info(
        jobId,
        'CLEANUP',
        'Temporary files cleaned up',
      );

      this.logger.log(
        `✅ Backup completed: ${archiveName} (${instanceStatus})`,
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Pipeline failed for job ${job.uuid}: ${errorMsg}`,
      );
      await this.failJob(jobId, errorMsg, workDir);
    }
  }

  /**
   * تسجيل فشل Job وتنظيف الملفات المؤقتة
   */
  private async failJob(
    jobId: number,
    errorMessage: string,
    workDir?: string,
  ): Promise<void> {
    await this.prisma.backupJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage,
        finishedAt: new Date(),
      },
    });

    await this.backupLogger.error(jobId, 'CLEANUP', errorMessage);

    // تنظيف الملفات المؤقتة
    if (workDir) {
      try {
        await this.storage.deleteDirectory(workDir);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  /**
   * بناء manifest.json
   */
  private buildManifest(
    backupId: string,
    category: BackupCategory,
    triggerType: BackupTriggerType,
    dbResult: DatabaseBackupResult,
    mediaResult: MediaBackupResult,
    configResult: ConfigBackupResult,
    consistencyStatus: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED',
  ): BackupManifest {
    // حساب checksums لكل ملف مهم
    const checksums: Record<string, string> = {};

    if (dbResult.success) {
      checksums['database/postgres.sql.gz'] =
        `sha256:${dbResult.details.sha256}`;
    }

    return {
      backupId,
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: process.env.APP_VERSION ?? 'unknown',
      databaseSchemaVersion: null, // يُحدّث لاحقاً بعد query
      backupType: 'FULL',
      triggerType,
      category,
      components: {
        database: dbResult.success
          ? {
              included: true,
              engine: 'pg_dump',
              format: 'sql.gz',
              file: 'database/postgres.sql.gz',
              sizeBytes: Number(dbResult.sizeBytes),
              sha256: dbResult.details.sha256,
            }
          : null,
        media: mediaResult.success
          ? {
              included: true,
              directory: 'media/',
              filesExpected: mediaResult.details.filesExpected,
              filesCopied: mediaResult.details.filesCopied,
              sizeBytes: Number(mediaResult.sizeBytes),
            }
          : null,
        config: configResult.success
          ? {
              included: true,
              directory: 'config/',
              files: configResult.details.files,
              sizeBytes: Number(configResult.sizeBytes),
            }
          : null,
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: consistencyStatus,
        missingStorageKeys: mediaResult.details?.missingStorageKeys ?? [],
      },
      checksums,
    };
  }

  /**
   * حساب SHA-256 لملف
   */
  private computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * الحصول على الخطة الافتراضية أو إنشاؤها
   */
  private async getDefaultPlan() {
    let plan = await this.prisma.backupPlan.findFirst({
      where: { enabled: true },
    });

    if (!plan) {
      plan = await this.prisma.backupPlan.create({
        data: {
          name: 'Default Backup Plan',
          enabled: true,
          scheduleType: 'DAILY',
          runTime: '02:00',
          timezone: 'Asia/Aden',
        },
      });
    }

    return plan;
  }
}
