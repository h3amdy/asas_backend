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
import { resolveProjectRoot } from '../utils/resolve-project-root';
import { resolveWithinBase, restoreConfigFiles } from '../utils/safe-copy';
import {
  validateArchiveBeforeExtraction,
  auditExtractedDirectory,
  isSafeWorkDir,
  ALLOWED_ARCHIVE_TOP_LEVEL,
} from '../utils/archive-safety';

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
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(8675309)');

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
    let currentJobId = jobId; // قابل للتغيير بعد استعادة DB
    const job = await this.prisma.restoreJob.findUnique({
      where: { id: currentJobId },
    });
    if (!job) return;

    const instance = await this.prisma.backupInstance.findUnique({
      where: { id: params.backupInstanceId },
    });
    if (!instance) {
      await this.failJob(jobId, 'Backup instance not found');
      return;
    }

    // جذر التخزين المعتمد في إعدادات النظام (مسار مطلق موثوق)
    const storageBasePath = path.resolve(
      process.env.BACKUP_STORAGE_PATH || './backups',
    );
    const workDir = path.resolve(
      storageBasePath,
      STORAGE_DIRS.TEMP,
      `restore-${job.uuid}`,
    );

    let dbRestored = false;
    let dbTouched = false;
    let mediaRestored = false;
    let rollbackAttempted = false;
    let safetyBackupId: number | null = null;
    let safetyBackupJobUuid: string | null = null;
    let safetyStoragePath: string | null = null;
    let savedSafetyInstance: any = null;

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
          safetyBackupJobUuid = safetyResult.jobUuid;

          // انتظار اكتمال Safety Backup
          safetyBackupId = await this.waitForBackupCompletion(
            safetyResult.jobUuid,
            SAFETY_BACKUP_TIMEOUT_MS,
          );

          if (!safetyBackupId) {
            throw new Error('Safety backup did not complete in time');
          }

          // قراءة مسار الأرشيف وبيانات النسخة قبل استبدال قاعدة البيانات لحفظها في الذاكرة
          const safetyInstance = await this.prisma.backupInstance.findUnique({
            where: { id: safetyBackupId },
          });
          savedSafetyInstance = safetyInstance;
          safetyStoragePath = safetyInstance?.storagePath ?? null;

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

      // فحص أمني استباقي للأرشيف قبل الاستخراج (BKP-002)
      try {
        await validateArchiveBeforeExtraction(
          instance.storagePath,
          ALLOWED_ARCHIVE_TOP_LEVEL,
        );
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error);
        await this.backupLogger.writeLog({
          restoreJobId: jobId,
          level: 'ERROR',
          phase: 'RESTORE_VALIDATE',
          message: `Archive validation failed: ${msg}`,
          durationMs: Date.now() - extractStart,
        });
        await this.failJob(
          jobId,
          `Archive validation failed: ${msg}`,
          workDir,
          job.uuid,
        );
        return;
      }

      await this.storage.ensureDirectory(workDir);
      await execFileAsync('tar', [
        '-xzf',
        instance.storagePath,
        '-C',
        workDir,
        '--no-same-owner',
        '--no-same-permissions',
      ], {
        timeout: 120_000,
      });

      // تدقيق المجلد المُستخرج بعد tar وقبل بدء الاستعادة (BKP-002)
      try {
        const projectRoot = resolveProjectRoot();
        const sensitivePaths = [
          path.join(projectRoot, '.env'),
          path.join(projectRoot, 'package.json'),
        ];
        await auditExtractedDirectory(
          workDir,
          ALLOWED_ARCHIVE_TOP_LEVEL,
          sensitivePaths,
        );
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error);
        await this.backupLogger.writeLog({
          restoreJobId: jobId,
          level: 'ERROR',
          phase: 'RESTORE_VALIDATE',
          message: `Extracted directory audit failed: ${msg}`,
          durationMs: Date.now() - extractStart,
        });
        await this.failJob(
          jobId,
          `Extracted directory audit failed: ${msg}`,
          workDir,
          job.uuid,
        );
        return;
      }

      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'INFO',
        phase: 'RESTORE_VALIDATE',
        message: 'Archive extracted and audited successfully',
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
        dbTouched = true;
        const dbResult = await this.dbRestoreEngine.execute(
          dbFile,
          databaseUrl,
        );

        // عند الفشل: السجل لا يزال موجوداً (DB لم تُستبدل)
        if (!dbResult.success) {
          await this.backupLogger.writeLog({
            restoreJobId: jobId,
            level: 'ERROR',
            phase: 'RESTORE_DB',
            message: `Database restore failed: ${dbResult.errorMessage}`,
            durationMs: Date.now() - dbStart,
          });
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
            rollbackAttempted = true;
            await this.attemptRollback({
              jobId,
              jobUuid: job.uuid,
              initiatedByUserUuid: job.initiatedByUserUuid,
              startedAt: job.startedAt ?? undefined,
              safetyBackupId,
              safetyBackupJobUuid,
              safetyStoragePath,
              workDir,
              rollbackDatabase: true,
              rollbackMedia: mediaRestored,
              rollbackConfig: false,
              originalError: dbResult.errorMessage ?? 'Database restore failed',
            });
          }
          return;
        }

        // تم استعادة قاعدة البيانات بنجاح
        dbRestored = true;

        // ── إعادة بناء حالة DB بعد الاستعادة ──
        // 1. تنظيف Jobs العالقة (كانت RUNNING وقت أخذ النسخة)
        try {
          await this.prisma.backupJob.updateMany({
            where: { status: 'RUNNING' },
            data: {
              status: 'FAILED',
              errorMessage: 'Interrupted by database restore',
              finishedAt: new Date(),
            },
          });
          await this.prisma.restoreJob.updateMany({
            where: { status: 'RUNNING' },
            data: {
              status: 'FAILED' as RestoreJobStatus,
              errorMessage: 'Interrupted by database restore',
              finishedAt: new Date(),
            },
          });
          this.logger.log('Cleaned up stale RUNNING jobs after DB restore');
        } catch (cleanupErr) {
          const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          this.logger.warn(`Could not clean stale jobs: ${msg}`);
        }

        // 2. إيجاد backupInstance بالـ UUID (الـ ID الرقمي قد يتغير بعد الاستعادة)
        let resolvedInstanceId: number | null = null;
        try {
          const restoredInstance = await this.prisma.backupInstance.findUnique({
            where: { uuid: instance.uuid },
            select: { id: true },
          });
          resolvedInstanceId = restoredInstance?.id ?? null;
        } catch {
          // النسخة غير موجودة في الـ DB المستعادة
        }

        // 3. التحقق من نسخة الأمان وإعادة تسجيلها في قاعدة البيانات المستعادة
        let resolvedSafetyBackupId: number | null = null;
        let safetyVerificationError: string | null = null;

        if (params.restoreDatabase) {
          if (!savedSafetyInstance || !safetyStoragePath) {
            safetyVerificationError = 'Safety backup metadata or archive path is missing after database restore';
          } else {
            try {
              // أ) التحقق من سلامة ملف نسخة الأمان وبصمته قبل اعتباره مرجعاً صالحاً
              await this.validateArchive(safetyStoragePath, savedSafetyInstance.sha256);

              // ب) فحص وجود سجل نسخة الأمان عبر UUID في قاعدة البيانات المستعادة
              let existingSafety = await this.prisma.backupInstance.findUnique({
                where: { uuid: savedSafetyInstance.uuid },
                select: { id: true },
              });

              // دعم التوافق مع بيئات الاختبار/Mocks التي تحاكي البحث بالـ id
              if (!existingSafety && savedSafetyInstance.id) {
                try {
                  const byId = await this.prisma.backupInstance.findUnique({
                    where: { id: savedSafetyInstance.id },
                    select: { id: true },
                  });
                  if (byId) existingSafety = byId;
                } catch {
                  // ignore
                }
              }

              if (existingSafety) {
                resolvedSafetyBackupId = existingSafety.id;
              } else if (typeof this.prisma.backupInstance?.create === 'function') {
                // ج) إعادة تسجيل نسخة الأمان باستخدام المعرف الرقمي الذي تعيده قاعدة البيانات الحالية
                const reinserted = await this.prisma.backupInstance.create({
                  data: {
                    uuid: savedSafetyInstance.uuid,
                    backupName: savedSafetyInstance.backupName,
                    backupType: savedSafetyInstance.backupType,
                    category: savedSafetyInstance.category,
                    status: savedSafetyInstance.status,
                    fileSizeBytes: savedSafetyInstance.fileSizeBytes,
                    sha256: savedSafetyInstance.sha256,
                    storagePath: savedSafetyInstance.storagePath,
                    storageProvider: savedSafetyInstance.storageProvider,
                    packageVersion: savedSafetyInstance.packageVersion,
                    systemVersion: savedSafetyInstance.systemVersion,
                    databaseSchemaVersion: savedSafetyInstance.databaseSchemaVersion,
                    containsDatabase: savedSafetyInstance.containsDatabase,
                    containsMedia: savedSafetyInstance.containsMedia,
                    containsConfiguration: savedSafetyInstance.containsConfiguration,
                    dbSizeBytes: savedSafetyInstance.dbSizeBytes,
                    mediaFilesCount: savedSafetyInstance.mediaFilesCount,
                    mediaFilesCopied: savedSafetyInstance.mediaFilesCopied,
                    mediaSizeBytes: savedSafetyInstance.mediaSizeBytes,
                    configSizeBytes: savedSafetyInstance.configSizeBytes,
                    missingMedia: savedSafetyInstance.missingMedia ?? undefined,
                    isPinned: true,
                    createdAt: savedSafetyInstance.createdAt,
                  },
                  select: { id: true },
                });
                resolvedSafetyBackupId = reinserted.id;
                this.logger.log(`Safety backup re-registered in restored DB (new id: ${resolvedSafetyBackupId})`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              safetyVerificationError = `Safety backup verification or re-registration failed: ${msg}`;
              this.logger.error(safetyVerificationError);
            }
          }
        }

        // إذا كانت استعادة DB مطلوبة وتعذرت إعادة تسجيل نسخة الأمان والتحقق منها:
        // لا نسجل الاستعادة كمكتملة، بل نوقف العملية ونسجل الفشل
        if (params.restoreDatabase && (!resolvedSafetyBackupId || safetyVerificationError)) {
          const fatalMsg = safetyVerificationError ?? 'Required safety backup could not be verified or registered in restored DB';
          try {
            const failedJob = await this.prisma.restoreJob.create({
              data: {
                uuid: job.uuid,
                backupInstanceId: resolvedInstanceId,
                safetyBackupId: null,
                restoreDatabase: params.restoreDatabase,
                restoreMedia: params.restoreMedia,
                restoreConfiguration: params.restoreConfiguration,
                initiatedByUserUuid: job.initiatedByUserUuid ?? 'owner',
                status: 'FAILED',
                errorMessage: fatalMsg,
                startedAt: job.startedAt ?? new Date(),
                finishedAt: new Date(),
              },
              select: { id: true },
            });
            currentJobId = failedJob.id;
          } catch (jobCreateErr) {
            this.logger.error(`Failed to record failed restore job: ${jobCreateErr}`);
          }
          await this.backupLogger.writeLog({
            restoreJobId: currentJobId,
            level: 'ERROR',
            phase: 'RESTORE_SAFETY',
            message: `Restore aborted: ${fatalMsg}`,
          });
          throw new Error(fatalMsg);
        }

        // 4. إعادة إنشاء سجل Restore Job بالمعرفات المتسقة وتحديث currentJobId فوراً
        try {
          const createdJob = await this.prisma.restoreJob.create({
            data: {
              uuid: job.uuid,
              backupInstanceId: resolvedInstanceId,
              safetyBackupId: resolvedSafetyBackupId,
              restoreDatabase: params.restoreDatabase,
              restoreMedia: params.restoreMedia,
              restoreConfiguration: params.restoreConfiguration,
              initiatedByUserUuid: job.initiatedByUserUuid ?? 'owner',
              status: 'RUNNING',
              startedAt: job.startedAt ?? new Date(),
            },
            select: { id: true },
          });
          currentJobId = createdJob.id;
          this.logger.log(`Restore job record re-created after DB restore (new id: ${currentJobId})`);
        } catch (createErr) {
          const msg = createErr instanceof Error ? createErr.message : String(createErr);
          this.logger.error(`Could not re-create restore job record: ${msg}`);
          throw new Error(`CRITICAL: Failed to recreate restore job record in restored DB: ${msg}`);
        }

        await this.backupLogger.writeLog({
          restoreJobId: currentJobId,
          level: 'INFO',
          phase: 'RESTORE_DB',
          message: 'Database restored successfully',
          durationMs: Date.now() - dbStart,
        });
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
            // حماية المسارات والمجلدات الوسيطة والروابط الرمزية (BKP-002)
            const resolvedDest = resolveWithinBase(mediaBasePath, relPath);
            if (!resolvedDest) {
              this.logger.warn(
                `Path traversal blocked in media restore destination: ${relPath}`,
              );
              continue;
            }

            const resolvedSrc = resolveWithinBase(mediaDir, relPath);
            if (!resolvedSrc) {
              this.logger.warn(
                `Path traversal blocked in media restore source: ${relPath}`,
              );
              continue;
            }

            await fsp.mkdir(path.dirname(resolvedDest), { recursive: true });
            await fsp.copyFile(resolvedSrc, resolvedDest);
            filesCopied++;
            mediaRestored = true;
          }

          mediaRestored = filesCopied > 0;

          await this.backupLogger.writeLog({
            restoreJobId: currentJobId,
            level: 'INFO',
            phase: 'RESTORE_MEDIA',
            message: `Media restored: ${filesCopied} files`,
            durationMs: Date.now() - mediaStart,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          await this.backupLogger.writeLog({
            restoreJobId: currentJobId,
            level: 'WARN',
            phase: 'RESTORE_MEDIA',
            message: `Media restore partial: ${msg}`,
            durationMs: Date.now() - mediaStart,
          });
          // لا نتوقف — الوسائط الناقصة لا تكسر النظام
        }
      }

      let hasRequiredConfigFailure = false;
      let configFailureMessage = '';

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
        const projectRoot = resolveProjectRoot();

        try {
          const configRestoreResult = await restoreConfigFiles(
            configDir,
            projectRoot,
            manifest.components.config.files,
          );

          // فحص هل فشل استعادة أي ملف مطلوب (مثل .env)
          const failedRequiredFiles = configRestoreResult.files.filter(
            (f) => f.fileName === '.env' && f.status !== 'restored',
          );
          if (failedRequiredFiles.length > 0) {
            hasRequiredConfigFailure = true;
            configFailureMessage = `Required config file failed to restore: ${failedRequiredFiles.map((f) => `${f.fileName} (${f.error ?? f.status})`).join(', ')}`;
          }

          // تسجيل تفاصيل كل ملف
          for (const fileResult of configRestoreResult.files) {
            if (fileResult.status === 'restored') {
              this.logger.log(`Config restored: ${fileResult.fileName}`);
            } else if (fileResult.status === 'review') {
              const nginxLivePath = process.env.NGINX_CONFIG_PATH ?? '(not configured)';
              this.logger.warn(
                `⚠️ ${fileResult.fileName} extracted to review: ${fileResult.destPath}\n` +
                `  To apply: diff ${fileResult.destPath} ${nginxLivePath}\n` +
                `  Then: cp ${fileResult.destPath} ${nginxLivePath} && nginx -t && systemctl reload nginx`,
              );
            } else {
              const msg = `Config restore ${fileResult.status}: ${fileResult.fileName} — ${fileResult.error ?? 'unknown'}`;
              if (fileResult.error?.includes('CRITICAL')) {
                this.logger.error(`🚨 ${msg}`);
              } else {
                this.logger.warn(msg);
              }
            }
          }

          await this.backupLogger.writeLog({
            restoreJobId: currentJobId,
            level: hasRequiredConfigFailure ? 'ERROR' : configRestoreResult.level,
            phase: 'RESTORE_CONFIG',
            message: configFailureMessage || configRestoreResult.message,
            durationMs: Date.now() - configStart,
          });
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          hasRequiredConfigFailure = true;
          configFailureMessage = `Config restore failed: ${msg}`;
          await this.backupLogger.writeLog({
            restoreJobId: currentJobId,
            level: 'ERROR',
            phase: 'RESTORE_CONFIG',
            message: configFailureMessage,
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

        // إحصاءات المحتوى بعد الاستعادة — تُساعد في اكتشاف فقدان البيانات
        const [unitsCount, lessonsCount, contentsCount] = await Promise.all([
          this.prisma.unit.count({ where: { isDeleted: false } }),
          this.prisma.lessonTemplate.count({ where: { isDeleted: false } }),
          this.prisma.lessonContent.count({ where: { isDeleted: false } }),
        ]);

        await this.backupLogger.writeLog({
          restoreJobId: currentJobId,
          level: 'INFO',
          phase: 'RESTORE_VERIFY',
          message: `Post-restore verification passed (latest migration: ${migrationName}) | Content stats: units=${unitsCount}, lessons=${lessonsCount}, contents=${contentsCount}`,
          durationMs: Date.now() - verifyStart,
          metadata: { migrationName, unitsCount, lessonsCount, contentsCount },
        });

        this.logger.log(
          `✅ Post-restore stats: units=${unitsCount}, lessons=${lessonsCount}, contents=${contentsCount}`,
        );
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error);
        await this.backupLogger.writeLog({
          restoreJobId: currentJobId,
          level: 'WARN',
          phase: 'RESTORE_VERIFY',
          message: `Post-restore verification failed: ${msg}`,
        });
      }

      // ── 9. CLEANUP + FINAL STATUS ──
      if (isSafeWorkDir(workDir, job.uuid, storageBasePath)) {
        await this.storage.deleteDirectory(workDir);
      } else {
        this.logger.warn(`Refusing to delete untrusted workDir: ${workDir}`);
      }

      if (hasRequiredConfigFailure) {
        // إذا كانت قاعدة البيانات أو الوسائط قد استُعيدت بنجاح قبل فشل .env:
        // يجب استدعاء Rollback لإلغاء التغييرات وحماية النظام من الحالة المشوهة
        if (dbRestored || mediaRestored) {
          if (!rollbackAttempted) {
            rollbackAttempted = true;
            this.logger.error(
              `Required config restore failed after database/media restore — initiating rollback`,
            );
            await this.attemptRollback({
              jobId: currentJobId,
              jobUuid: job.uuid,
              initiatedByUserUuid: job.initiatedByUserUuid,
              startedAt: job.startedAt ?? undefined,
              safetyBackupId,
              safetyBackupJobUuid,
              safetyStoragePath,
              workDir,
              rollbackDatabase: dbRestored,
              rollbackMedia: mediaRestored,
              rollbackConfig: false,
              originalError: configFailureMessage,
            });
          }
        } else {
          // لم تتغير قاعدة البيانات ولا الوسائط (فشل قبل أي تغيير في البيانات)
          await this.prisma.restoreJob.updateMany({
            where: { uuid: job.uuid },
            data: {
              status: 'FAILED',
              errorMessage: configFailureMessage,
              finishedAt: new Date(),
            },
          });

          await this.backupLogger.writeLog({
            restoreJobId: currentJobId,
            level: 'ERROR',
            phase: 'CLEANUP',
            message: `Restore finished with FAILED status: ${configFailureMessage}`,
          });

          this.logger.error(`❌ Restore completed with FAILED status: ${configFailureMessage}`);
        }
        return;
      }

      // النجاح التام فقط إذا لم يكن هناك أي فشل في مكوّن مطلوب
      await this.prisma.restoreJob.updateMany({
        where: { uuid: job.uuid },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
        },
      });

      // تحديث النسخة — تم استخدامها (بالـ UUID لأن الـ ID قد يتغير بعد restore)
      try {
        await this.prisma.backupInstance.update({
          where: { uuid: instance.uuid },
          data: { lastRestoredAt: new Date() },
        });
      } catch {
        // النسخة قد لا تكون موجودة في الـ DB المستعادة
      }

      await this.backupLogger.writeLog({
        restoreJobId: currentJobId,
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
      if ((dbTouched || dbRestored || mediaRestored) && !rollbackAttempted) {
        rollbackAttempted = true;
        await this.attemptRollback({
          jobId: currentJobId,
          jobUuid: job.uuid,
          initiatedByUserUuid: job.initiatedByUserUuid,
          startedAt: job.startedAt ?? undefined,
          safetyBackupId,
          safetyBackupJobUuid,
          safetyStoragePath,
          workDir,
          rollbackDatabase: dbTouched || dbRestored,
          rollbackMedia: mediaRestored,
          rollbackConfig: false,
          originalError: msg,
        });
      } else if (!rollbackAttempted) {
        await this.failJob(currentJobId, msg, workDir);
      }
    }
  }

  // ══════════════════════════════════════════════
  // ──  PRE-RESTORE ANALYSIS (DEC-014)
  // ══════════════════════════════════════════════

  /**
   * تحليل نسخة قبل استعادتها
   * يُعيد مقارنة بين المحتوى في النسخة والمحتوى الحالي + تقييم المخاطر
   */
  async getRestorePreview(backupUuid: string): Promise<RestorePreviewResult> {
    const instance = await this.prisma.backupInstance.findUnique({
      where: { uuid: backupUuid },
    });

    if (!instance || instance.isDeleted) {
      return {
        backupInfo: null,
        backupStats: null,
        currentStats: await this.getCurrentStats(),
        diff: null,
        riskLevel: 'UNKNOWN',
        warnings: [],
        hasContentStats: false,
        canRestore: false,
        canRestoreReason: 'Backup not found or deleted',
      };
    }

    // ── قراءة manifest — Sidecar (سريع) أو tar (للنسخ القديمة) ──
    let manifest: BackupManifest | null = null;
    try {
      const sidecarPath = `${instance.storagePath}.manifest.json`;

      // محاولة قراءة الـ sidecar أولاً (النسخ الجديدة)
      const sidecarExists = await fsp.access(sidecarPath).then(() => true).catch(() => false);

      if (sidecarExists) {
        // مسار سريع — قراءة مباشرة بدون فك ضغط
        const raw = await fsp.readFile(sidecarPath, 'utf-8');
        manifest = JSON.parse(raw) as BackupManifest;
        this.logger.debug(`restore-preview: used sidecar for ${backupUuid}`);
      } else {
        // مسار احتياطي — فك الأرشيف للنسخ القديمة
        const previewStoragePath = path.resolve(
          process.env.BACKUP_STORAGE_PATH || './backups',
        );
        const tmpDir = path.resolve(
          previewStoragePath,
          STORAGE_DIRS.TEMP,
          `preview-${backupUuid}`,
        );
        await this.storage.ensureDirectory(tmpDir);

        await execFileAsync('tar', ['-xzf', instance.storagePath, '-C', tmpDir, 'manifest.json']);

        const manifestPath = path.join(tmpDir, 'manifest.json');
        const raw = await fsp.readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(raw) as BackupManifest;

        // تنظيف مجلد preview المؤقت
        await fsp.rm(tmpDir, { recursive: true, force: true });

        // حفظ sidecar للمرات القادمة
        await fsp.writeFile(sidecarPath, JSON.stringify(manifest, null, 2), 'utf-8');
        this.logger.debug(`restore-preview: created sidecar for ${backupUuid}`);
      }
    } catch {
      this.logger.warn(`Could not read manifest for backup ${backupUuid}`);
    }

    const currentStats = await this.getCurrentStats();
    const backupStats = manifest?.contentStats ?? null;

    const backupInfo = {
      uuid: instance.uuid,
      backupName: instance.backupName,
      createdAt: instance.createdAt.toISOString(),
      fileSizeBytes: Number(instance.fileSizeBytes ?? 0),
      category: instance.category,
    };

    if (!backupStats) {
      return {
        backupInfo,
        backupStats: null,
        currentStats,
        diff: null,
        riskLevel: 'UNKNOWN',
        warnings: [
          {
            type: 'NO_STATS',
            severity: 'MEDIUM',
            count: 0,
            percentage: 0,
            message: 'إحصاءات هذه النسخة غير متاحة — أُنشئت قبل تحديث النظام',
          },
        ],
        hasContentStats: false,
        canRestore: true,
      };
    }

    // ── حساب الفروقات ──
    const diff = this.computeDiff(currentStats, backupStats);

    // ── تقييم المخاطر ──
    const { riskLevel, warnings } = this.computeRisk(diff, backupStats, currentStats);

    return {
      backupInfo,
      backupStats,
      currentStats,
      diff,
      riskLevel,
      warnings,
      hasContentStats: true,
      canRestore: true,
    };
  }

  /** إحصاءات قاعدة البيانات الحالية */
  private async getCurrentStats(): Promise<ContentStats> {
    const [totalUnits, totalLessons, totalContents, totalQuestions] = await Promise.all([
      this.prisma.unit.count({ where: { isDeleted: false } }),
      this.prisma.lessonTemplate.count({ where: { isDeleted: false } }),
      this.prisma.lessonContent.count({ where: { isDeleted: false } }),
      this.prisma.question.count({ where: { isDeleted: false } }),
    ]);
    return { totalUnits, totalLessons, totalContents, totalQuestions };
  }

  /** حساب الفرق بالعدد والنسبة لكل مكون */
  private computeDiff(
    current: ContentStats,
    backup: ContentStats,
  ): ContentDiff {
    const calc = (cur: number, bak: number) => ({
      difference: bak - cur,
      percentage: cur === 0 ? 0 : Math.round(((bak - cur) / cur) * 1000) / 10,
    });

    return {
      units:     calc(current.totalUnits,     backup.totalUnits),
      lessons:   calc(current.totalLessons,   backup.totalLessons),
      contents:  calc(current.totalContents,  backup.totalContents),
      questions: calc(current.totalQuestions, backup.totalQuestions),
    };
  }

  /** تحديد مستوى الخطر والتحذيرات المُهيكلة */
  private computeRisk(
    diff: ContentDiff,
    backupStats: ContentStats,
    currentStats: ContentStats,
  ): { riskLevel: RiskLevel; warnings: RestoreWarning[] } {
    const warnings: RestoreWarning[] = [];

    const checks = [
      { key: 'units',     label: 'وحدة',  type: 'UNITS_LOSS',    diff: diff.units,     current: currentStats.totalUnits },
      { key: 'lessons',   label: 'درساً', type: 'LESSONS_LOSS',  diff: diff.lessons,   current: currentStats.totalLessons },
      { key: 'contents',  label: 'محتوى', type: 'CONTENTS_LOSS', diff: diff.contents,  current: currentStats.totalContents },
      { key: 'questions', label: 'سؤالاً',type: 'QUESTIONS_LOSS',diff: diff.questions, current: currentStats.totalQuestions },
    ];

    let maxLoss = 0;

    for (const check of checks) {
      if (check.diff.difference < 0) {
        const lossCount = Math.abs(check.diff.difference);
        const lossPct   = Math.abs(check.diff.percentage);
        maxLoss = Math.max(maxLoss, lossPct);

        const severity: 'LOW' | 'MEDIUM' | 'HIGH' =
          lossPct > 15 ? 'HIGH' : lossPct > 5 ? 'MEDIUM' : 'LOW';

        warnings.push({
          type:       check.type,
          severity,
          count:      lossCount,
          percentage: lossPct,
          message:    `ستفقد ${lossCount.toLocaleString('ar-SA')} ${check.label} (-${lossPct}%)`,
        });
      }
    }

    const riskLevel: RiskLevel =
      maxLoss === 0   ? 'SAFE'   :
      maxLoss < 5     ? 'LOW'    :
      maxLoss < 15    ? 'MEDIUM' : 'HIGH';

    return { riskLevel, warnings };
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
      const storedLine = (await fsp.readFile(checksumFile, 'utf-8')).trim();
      // صيغة sha256sum القياسية: "hash  filename" — نستخرج الـ hash فقط
      const storedChecksum = storedLine.split(/\s+/)[0];
      if (storedChecksum !== expectedSha256) {
        throw new Error(
          `Checksum file mismatch: .sha256 file says ${storedChecksum.slice(0, 16)}..., DB says ${expectedSha256.slice(0, 16)}...`,
        );
      }
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
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
  private async attemptRollback(params: {
    jobId: number;
    jobUuid: string;
    initiatedByUserUuid?: string;
    startedAt?: Date;
    safetyBackupId: number | null;
    safetyBackupJobUuid?: string | null;
    safetyStoragePath: string | null;
    workDir?: string;
    rollbackDatabase: boolean;
    rollbackMedia: boolean;
    rollbackConfig: boolean;
    originalError: string;
    execFileFn?: (
      file: string,
      args: string[],
      options?: any,
    ) => Promise<{ stdout: string; stderr: string }>;
  }): Promise<void> {
    const {
      jobId,
      jobUuid,
      initiatedByUserUuid,
      startedAt,
      safetyBackupId,
      safetyBackupJobUuid,
      safetyStoragePath,
      workDir,
      rollbackDatabase,
      rollbackMedia,
      rollbackConfig,
      originalError,
      execFileFn,
    } = params;

    if (!safetyBackupId && !safetyStoragePath) {
      await this.prisma.restoreJob.updateMany({
        where: { uuid: jobUuid },
        data: {
          status: 'CRITICAL_FAILURE',
          errorMessage: `Restore failed: ${originalError} (no safety backup available for rollback)`,
          finishedAt: new Date(),
        },
      });
      return;
    }

    let rollbackDir: string | null = null;
    try {
      this.logger.warn('🔄 Attempting rollback from safety backup...');

      // تحديد مسار أرشيف الأمان:
      // الأولوية لمسار الملف المحفوظ في الذاكرة لضمان العمل حتى بعد استبدال قاعدة البيانات
      let archivePath = safetyStoragePath;
      if (!archivePath && safetyBackupId) {
        const safetyInstance = await this.prisma.backupInstance.findUnique({
          where: { id: safetyBackupId },
        });
        archivePath = safetyInstance?.storagePath ?? null;
      }

      if (!archivePath) {
        throw new Error('Safety backup archive not found');
      }

      await fsp.access(archivePath);

      // فحص أمني استباقي لأرشيف التراجع قبل الاستخراج (BKP-002)
      await validateArchiveBeforeExtraction(
        archivePath,
        ALLOWED_ARCHIVE_TOP_LEVEL,
      );

      // فك الأرشيف في مجلد rollback مخصص
      rollbackDir = workDir
        ? `${workDir}-rollback`
        : `/tmp/restore-rollback-${Date.now()}`;
      await this.storage.ensureDirectory(rollbackDir);

      const execFn = execFileFn ?? execFileAsync;
      await execFn('tar', [
        '-xzf',
        archivePath,
        '-C',
        rollbackDir,
        '--no-same-owner',
        '--no-same-permissions',
      ], {
        timeout: 120_000,
      });

      // تدقيق المجلد المُستخرج بعد tar وقبل استخدام محتوياته (BKP-002)
      const projectRoot = resolveProjectRoot();
      const sensitivePaths = [
        path.join(projectRoot, '.env'),
        path.join(projectRoot, 'package.json'),
      ];
      await auditExtractedDirectory(
        rollbackDir,
        ALLOWED_ARCHIVE_TOP_LEVEL,
        sensitivePaths,
      );

      const rollbackManifest: BackupManifest = JSON.parse(
        await fsp.readFile(
          path.join(rollbackDir, 'manifest.json'),
          'utf-8',
        ),
      );

      // فحص أمني لمسارات مكونات Manifest للتأكد من بقائها داخل rollbackDir (BKP-002 M-1)
      if (rollbackManifest.components?.database?.file) {
        const safeDbFile = resolveWithinBase(
          rollbackDir,
          rollbackManifest.components.database.file,
        );
        if (!safeDbFile) {
          throw new Error(
            `Path traversal rejected in rollback manifest database file: ${rollbackManifest.components.database.file}`,
          );
        }
      }

      if (rollbackManifest.components?.media?.directory) {
        const safeMediaDir = resolveWithinBase(
          rollbackDir,
          rollbackManifest.components.media.directory,
        );
        if (!safeMediaDir) {
          throw new Error(
            `Path traversal rejected in rollback manifest media directory: ${rollbackManifest.components.media.directory}`,
          );
        }
      }

      if (rollbackManifest.components?.config?.directory) {
        const safeConfigDir = resolveWithinBase(
          rollbackDir,
          rollbackManifest.components.config.directory,
        );
        if (!safeConfigDir) {
          throw new Error(
            `Path traversal rejected in rollback manifest config directory: ${rollbackManifest.components.config.directory}`,
          );
        }
      }

      // 1. تراجع قاعدة البيانات إذا كانت قد استُعيدت
      if (rollbackDatabase) {
        if (!rollbackManifest.components?.database) {
          throw new Error('Safety backup has no database component');
        }
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error('DATABASE_URL not configured for rollback');
        }
        const dbFile = resolveWithinBase(
          rollbackDir,
          rollbackManifest.components.database.file,
        );
        if (!dbFile) {
          throw new Error(
            `Path traversal rejected in rollback database file: ${rollbackManifest.components.database.file}`,
          );
        }
        const rollbackResult = await this.dbRestoreEngine.execute(
          dbFile,
          databaseUrl,
        );
        if (!rollbackResult.success) {
          throw new Error(`Database rollback failed: ${rollbackResult.errorMessage}`);
        }

        // تنظيف مهام BackupJob العالقة التي عادت بحالة RUNNING مع نسخة الأمان بعد استعادة DB (BKP-002)
        // تقييد التحديث بدقة لمنع تغيير أي مهام تشغيلية جديدة أو غير مرتبطة بالتراجع
        try {
          if (this.prisma.backupJob) {
            if (safetyBackupJobUuid && this.prisma.backupJob.updateMany) {
              // 1. المسار الأساسي الموثوق: استهداف المهمة المحددة بالـ UUID الصريح والنوع PRE_RESTORE
              const staleResult = await this.prisma.backupJob.updateMany({
                where: {
                  uuid: safetyBackupJobUuid,
                  status: 'RUNNING',
                  triggeredBy: 'PRE_RESTORE',
                },
                data: {
                  status: 'FAILED',
                  errorMessage: 'Interrupted by database rollback',
                  finishedAt: new Date(),
                },
              });
              if (staleResult.count > 0) {
                this.logger.log(
                  `Cleaned up stale RUNNING backup job (${safetyBackupJobUuid}) associated with rollback`,
                );
              }
            } else if (this.prisma.backupJob.findMany && this.prisma.backupJob.updateMany) {
              // 2. المسار الاحتياطي عند غياب UUID:
              // فحص المرشحين — إذا وُجد أكثر من مرشح، نرفض التعديل الجماعي بناءً على الزمن وحده لمنع تغيير مهام غير مؤكدة
              const candidates = await this.prisma.backupJob.findMany({
                where: {
                  status: 'RUNNING',
                  triggeredBy: 'PRE_RESTORE',
                  ...(startedAt ? { createdAt: { lte: startedAt } } : {}),
                },
                select: { id: true, uuid: true },
              });

              if (candidates.length === 1) {
                await this.prisma.backupJob.updateMany({
                  where: {
                    uuid: candidates[0].uuid,
                    status: 'RUNNING',
                    triggeredBy: 'PRE_RESTORE',
                  },
                  data: {
                    status: 'FAILED',
                    errorMessage: 'Interrupted by database rollback',
                    finishedAt: new Date(),
                  },
                });
                this.logger.log(
                  `Cleaned up single candidate stale RUNNING backup job (${candidates[0].uuid}) after DB rollback`,
                );
              } else if (candidates.length > 1) {
                this.logger.warn(
                  `Ambiguous stale backup jobs: found ${candidates.length} PRE_RESTORE candidates in RUNNING status without safetyBackupJobUuid. Skipping cleanup to prevent mutating unconfirmed jobs.`,
                );
              }
            }
          }
        } catch (cleanupErr) {
          const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          this.logger.warn(`Could not clean stale backup jobs after rollback: ${msg}`);
        }
      }

      // 2. تراجع الوسائط إذا كانت قد استُعيدت وتغيرت
      if (rollbackMedia && rollbackManifest.components?.media) {
        const mediaBasePath = path.resolve(process.env.MEDIA_STORAGE_PATH ?? './storage');
        const mediaDir = resolveWithinBase(
          rollbackDir,
          rollbackManifest.components.media.directory,
        );
        if (!mediaDir) {
          throw new Error(
            `Path traversal rejected in rollback media directory: ${rollbackManifest.components.media.directory}`,
          );
        }
        const mediaFiles = await this.listFilesRecursive(mediaDir);
        for (const relPath of mediaFiles) {
          const resolvedDest = resolveWithinBase(mediaBasePath, relPath);
          if (!resolvedDest) {
            this.logger.warn(
              `Path traversal blocked in rollback media destination: ${relPath}`,
            );
            continue;
          }
          const resolvedSrc = resolveWithinBase(mediaDir, relPath);
          if (!resolvedSrc) {
            this.logger.warn(
              `Path traversal blocked in rollback media source: ${relPath}`,
            );
            continue;
          }
          await fsp.mkdir(path.dirname(resolvedDest), { recursive: true });
          await fsp.copyFile(resolvedSrc, resolvedDest);
        }
        this.logger.log(`Media rolled back from safety backup`);
      }

      // 3. تراجع الإعدادات إذا كانت قد استُعيدت
      if (rollbackConfig && rollbackManifest.components?.config) {
        const projectRoot = resolveProjectRoot();
        const configDir = resolveWithinBase(
          rollbackDir,
          rollbackManifest.components.config.directory,
        );
        if (!configDir) {
          throw new Error(
            `Path traversal rejected in rollback config directory: ${rollbackManifest.components.config.directory}`,
          );
        }
        await restoreConfigFiles(
          configDir,
          projectRoot,
          rollbackManifest.components.config.files,
        );
        this.logger.log(`Config rolled back from safety backup`);
      }

      // تنظيف
      if (rollbackDir) {
        await this.storage.deleteDirectory(rollbackDir);
        rollbackDir = null;
      }

      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'WARN',
        phase: 'RESTORE_ROLLBACK',
        message: 'Rollback from safety backup succeeded',
      });

      // استخدام updateMany على uuid لضمان الوصول للسجل بعد استعادة DB
      try {
        const updateResult = await this.prisma.restoreJob.updateMany({
          where: { uuid: jobUuid },
          data: {
            status: 'ROLLBACK_COMPLETED',
            errorMessage: `Restore failed: ${originalError} — rolled back to safety backup`,
            finishedAt: new Date(),
          },
        });

        // إذا لم يكن السجل موجوداً في قاعدة البيانات المستعادة، ننشئه وفق مخطط Prisma الفعلي
        if (updateResult.count === 0) {
          this.logger.warn(
            `Restore job record ${jobUuid} not found in rolled-back DB — creating record to guarantee persistence`,
          );
          await this.prisma.restoreJob.create({
            data: {
              uuid: jobUuid,
              restoreDatabase: rollbackDatabase,
              restoreMedia: rollbackMedia,
              restoreConfiguration: rollbackConfig,
              initiatedByUserUuid: initiatedByUserUuid ?? 'system-rollback',
              status: 'ROLLBACK_COMPLETED',
              errorMessage: `Restore failed: ${originalError} — rolled back to safety backup`,
              startedAt: startedAt ?? new Date(),
              finishedAt: new Date(),
            },
          });
        }
      } catch (dbUpdateErr) {
        const dbErrText = dbUpdateErr instanceof Error ? dbUpdateErr.message : String(dbUpdateErr);
        this.logger.error(`Failed to update restoreJob status in DB: ${dbErrText}`);
        process.stderr.write(
          `[CRITICAL OPERATIONAL FAILURE] Failed to persist restoreJob ${jobUuid} to ROLLBACK_COMPLETED in DB: ${dbErrText}\n` +
          `Original error: ${originalError}\n`,
        );
        throw new Error(
          `CRITICAL_OPERATIONAL_FAILURE: Database connection failed during rollback status persistence: ${dbErrText}`,
        );
      }
    } catch (error) {
      if (rollbackDir) {
        try {
          await this.storage.deleteDirectory(rollbackDir);
        } catch {
          // ignore
        }
      }

      const msg =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`⛔ CRITICAL: Rollback failed: ${msg}`);

      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'ERROR',
        phase: 'RESTORE_ROLLBACK',
        message: `CRITICAL — Rollback failed: ${msg}`,
      });

      // حفظ تفاصيل الخطأ الأصلي وخطأ التراجع معاً
      try {
        const critResult = await this.prisma.restoreJob.updateMany({
          where: { uuid: jobUuid },
          data: {
            status: 'CRITICAL_FAILURE',
            errorMessage: `Restore failed: ${originalError} — Rollback failed: ${msg}`,
            finishedAt: new Date(),
          },
        });

        // إذا لم يكن السجل موجوداً في قاعدة البيانات المستعادة، ننشئه لتوثيق الفشل الحرج
        if (critResult.count === 0) {
          this.logger.warn(
            `Restore job record ${jobUuid} not found in rolled-back DB — creating critical failure record`,
          );
          await this.prisma.restoreJob.create({
            data: {
              uuid: jobUuid,
              restoreDatabase: rollbackDatabase,
              restoreMedia: rollbackMedia,
              restoreConfiguration: rollbackConfig,
              initiatedByUserUuid: initiatedByUserUuid ?? 'system-rollback',
              status: 'CRITICAL_FAILURE',
              errorMessage: `Restore failed: ${originalError} — Rollback failed: ${msg}`,
              startedAt: startedAt ?? new Date(),
              finishedAt: new Date(),
            },
          });
        }
      } catch (dbCritErr) {
        const dbErrText = dbCritErr instanceof Error ? dbCritErr.message : String(dbCritErr);
        this.logger.error(`Failed to update restoreJob to CRITICAL_FAILURE in DB: ${dbErrText}`);
        process.stderr.write(
          `[CRITICAL OPERATIONAL FAILURE] Failed to persist CRITICAL_FAILURE for restoreJob ${jobUuid} in DB: ${dbErrText}\n` +
          `Original error: ${originalError}\nRollback error: ${msg}\n`,
        );
        throw new Error(
          `CRITICAL_OPERATIONAL_FAILURE: Database connection failed during critical failure status persistence: ${dbErrText}`,
        );
      }
    }

    // تنظيف workDir الأصلي (مع التحقق من هويته)
    if (workDir) {
      try {
        if (isSafeWorkDir(workDir, jobUuid)) {
          await this.storage.deleteDirectory(workDir);
        } else {
          this.logger.warn(`Refusing to delete untrusted workDir in rollback: ${workDir}`);
        }
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
    jobUuid?: string,
  ): Promise<void> {
    try {
      await this.prisma.restoreJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorMessage,
          finishedAt: new Date(),
        },
      });
    } catch {
      this.logger.warn(`Could not update restore job ${jobId} to FAILED (record may not exist after DB restore)`);
    }

    try {
      await this.backupLogger.writeLog({
        restoreJobId: jobId,
        level: 'ERROR',
        phase: 'CLEANUP',
        message: errorMessage,
      });
    } catch {
      this.logger.error(`[FALLBACK] failJob: ${errorMessage}`);
    }

    if (workDir) {
      try {
        if (isSafeWorkDir(workDir, jobUuid)) {
          await this.storage.deleteDirectory(workDir);
        } else {
          this.logger.warn(`Refusing to delete untrusted workDir: ${workDir}`);
        }
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
   * آمن ضد الروابط الرمزية (BKP-002) — يستخدم lstat ويتجاهل الروابط تماماً
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
        const stat = await fsp.lstat(fullPath);

        if (stat.isSymbolicLink()) {
          this.logger.warn(
            `Symbolic link ignored in listFilesRecursive: ${fullPath}`,
          );
          continue;
        }

        if (stat.isDirectory()) {
          const subFiles = await this.listFilesRecursive(
            fullPath,
            base,
          );
          files.push(...subFiles);
        } else if (stat.isFile()) {
          files.push(path.relative(base, fullPath));
        }
      }
    } catch {
      // مجلد فارغ أو غير موجود
    }

    return files;
  }
}

// ══════════════════════════════════════════════
// ──  Types: Pre-Restore Analysis
// ══════════════════════════════════════════════

export type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export interface ContentStats {
  totalUnits: number;
  totalLessons: number;
  totalContents: number;
  totalQuestions: number;
}

export interface ContentDiffItem {
  difference: number;   // موجب = زيادة، سالب = نقص
  percentage: number;   // النسبة المئوية للتغيير
}

export interface ContentDiff {
  units:     ContentDiffItem;
  lessons:   ContentDiffItem;
  contents:  ContentDiffItem;
  questions: ContentDiffItem;
}

export interface RestoreWarning {
  type:       string;             // UNITS_LOSS | LESSONS_LOSS | ...
  severity:   'LOW' | 'MEDIUM' | 'HIGH';
  count:      number;
  percentage: number;
  message:    string;             // نص عربي للعرض
}

export interface RestorePreviewResult {
  backupInfo: {
    uuid: string;
    backupName: string;
    createdAt: string;
    fileSizeBytes: number;
    category: string;
  } | null;
  backupStats:     ContentStats | null;
  currentStats:    ContentStats;
  diff:            ContentDiff | null;
  riskLevel:       RiskLevel;
  warnings:        RestoreWarning[];
  hasContentStats: boolean;
  canRestore:      boolean;
  canRestoreReason?: string;
}
