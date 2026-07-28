// src/owner/backup/backup.module.ts

import { Module } from '@nestjs/common';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { PreflightValidatorService } from './services/preflight-validator.service';
import { BackupLoggerService } from './services/backup-logger.service';
import { BackupOrchestratorService } from './services/backup-orchestrator.service';
import { RestoreOrchestratorService } from './services/restore-orchestrator.service';
import { BackupSchedulerService } from './services/backup-scheduler.service';
import { RetentionService } from './services/retention.service';
import { PgDumpEngine } from './engines/pg-dump.engine';
import { MediaBackupEngine } from './engines/media-backup.engine';
import { ConfigBackupEngine } from './engines/config-backup.engine';
import { DbRestoreEngine } from './engines/db-restore.engine';
import { BackupController } from './backup.controller';

/**
 * وحدة النسخ الاحتياطي والاستعادة (BKP-001)
 *
 * المراحل المكتملة:
 * 1. البنية الأساسية (Storage, Preflight, Logger)
 * 2. محرك النسخ (Engines + Orchestrator)
 * 3. API + الجدولة (Controller, Scheduler, Retention)
 * 4. الاستعادة (Restore Orchestrator + DB Restore Engine)
 */
@Module({
  controllers: [BackupController],
  providers: [
    // Storage
    LocalStorageProvider,

    // Services
    PreflightValidatorService,
    BackupLoggerService,
    BackupOrchestratorService,
    RestoreOrchestratorService,
    BackupSchedulerService,
    RetentionService,

    // Engines
    PgDumpEngine,
    MediaBackupEngine,
    ConfigBackupEngine,
    DbRestoreEngine,
  ],
  exports: [
    BackupOrchestratorService,
    BackupLoggerService,
  ],
})
export class BackupModule {}
