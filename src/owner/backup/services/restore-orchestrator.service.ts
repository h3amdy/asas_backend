// src/owner/backup/services/restore-orchestrator.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { STORAGE_DIRS } from '../storage/storage-provider.interface';
import { BackupLoggerService } from './backup-logger.service';
import { BackupOrchestratorService } from './backup-orchestrator.service';
import { DbRestoreEngine } from '../engines/db-restore.engine';
import { BackupManifest } from '../types/manifest.type';
import { RestoreJobStatus } from '@prisma/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

/** الإصدارات المدعومة لصيغة حزمة النسخ (قابل للتوسيع مستقبلاً) */
const SUPPORTED_FORMAT_VERSIONS = ['1.0'];

/** مهلة انتظار Safety Backup (ms) — قابلة للتعديل */
const SAFETY_BACKUP_TIMEOUT_MS = 300_000; // 5 دقائق

/**
 * منسق عمليات الاستعادة (BKP-001 Phase 4)
 *
 * Pipeline:
 * 1. VALIDATE       → التحقق من سلامة الحزمة
 * 2. SAFETY_BACKUP  → نسخة أمان (DEC-013)
 * 3. EXTRACT        → فك الأرشيف
 * 4. VERIFY_MANIFEST→ مطابقة checksums
 * 5. RESTORE_DB     → استعادة قاعدة البيانات ⚠️ نقطة اللا-رجوع
 * 6. RESTORE_MEDIA  → استعادة الوسائط (اختيارية)
 * 7. RESTORE_CONFIG → استعادة الإعدادات (اختيارية)
 * 8. POST_VERIFY    → التحقق بعد الاستعادة
 * 9. CLEANUP        → تنظيف
 */
@Injectable()
export class RestoreOrchestratorService {
  private readonly logger = new Logger(RestoreOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageProvider,
    private readonly backupLogger: BackupLoggerService,
    private readonly backupOrchestrator: BackupOrchestratorService,
    private readonly dbRestoreEngine: DbRestoreEngine,
  ) {}

  /**
   * بدء عملية استعادة
   */
  async startRestore(params: {
    backupInstanceId: number;
    restoreDatabase: boolean;
    restoreMedia: boolean;
    restoreConfiguration: boolean;
    initiatedByUserUuid: string;
  }): Promise<{ jobUuid: string }> {
    // ⚠️ حماية من Race Condition (مثل Backup)
    const job = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(8675309)`;

      const runningBackup = await tx.backupJob.findFirst({
        where: { status: 'RUNNING' },
      });
      if (runningBackup) {
        throw new Error('BACKUP_ALREADY_RUNNING');
      }

      const runningRestore = await tx.restoreJob.findFirst({
        where: { status: 'RUNNING' },
      });
      if (runningRestore) {
        throw new Error('RESTORE_ALREADY_RUNNING');
      }

      return tx.restoreJob.create({
        data: {
          backupInstanceId: params.backupInstanceId,
          restoreDatabase: params.restoreDatabase,
          restoreMedia: params.restoreMedia,
          restoreConfiguration: params.restoreConfiguration,
          initiatedByUserUuid: params.initiatedByUserUuid,
          status: 'PENDING',
        },
      });
    });

    // تشغيل Pipeline في الخلفية
    this.runPipeline(job.id, params).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Restore pipeline crashed for job ${job.uuid}: ${msg}`,
      );
    });

    return { jobUuid: job.uuid };
  }

  /**
   * Pipeline الاستعادة الكامل
   */
  private async runPipeline(
    jobId: number,
    params: {
      backupInstanceId: number;
      restoreDatabase: boolean;
      restoreMedia: boolean;
      restoreConfiguration: boolean;
    },
  ): Promise<void> {
    const job = await this.prisma.restoreJob.findUnique({
      where: { id: jobId },
    });
    if (!job) return;

    const instance = await this.prisma.backupInstance.findUnique({
      where: { id: params.backupInstanceId },
    });
    if (!instance) {
      await this.failJob(jobId, 'Backup instance not found');
      return;
    }

    const defaultStoragePath = path.resolve(
      process.env.BACKUP_STORAGE_PATH || './backups',
    );
    const parentStorageDir = path.dirname(path.dirname(instance.storagePath));
    const storagePath =
      parentStorageDir && parentStorageDir !== '/var/backups'
        ? parentStorageDir
        : defaultStoragePath;
    const workDir = path.join(
      storagePath,
      STORAGE_DIRS.TEMP,
      `restore-${job.uuid}`,
    );

    try {
      await this.prisma.restoreJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      // ── 1. VALIDATE ──
      const validateStart = Date.now();
      await this.validateArchive(instance.storagePath, instance.sha256);
      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'INFO',
        phase: 'RESTORE_VALIDATE',
        message: 'Archive validation passed',
        durationMs: Date.now() - validateStart,
      });

      // ── 2. SAFETY BACKUP (DEC-013) ──
      let safetyBackupId: number | null = null;
      if (params.restoreDatabase) {
        const safetyStart = Date.now();
        this.logger.log('Creating safety backup before restore...');

        try {
          const safetyResult = await this.backupOrchestrator.startBackup(
            {
              triggeredBy: 'PRE_RESTORE',
              category: 'SYSTEM_SAFETY',
            },
          );

          // انتظار اكتمال Safety Backup
          safetyBackupId = await this.waitForBackupCompletion(
            safetyResult.jobUuid,
            SAFETY_BACKUP_TIMEOUT_MS,
          );

          if (!safetyBackupId) {
            throw new Error('Safety backup did not complete in time');
          }

          // تثبيت Safety Backup تلقائياً
          await this.prisma.backupInstance.update({
            where: { id: safetyBackupId },
            data: { isPinned: true },
          });

          // ربط Safety Backup بالـ Restore Job
          await this.prisma.restoreJob.update({
            where: { id: jobId },
            data: { safetyBackupId },
          });

          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'INFO',
            phase: 'RESTORE_SAFETY',
            message: 'Safety backup created and pinned',
            durationMs: Date.now() - safetyStart,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'ERROR',
            phase: 'RESTORE_SAFETY',
            message: `Safety backup failed: ${msg}`,
            durationMs: Date.now() - safetyStart,
          });
          await this.failJob(jobId, `Safety backup failed: ${msg}`);
          return;
        }
      }

      // ── 3. EXTRACT ──
      const extractStart = Date.now();
      await this.storage.ensureDirectory(workDir);
      await execFileAsync('tar', [
        '-xzf',
        instance.storagePath,
        '-C',
        workDir,
      ]);
      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'INFO',
        phase: 'RESTORE_VALIDATE',
        message: 'Archive extracted',
        durationMs: Date.now() - extractStart,
      });

      // ── 4. VERIFY MANIFEST ──
      const manifestPath = path.join(workDir, 'manifest.json');
      const manifestRaw = await fsp.readFile(manifestPath, 'utf-8');
      const manifest: BackupManifest = JSON.parse(manifestRaw);

      // التحقق من إصدار صيغة الحزمة
      if (!manifest.backupFormatVersion) {
        await this.failJob(jobId, 'Invalid manifest: missing format version', workDir);
        return;
      }
      if (!SUPPORTED_FORMAT_VERSIONS.includes(manifest.backupFormatVersion)) {
        await this.failJob(
          jobId,
          `Unsupported backup format: ${manifest.backupFormatVersion} (supported: ${SUPPORTED_FORMAT_VERSIONS.join(', ')})`,
          workDir,
        );
        return;
      }

      // مطابقة checksum الـ DB
      if (
        params.restoreDatabase &&
        manifest.components.database?.sha256
      ) {
        const dbFile = path.join(
          workDir,
          manifest.components.database.file,
        );
        const actualSha = await this.computeFileSha256(dbFile);
        if (actualSha !== manifest.components.database.sha256) {
          await this.failJob(
            jobId,
            'Database checksum mismatch — archive may be corrupted',
            workDir,
          );
          return;
        }
      }

      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'INFO',
        phase: 'RESTORE_VALIDATE',
        message: 'Manifest verified',
      });

      // ── 5. RESTORE DB ⚠️ نقطة اللا-رجوع ──
      if (params.restoreDatabase && manifest.components.database) {
        const dbStart = Date.now();
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          await this.failJob(
            jobId,
            'DATABASE_URL not configured',
            workDir,
          );
          return;
        }

        const dbFile = path.join(
          workDir,
          manifest.components.database.file,
        );

        this.logger.warn(
          '⚠️ DATABASE RESTORE — POINT OF NO RETURN',
        );
        const dbResult = await this.dbRestoreEngine.execute(
          dbFile,
          databaseUrl,
        );

        await this.backupLogger.writeLog({
          restoreJobId: jobId,
          level: dbResult.success ? 'INFO' : 'ERROR',
          phase: 'RESTORE_DB',
          message: dbResult.success
            ? 'Database restored successfully'
            : `Database restore failed: ${dbResult.errorMessage}`,
          durationMs: Date.now() - dbStart,
        });

        if (!dbResult.success) {
          // تصنيف سبب الفشل: بيئة (psql/permissions) أم بيانات (corrupt dump)
          const errorMsg = dbResult.errorMessage ?? '';
          const isEnvironmentError =
            errorMsg.includes('not found') ||
            errorMsg.includes('ENOENT') ||
            errorMsg.includes('permission denied') ||
            errorMsg.includes('authentication failed') ||
            errorMsg.includes('could not connect');

          if (isEnvironmentError) {
            // ⛔ فشل بيئي — Rollback لن ينجح أيضاً
            this.logger.error(
              'Database restore failed due to environment error — skipping rollback',
            );
            await this.failJob(
              jobId,
              `Database restore failed (environment): ${errorMsg}. Safety backup available (id: ${safetyBackupId}).`,
              workDir,
            );
          } else {
            // ⚠️ فشل بيانات — يمكن محاولة Rollback
            this.logger.error(
              'Database restore failed — attempting rollback from safety backup',
            );
            await this.attemptRollback(jobId, safetyBackupId, workDir);
          }
          return;
        }
      }

      // ── 6. RESTORE MEDIA ──
      if (params.restoreMedia && manifest.components.media) {
        const mediaStart = Date.now();
        const mediaBasePath =
          path.resolve(process.env.MEDIA_STORAGE_PATH ?? './storage');
        const mediaDir = path.join(
          workDir,
          manifest.components.media.directory,
        );

        try {
          let filesCopied = 0;
          const mediaFiles = await this.listFilesRecursive(mediaDir);

          for (const relPath of mediaFiles) {
            // ⚠️ حماية Path Traversal
            const resolvedDest = path.resolve(mediaBasePath, relPath);
            if (!resolvedDest.startsWith(mediaBasePath)) {
              this.logger.warn(
                `Path traversal blocked in media restore: ${relPath}`,
              );
              continue;
            }

            const src = path.join(mediaDir, relPath);
            await fsp.mkdir(path.dirname(resolvedDest), { recursive: true });
            await fsp.copyFile(src, resolvedDest);
            filesCopied++;
          }

          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'INFO',
            phase: 'RESTORE_MEDIA',
            message: `Media restored: ${filesCopied} files`,
            durationMs: Date.now() - mediaStart,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'WARN',
            phase: 'RESTORE_MEDIA',
            message: `Media restore partial: ${msg}`,
            durationMs: Date.now() - mediaStart,
          });
          // لا نتوقف — الوسائط الناقصة لا تكسر النظام
        }
      }

      // ── 7. RESTORE CONFIG ──
      if (
        params.restoreConfiguration &&
        manifest.components.config
      ) {
        const configStart = Date.now();
        const configDir = path.join(
          workDir,
          manifest.components.config.directory,
        );
        const projectRoot =
          process.env.PROJECT_ROOT ??
          path.resolve(__dirname, '../../../../');

        try {
          for (const fileName of manifest.components.config.files) {
            const src = path.join(configDir, fileName);
            let dest: string;

            if (fileName === 'nginx.conf') {
              dest = '/etc/nginx/sites-available/asas';
            } else {
              dest = path.join(projectRoot, fileName);
            }

            try {
              await fsp.copyFile(src, dest);
              this.logger.log(`Config restored: ${fileName}`);
            } catch (error) {
              const msg =
                error instanceof Error
                  ? error.message
                  : String(error);
              this.logger.warn(
                `Config restore skipped ${fileName}: ${msg}`,
              );
            }
          }

          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'INFO',
            phase: 'RESTORE_CONFIG',
            message: `Config restored`,
            durationMs: Date.now() - configStart,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'WARN',
            phase: 'RESTORE_CONFIG',
            message: `Config restore failed: ${msg}`,
            durationMs: Date.now() - configStart,
          });
        }
      }

      // ── 8. POST VERIFY ──
      const verifyStart = Date.now();
      try {
        // التحقق من أن DB تعمل + البيانات موجودة فعلاً
        const migrationCheck = await this.prisma.$queryRaw<
          { migration_name: string }[]
        >`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`;

        const migrationName =
          migrationCheck?.[0]?.migration_name ?? 'unknown';

        await this.backupLogger.writeLog({
          restoreJobId: jobId,
          level: 'INFO',
          phase: 'RESTORE_VERIFY',
          message: `Post-restore verification passed (latest migration: ${migrationName})`,
          durationMs: Date.now() - verifyStart,
        });
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error);
        await this.backupLogger.writeLog({
          restoreJobId: jobId,
          level: 'WARN',
          phase: 'RESTORE_VERIFY',
          message: `Post-restore verification failed: ${msg}`,
          durationMs: Date.now() - verifyStart,
        });
      }

      // ── 9. CLEANUP + SUCCESS ──
      await this.storage.deleteDirectory(workDir);

      await this.prisma.restoreJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
        },
      });

      // تحديث النسخة — تم استخدامها
      await this.prisma.backupInstance.update({
        where: { id: params.backupInstanceId },
        data: { lastRestoredAt: new Date() },
      });

      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'INFO',
        phase: 'CLEANUP',
        message: 'Restore completed successfully',
      });

      this.logger.log('✅ Restore completed successfully');
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Restore pipeline failed: ${msg}`,
      );
      await this.failJob(jobId, msg, workDir);
    }
  }

  // ══════════════════════════════════════════════
  // ──  HELPER METHODS
  // ══════════════════════════════════════════════

  /**
   * التحقق من سلامة الأرشيف
   */
  private async validateArchive(
    archivePath: string,
    expectedSha256: string,
  ): Promise<void> {
    // وجود الملف
    await fsp.access(archivePath);

    // المستوى 1: فحص وجود .sha256 file (كشف تلف الأرشيف قبل فك الضغط)
    const checksumFile = `${archivePath}.sha256`;
    try {
      const storedChecksum = (await fsp.readFile(checksumFile, 'utf-8')).trim();
      if (storedChecksum !== expectedSha256) {
        throw new Error(
          `Checksum file mismatch: .sha256 file says ${storedChecksum.slice(0, 16)}..., DB says ${expectedSha256.slice(0, 16)}...`,
        );
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === 'ENOENT') {
        // .sha256 مفقود — نحذر لكن نكمل (backward compatibility)
        this.logger.warn('Checksum file not found — relying on DB checksum only');
      } else {
        throw error;
      }
    }

    // المستوى 2: مطابقة SHA-256 الفعلية
    const actualSha256 = await this.computeFileSha256(archivePath);
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Archive checksum mismatch: expected ${expectedSha256.slice(0, 16)}..., got ${actualSha256.slice(0, 16)}...`,
      );
    }
  }

  /**
   * انتظار اكتمال عملية نسخ (Safety Backup)
   * @returns BackupInstance ID أو null إذا انتهى الوقت
   */
  private async waitForBackupCompletion(
    jobUuid: string,
    timeoutMs: number,
  ): Promise<number | null> {
    const startTime = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - startTime < timeoutMs) {
      const job = await this.prisma.backupJob.findUnique({
        where: { uuid: jobUuid },
      });

      if (!job) return null;

      if (job.status === 'COMPLETED' && job.backupInstanceId) {
        return job.backupInstanceId;
      }

      if (job.status === 'FAILED') {
        throw new Error(
          `Safety backup failed: ${job.errorMessage ?? 'unknown'}`,
        );
      }

      // انتظار قبل المحاولة التالية
      await new Promise((resolve) =>
        setTimeout(resolve, pollIntervalMs),
      );
    }

    return null; // timeout
  }

  /**
   * محاولة Rollback من Safety Backup
   */
  private async attemptRollback(
    jobId: number,
    safetyBackupId: number | null,
    workDir?: string,
  ): Promise<void> {
    if (!safetyBackupId) {
      await this.prisma.restoreJob.update({
        where: { id: jobId },
        data: {
          status: 'CRITICAL_FAILURE',
          errorMessage:
            'Database restore failed and no safety backup available for rollback',
          finishedAt: new Date(),
        },
      });
      return;
    }

    try {
      this.logger.warn('🔄 Attempting rollback from safety backup...');

      const safetyInstance = await this.prisma.backupInstance.findUnique(
        { where: { id: safetyBackupId } },
      );

      if (!safetyInstance) {
        throw new Error('Safety backup instance not found');
      }

      // فك الأرشيف واستعادة DB فقط
      const rollbackDir = workDir
        ? `${workDir}-rollback`
        : `/tmp/restore-rollback-${Date.now()}`;
      await this.storage.ensureDirectory(rollbackDir);

      await execFileAsync('tar', [
        '-xzf',
        safetyInstance.storagePath,
        '-C',
        rollbackDir,
      ]);

      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL not configured for rollback');
      }

      const rollbackManifest: BackupManifest = JSON.parse(
        await fsp.readFile(
          path.join(rollbackDir, 'manifest.json'),
          'utf-8',
        ),
      );

      if (!rollbackManifest.components.database) {
        throw new Error('Safety backup has no database component');
      }

      const dbFile = path.join(
        rollbackDir,
        rollbackManifest.components.database.file,
      );
      const rollbackResult = await this.dbRestoreEngine.execute(
        dbFile,
        databaseUrl,
      );

      // تنظيف
      await this.storage.deleteDirectory(rollbackDir);

      if (rollbackResult.success) {
        await this.backupLogger.writeLog({
          restoreJobId: jobId,
          level: 'WARN',
          phase: 'RESTORE_ROLLBACK',
          message: 'Rollback from safety backup succeeded',
          durationMs: rollbackResult.durationMs,
        });

        await this.prisma.restoreJob.update({
          where: { id: jobId },
          data: {
            status: 'ROLLBACK_COMPLETED',
            errorMessage: 'Restore failed — rolled back to safety backup',
            finishedAt: new Date(),
          },
        });
      } else {
        throw new Error(
          `Rollback failed: ${rollbackResult.errorMessage}`,
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`⛔ CRITICAL: Rollback failed: ${msg}`);

      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'ERROR',
        phase: 'RESTORE_ROLLBACK',
        message: `CRITICAL — Rollback failed: ${msg}`,
      });

      await this.prisma.restoreJob.update({
        where: { id: jobId },
        data: {
          status: 'CRITICAL_FAILURE',
          errorMessage: `Restore and rollback both failed: ${msg}`,
          finishedAt: new Date(),
        },
      });
    }

    // تنظيف workDir الأصلي
    if (workDir) {
      try {
        await this.storage.deleteDirectory(workDir);
      } catch {
        // ignore
      }
    }
  }

  /**
   * تسجيل فشل Job
   */
  private async failJob(
    jobId: number,
    errorMessage: string,
    workDir?: string,
  ): Promise<void> {
    await this.prisma.restoreJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        errorMessage,
        finishedAt: new Date(),
      },
    });

    await this.backupLogger.writeLog({
      restoreJobId: jobId,
      level: 'ERROR',
      phase: 'CLEANUP',
      message: errorMessage,
    });

    if (workDir) {
      try {
        await this.storage.deleteDirectory(workDir);
      } catch {
        // ignore
      }
    }
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
   * سرد الملفات في مجلد بشكل متكرر (recursive)
   */
  private async listFilesRecursive(
    dirPath: string,
    basePath?: string,
  ): Promise<string[]> {
    const base = basePath ?? dirPath;
    const files: string[] = [];

    try {
      const entries = await fsp.readdir(dirPath, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.listFilesRecursive(
            fullPath,
            base,
          );
          files.push(...subFiles);
        } else {
          files.push(path.relative(base, fullPath));
        }
      }
    } catch {
      // مجلد فارغ أو غير موجود
    }

    return files;
  }
}
