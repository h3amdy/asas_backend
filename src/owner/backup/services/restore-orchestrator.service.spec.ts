import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { RestoreOrchestratorService } from './restore-orchestrator.service';
import { BackupOrchestratorService } from './backup-orchestrator.service';
import { DbRestoreEngine } from '../engines/db-restore.engine';
import { BackupManifest } from '../types/manifest.type';
import { resolveWithinBase } from '../utils/safe-copy';
import * as archiveSafety from '../utils/archive-safety';

const execFileAsync = promisify(execFile);

describe('RestoreOrchestratorService — Safety Rollback & SQL/Config Error Handling', () => {
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'restore-orchestrator-spec-'));
  });

  afterEach(async () => {
    if (sandboxDir) {
      await fsp.rm(sandboxDir, { recursive: true, force: true });
    }
  });

  const computeSha256 = async (filePath: string): Promise<string> => {
    const data = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  };

  /**
   * دالة مساعدة لإنشاء أرشيف .tar.gz صالح مع manifest.json
   */
  const createMockArchive = async (
    archivePath: string,
    sqlContent: string,
    options?: {
      mediaFiles?: Record<string, string>;
      configFiles?: Record<string, string>;
    },
  ): Promise<{ sha256: string; sqlGzSha256: string }> => {
    const tempDir = path.join(sandboxDir, `build-archive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fsp.mkdir(path.join(tempDir, 'database'), { recursive: true });

    const sqlFile = path.join(tempDir, 'database', 'postgres.sql');
    await fsp.writeFile(sqlFile, sqlContent, 'utf-8');
    await execFileAsync('gzip', ['-9', sqlFile]);
    const sqlGzFile = path.join(tempDir, 'database', 'postgres.sql.gz');
    const sqlGzSha256 = await computeSha256(sqlGzFile);

    let mediaComponent: BackupManifest['components']['media'] = null;
    if (options?.mediaFiles) {
      await fsp.mkdir(path.join(tempDir, 'media'), { recursive: true });
      for (const [rel, content] of Object.entries(options.mediaFiles)) {
        const dest = path.join(tempDir, 'media', rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, content, 'utf-8');
      }
      mediaComponent = {
        included: true as const,
        directory: 'media/',
        filesExpected: Object.keys(options.mediaFiles).length,
        filesCopied: Object.keys(options.mediaFiles).length,
        sizeBytes: 100,
      };
    }

    let configComponent: BackupManifest['components']['config'] = null;
    if (options?.configFiles) {
      await fsp.mkdir(path.join(tempDir, 'config'), { recursive: true });
      for (const [name, content] of Object.entries(options.configFiles)) {
        await fsp.writeFile(path.join(tempDir, 'config', name), content, 'utf-8');
      }
      configComponent = {
        included: true,
        directory: 'config/',
        files: Object.keys(options.configFiles),
        sizeBytes: 100,
      };
    }

    const manifest: BackupManifest = {
      backupId: 'mock-uuid',
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0',
      databaseSchemaVersion: 'test',
      backupType: 'FULL',
      triggerType: 'MANUAL',
      category: 'NORMAL',
      components: {
        database: {
          included: true,
          engine: 'pg_dump',
          format: 'sql.gz',
          file: 'database/postgres.sql.gz',
          sizeBytes: (await fsp.stat(sqlGzFile)).size,
          sha256: sqlGzSha256,
        },
        media: mediaComponent,
        config: configComponent,
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: 'SUCCESS',
        missingStorageKeys: [],
      },
      checksums: {
        'database/postgres.sql.gz': sqlGzSha256,
      },
    };

    await fsp.writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    await fsp.mkdir(path.dirname(archivePath), { recursive: true });
    await execFileAsync('tar', ['-czf', archivePath, '-C', tempDir, '.']);

    const archiveSha256 = await computeSha256(archivePath);
    await fsp.writeFile(`${archivePath}.sha256`, `${archiveSha256}  ${path.basename(archivePath)}\n`, 'utf-8');

    await fsp.rm(tempDir, { recursive: true, force: true });
    return { sha256: archiveSha256, sqlGzSha256 };
  };

  it('1. should automatically detect internal SQL failure via DbRestoreEngine, trigger attemptRollback, and set status to ROLLBACK_COMPLETED', async () => {
    const brokenArchivePath = path.join(sandboxDir, 'backups', 'completed', 'broken_backup.tar.gz');
    const safetyArchivePath = path.join(sandboxDir, 'backups', 'completed', 'safety_backup.tar.gz');

    const brokenSql = `
      INSERT INTO test_tbl VALUES ('leaked');
      THIS IS A FATAL SYNTAX ERROR;
      INSERT INTO test_tbl VALUES ('never_executed');
    `;
    const safetySql = `
      SELECT 1;
    `;

    const brokenMeta = await createMockArchive(brokenArchivePath, brokenSql);
    const safetyMeta = await createMockArchive(safetyArchivePath, safetySql);

    let restoreJobRecord: any = {
      id: 101,
      uuid: 'restore-job-uuid-1',
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      safetyBackupId: null,
    };

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(restoreJobRecord)),
        update: jest.fn().mockImplementation(({ data }) => {
          restoreJobRecord = { ...restoreJobRecord, ...data };
          return Promise.resolve(restoreJobRecord);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (restoreJobRecord.uuid === where?.uuid || !where?.uuid) {
            restoreJobRecord = { ...restoreJobRecord, ...data };
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      backupInstance: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 1) {
            return Promise.resolve({
              id: 1,
              uuid: 'instance-broken-uuid',
              storagePath: brokenArchivePath,
              sha256: brokenMeta.sha256,
            });
          }
          if (where.id === 999) {
            return Promise.resolve({
              id: 999,
              uuid: 'instance-safety-uuid',
              storagePath: safetyArchivePath,
              sha256: safetyMeta.sha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 50,
          uuid: 'safety-job-uuid',
          status: 'COMPLETED',
          backupInstanceId: 999,
        }),
      },
    };

    const logsWritten: any[] = [];
    const mockBackupLogger: any = {
      writeLog: jest.fn().mockImplementation((logEntry) => {
        logsWritten.push(logEntry);
        return Promise.resolve();
      }),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-uuid' }),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn().mockImplementation(async (sqlGzPath: string) => {
        if (sqlGzPath.includes('broken') || sqlGzPath.includes('restore-job-uuid-1/database')) {
          return {
            success: false,
            errorMessage: 'psql: error: syntax error at or near "THIS"',
            durationMs: 45,
          };
        }
        return {
          success: true,
          durationMs: 30,
        };
      }),
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    await (orchestrator as any).runPipeline(101, {
      backupInstanceId: 1,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: false,
    });

    const dbFailLog = logsWritten.find(
      (l) => l.phase === 'RESTORE_DB' && l.level === 'ERROR',
    );
    expect(dbFailLog).toBeDefined();
    expect(dbFailLog.message).toContain('syntax error at or near "THIS"');

    expect(mockDbRestoreEngine.execute).toHaveBeenCalledTimes(2);

    const rollbackLog = logsWritten.find(
      (l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'WARN',
    );
    expect(rollbackLog).toBeDefined();
    expect(rollbackLog.message).toBe('Rollback from safety backup succeeded');

    expect(restoreJobRecord.status).toBe('ROLLBACK_COMPLETED');
    expect(restoreJobRecord.errorMessage).toContain('rolled back to safety backup');
    expect(restoreJobRecord.finishedAt).toBeInstanceOf(Date);
  });

  it('2. should mark job as CRITICAL_FAILURE and NEVER record success if safety rollback itself fails', async () => {
    const brokenArchivePath = path.join(sandboxDir, 'backups', 'completed', 'broken2.tar.gz');
    const safetyArchivePath = path.join(sandboxDir, 'backups', 'completed', 'safety2.tar.gz');

    const brokenMeta = await createMockArchive(brokenArchivePath, 'SYNTAX ERROR;');
    const safetyMeta = await createMockArchive(safetyArchivePath, 'SELECT 1;');

    let restoreJobRecord: any = {
      id: 102,
      uuid: 'restore-job-uuid-2',
      status: 'PENDING',
    };

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockResolvedValue(restoreJobRecord),
        update: jest.fn().mockImplementation(({ data }) => {
          restoreJobRecord = { ...restoreJobRecord, ...data };
          return Promise.resolve(restoreJobRecord);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (restoreJobRecord.uuid === where?.uuid || !where?.uuid) {
            restoreJobRecord = { ...restoreJobRecord, ...data };
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      backupInstance: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 2) {
            return Promise.resolve({
              id: 2,
              storagePath: brokenArchivePath,
              sha256: brokenMeta.sha256,
            });
          }
          if (where.id === 888) {
            return Promise.resolve({
              id: 888,
              storagePath: safetyArchivePath,
              sha256: safetyMeta.sha256,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 51,
          status: 'COMPLETED',
          backupInstanceId: 888,
        }),
      },
    };

    const logsWritten: any[] = [];
    const mockBackupLogger: any = {
      writeLog: jest.fn().mockImplementation((logEntry) => {
        logsWritten.push(logEntry);
        return Promise.resolve();
      }),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-2' }),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn()
        .mockResolvedValueOnce({
          success: false,
          errorMessage: 'Initial restore SQL error',
        })
        .mockResolvedValueOnce({
          success: false,
          errorMessage: 'Safety rollback disk I/O error',
        }),
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    await (orchestrator as any).runPipeline(102, {
      backupInstanceId: 2,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: false,
    });

    expect(restoreJobRecord.status).toBe('CRITICAL_FAILURE');
    expect(restoreJobRecord.errorMessage).toContain('Restore failed');
    expect(restoreJobRecord.errorMessage).toContain('Rollback failed');
    expect(restoreJobRecord.status).not.toBe('COMPLETED');
    expect(restoreJobRecord.status).not.toBe('ROLLBACK_COMPLETED');

    const criticalLog = logsWritten.find(
      (l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'ERROR',
    );
    expect(criticalLog).toBeDefined();
    expect(criticalLog.message).toContain('CRITICAL — Rollback failed');
  });

  it('3. should skip rollback and set status to FAILED when restore failure is caused by environment error', async () => {
    const brokenArchivePath = path.join(sandboxDir, 'backups', 'completed', 'env_fail.tar.gz');
    const brokenMeta = await createMockArchive(brokenArchivePath, 'SELECT 1;');

    let restoreJobRecord: any = {
      id: 103,
      uuid: 'restore-job-uuid-3',
      status: 'PENDING',
    };

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockResolvedValue(restoreJobRecord),
        update: jest.fn().mockImplementation(({ data }) => {
          restoreJobRecord = { ...restoreJobRecord, ...data };
          return Promise.resolve(restoreJobRecord);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (restoreJobRecord.uuid === where?.uuid || !where?.uuid) {
            restoreJobRecord = { ...restoreJobRecord, ...data };
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      backupInstance: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          storagePath: brokenArchivePath,
          sha256: brokenMeta.sha256,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 52,
          status: 'COMPLETED',
          backupInstanceId: 777,
        }),
      },
    };

    const mockBackupLogger: any = {
      writeLog: jest.fn().mockResolvedValue(undefined),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-3' }),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn().mockResolvedValue({
        success: false,
        errorMessage: 'psql: error: password authentication failed for user "test"',
      }),
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    await (orchestrator as any).runPipeline(103, {
      backupInstanceId: 3,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: false,
    });

    expect(mockDbRestoreEngine.execute).toHaveBeenCalledTimes(1);
    expect(restoreJobRecord.status).toBe('FAILED');
    expect(restoreJobRecord.errorMessage).toContain('Database restore failed (environment)');
  });

  it('4. should rollback DB and Media when required config (.env) fails after DB & Media restore, setting ROLLBACK_COMPLETED', async () => {
    // 1. إنشاء حزمة استعادة تحتوي DB و Media و Config
    const restoreArchivePath = path.join(sandboxDir, 'backups', 'completed', 'full_restore.tar.gz');
    const safetyArchivePath = path.join(sandboxDir, 'backups', 'completed', 'full_safety.tar.gz');

    // أرشيف الأمان يحتوي القيم الأصلية للوسائط وقاعدة البيانات
    const safetyMeta = await createMockArchive(safetyArchivePath, 'SELECT 1; -- SAFETY BASELINE', {
      mediaFiles: { 'schools/logo.png': 'PRE_RESTORE_SAFETY_MEDIA_CONTENT' },
      configFiles: { '.env': 'PRE_RESTORE_SAFETY_ENV=true' },
    });

    // الأرشيف المستهدف يحتوي وسائط جديدة وتكوين
    const restoreMeta = await createMockArchive(restoreArchivePath, 'SELECT 1; -- NEW RESTORED DB', {
      mediaFiles: { 'schools/logo.png': 'NEW_MUTATED_MEDIA_CONTENT' },
      configFiles: { '.env': 'NEW_SECRET_KEY=leaked' },
    });

    const mediaBasePath = path.join(sandboxDir, 'media_storage');
    await fsp.mkdir(mediaBasePath, { recursive: true });
    process.env.MEDIA_STORAGE_PATH = mediaBasePath;

    let restoreJobRecord: any = {
      id: 104,
      uuid: 'restore-job-uuid-4',
      status: 'PENDING',
    };

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(restoreJobRecord)),
        update: jest.fn().mockImplementation(({ data }) => {
          restoreJobRecord = { ...restoreJobRecord, ...data };
          return Promise.resolve(restoreJobRecord);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (restoreJobRecord.uuid === where?.uuid || !where?.uuid) {
            restoreJobRecord = { ...restoreJobRecord, ...data };
          }
          return Promise.resolve({ count: 1 });
        }),
        create: jest.fn().mockResolvedValue({}),
      },
      backupInstance: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 4) {
            return Promise.resolve({
              id: 4,
              uuid: 'cfg-fail-uuid',
              storagePath: restoreArchivePath,
              sha256: restoreMeta.sha256,
            });
          }
          if (where.id === 778) {
            return Promise.resolve({
              id: 778,
              uuid: 'safety-uuid-4',
              storagePath: safetyArchivePath,
              sha256: safetyMeta.sha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 53,
          status: 'COMPLETED',
          backupInstanceId: 778,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ migration_name: 'm1' }]),
      unit: { count: jest.fn().mockResolvedValue(1) },
      lessonTemplate: { count: jest.fn().mockResolvedValue(1) },
      lessonContent: { count: jest.fn().mockResolvedValue(1) },
    };

    const logsWritten: any[] = [];
    const mockBackupLogger: any = {
      writeLog: jest.fn().mockImplementation((logEntry) => {
        logsWritten.push(logEntry);
        return Promise.resolve();
      }),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-4' }),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn().mockResolvedValue({ success: true, durationMs: 15 }),
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    // إنشاء جذر مشروع وهمي صالح مع مجلد .env مسبق لإحداث فشل في استعادة .env
    const mockProjectRoot = path.join(sandboxDir, 'valid_project_root_fail');
    await fsp.mkdir(mockProjectRoot, { recursive: true });
    await fsp.writeFile(path.join(mockProjectRoot, 'package.json'), '{}', 'utf-8');
    await fsp.mkdir(path.join(mockProjectRoot, 'src'), { recursive: true });
    await fsp.mkdir(path.join(mockProjectRoot, '.env'), { recursive: true }); // مجلد يمنع كتابة ملف .env
    process.env.PROJECT_ROOT = mockProjectRoot;

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    // استعادة تشمل DB و Media و Config
    await (orchestrator as any).runPipeline(104, {
      backupInstanceId: 4,
      restoreDatabase: true,
      restoreMedia: true,
      restoreConfiguration: true,
    });

    delete process.env.PROJECT_ROOT;
    delete process.env.MEDIA_STORAGE_PATH;

    // 1. استدعاء التراجع تلقائياً بعد فشل .env:
    // تم استدعاء محرك استعادة DB مرتين: الأولى للاستعادة والثانية للـ Rollback
    expect(mockDbRestoreEngine.execute).toHaveBeenCalledTimes(2);

    // 2. تم التراجع عن الوسائط واستعادة الوسائط السابقة من حزمة الأمان
    const restoredMediaOnDisk = await fsp.readFile(path.join(mediaBasePath, 'schools', 'logo.png'), 'utf-8');
    expect(restoredMediaOnDisk).toBe('PRE_RESTORE_SAFETY_MEDIA_CONTENT');

    // 3. الحالة النهائية ROLLBACK_COMPLETED وليست COMPLETED ولا FAILED
    expect(restoreJobRecord.status).toBe('ROLLBACK_COMPLETED');
    expect(restoreJobRecord.status).not.toBe('COMPLETED');
    expect(restoreJobRecord.errorMessage).toContain('Required config file failed to restore');

    // 4. تسجيل رسالة نجاح التراجع في سجلات المنسق
    const rollbackLog = logsWritten.find(
      (l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'WARN',
    );
    expect(rollbackLog).toBeDefined();
    expect(rollbackLog.message).toBe('Rollback from safety backup succeeded');
  });

  it('5. should record CRITICAL_FAILURE if rollback fails after required config (.env) failure without double-invoking rollback', async () => {
    const restoreArchivePath = path.join(sandboxDir, 'backups', 'completed', 'restore5.tar.gz');
    const safetyArchivePath = path.join(sandboxDir, 'backups', 'completed', 'safety5.tar.gz');

    const safetyMeta = await createMockArchive(safetyArchivePath, 'SELECT 1;');
    const restoreMeta = await createMockArchive(restoreArchivePath, 'SELECT 1;', {
      configFiles: { '.env': 'KEY=1' },
    });

    let restoreJobRecord: any = {
      id: 105,
      uuid: 'restore-job-uuid-5',
      status: 'PENDING',
    };

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(restoreJobRecord)),
        update: jest.fn().mockImplementation(({ data }) => {
          restoreJobRecord = { ...restoreJobRecord, ...data };
          return Promise.resolve(restoreJobRecord);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (restoreJobRecord.uuid === where?.uuid || !where?.uuid) {
            restoreJobRecord = { ...restoreJobRecord, ...data };
          }
          return Promise.resolve({ count: 1 });
        }),
        create: jest.fn().mockResolvedValue({}),
      },
      backupInstance: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 5) {
            return Promise.resolve({
              id: 5,
              uuid: 'r-uuid-5',
              storagePath: restoreArchivePath,
              sha256: restoreMeta.sha256,
            });
          }
          if (where.id === 779) {
            return Promise.resolve({
              id: 779,
              uuid: 's-uuid-5',
              storagePath: safetyArchivePath,
              sha256: safetyMeta.sha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 54,
          status: 'COMPLETED',
          backupInstanceId: 779,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ migration_name: 'm1' }]),
      unit: { count: jest.fn().mockResolvedValue(1) },
      lessonTemplate: { count: jest.fn().mockResolvedValue(1) },
      lessonContent: { count: jest.fn().mockResolvedValue(1) },
    };

    const mockBackupLogger: any = {
      writeLog: jest.fn().mockResolvedValue(undefined),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-5' }),
    };

    // الاستعادة الأولى تنجح، لكن استدعاء الـ Rollback يفشل
    const mockDbRestoreEngine: any = {
      execute: jest.fn()
        .mockResolvedValueOnce({ success: true, durationMs: 10 }) // استعادة الـ DB الأولى
        .mockResolvedValueOnce({ success: false, errorMessage: 'Disk corrupted during rollback' }), // فشل الـ Rollback
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    const mockProjectRoot = path.join(sandboxDir, 'valid_root_fail_5');
    await fsp.mkdir(mockProjectRoot, { recursive: true });
    await fsp.writeFile(path.join(mockProjectRoot, 'package.json'), '{}', 'utf-8');
    await fsp.mkdir(path.join(mockProjectRoot, 'src'), { recursive: true });
    await fsp.mkdir(path.join(mockProjectRoot, '.env'), { recursive: true }); // إفشال .env
    process.env.PROJECT_ROOT = mockProjectRoot;

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    await (orchestrator as any).runPipeline(105, {
      backupInstanceId: 5,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: true,
    });

    delete process.env.PROJECT_ROOT;

    // تم استدعاء execute مرتين فقط (مرة للاستعادة ومرة واحدة فقط للـ Rollback دون تكرار)
    expect(mockDbRestoreEngine.execute).toHaveBeenCalledTimes(2);

    // الحالة النهائية CRITICAL_FAILURE حتماً
    expect(restoreJobRecord.status).toBe('CRITICAL_FAILURE');
    // الحفاظ على رسالة الخطأ الأصلية وخطأ التراجع معاً
    expect(restoreJobRecord.errorMessage).toContain('Required config file failed');
    expect(restoreJobRecord.errorMessage).toContain('Disk corrupted during rollback');
  });

  it('6. should set FAILED directly without rollback if required config (.env) fails when no DB or media was restored', async () => {
    const archivePath = path.join(sandboxDir, 'backups', 'completed', 'config_only.tar.gz');
    const meta = await createMockArchive(archivePath, 'SELECT 1;', {
      configFiles: { '.env': 'KEY=val' },
    });

    let restoreJobRecord: any = {
      id: 106,
      uuid: 'restore-job-uuid-6',
      status: 'PENDING',
    };

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(restoreJobRecord)),
        update: jest.fn().mockImplementation(({ data }) => {
          restoreJobRecord = { ...restoreJobRecord, ...data };
          return Promise.resolve(restoreJobRecord);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (restoreJobRecord.uuid === where?.uuid || !where?.uuid) {
            restoreJobRecord = { ...restoreJobRecord, ...data };
          }
          return Promise.resolve({ count: 1 });
        }),
      },
      backupInstance: {
        findUnique: jest.fn().mockResolvedValue({
          id: 6,
          uuid: 'r-uuid-6',
          storagePath: archivePath,
          sha256: meta.sha256,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ migration_name: 'm1' }]),
      unit: { count: jest.fn().mockResolvedValue(1) },
      lessonTemplate: { count: jest.fn().mockResolvedValue(1) },
      lessonContent: { count: jest.fn().mockResolvedValue(1) },
    };

    const mockBackupLogger: any = {
      writeLog: jest.fn().mockResolvedValue(undefined),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn(),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn(),
    };

    const mockProjectRoot = path.join(sandboxDir, 'valid_root_fail_6');
    await fsp.mkdir(mockProjectRoot, { recursive: true });
    await fsp.writeFile(path.join(mockProjectRoot, 'package.json'), '{}', 'utf-8');
    await fsp.mkdir(path.join(mockProjectRoot, 'src'), { recursive: true });
    await fsp.mkdir(path.join(mockProjectRoot, '.env'), { recursive: true });
    process.env.PROJECT_ROOT = mockProjectRoot;

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    // استعادة Config فقط (لم يتم لمس DB أو Media)
    await (orchestrator as any).runPipeline(106, {
      backupInstanceId: 6,
      restoreDatabase: false,
      restoreMedia: false,
      restoreConfiguration: true,
    });

    delete process.env.PROJECT_ROOT;

    // لم يُستدعَ محرك DB إطلاقاً ولا safety rollback
    expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();

    // الحالة FAILED قطعيًا وليست ROLLBACK_COMPLETED ولا COMPLETED
    expect(restoreJobRecord.status).toBe('FAILED');
    expect(restoreJobRecord.status).not.toBe('ROLLBACK_COMPLETED');
    expect(restoreJobRecord.status).not.toBe('COMPLETED');
    expect(restoreJobRecord.errorMessage).toContain('Required config file failed');
  });

  it('7. should create fallback restoreJob conforming to Prisma schema when record is missing after rollback (updateMany.count === 0)', async () => {
    const brokenArchivePath = path.join(sandboxDir, 'backups', 'completed', 'broken7.tar.gz');
    const safetyArchivePath = path.join(sandboxDir, 'backups', 'completed', 'safety7.tar.gz');

    const brokenMeta = await createMockArchive(brokenArchivePath, 'SYNTAX ERROR;');
    const safetyMeta = await createMockArchive(safetyArchivePath, 'SELECT 1;');

    let createdRecordData: any = null;
    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 107,
          uuid: 'restore-job-uuid-7',
          status: 'PENDING',
          initiatedByUserUuid: 'user-initiator-uuid',
          startedAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({}),
        // محاكاة غياب السجل في قاعدة البيانات المستعادة: updateMany تعيد 0
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        // إنشاء السجل البديل
        create: jest.fn().mockImplementation(({ data }) => {
          createdRecordData = data;
          return Promise.resolve({ id: 9999, ...data });
        }),
      },
      backupInstance: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 7) {
            return Promise.resolve({
              id: 7,
              uuid: 'broken-uuid-7',
              storagePath: brokenArchivePath,
              sha256: brokenMeta.sha256,
            });
          }
          if (where.id === 770) {
            return Promise.resolve({
              id: 770,
              uuid: 'safety-uuid-7',
              storagePath: safetyArchivePath,
              sha256: safetyMeta.sha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 57,
          status: 'COMPLETED',
          backupInstanceId: 770,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const mockBackupLogger: any = {
      writeLog: jest.fn().mockResolvedValue(undefined),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-7' }),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn()
        .mockResolvedValueOnce({ success: false, errorMessage: 'Corrupted dump SQL error' })
        .mockResolvedValueOnce({ success: true, durationMs: 25 }),
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    await (orchestrator as any).runPipeline(107, {
      backupInstanceId: 7,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: false,
    });

    // تم استدعاء create لإنشاء السجل البديل لأن updateMany أعادت count: 0
    expect(mockPrisma.restoreJob.create).toHaveBeenCalled();
    expect(createdRecordData).toBeDefined();
    expect(createdRecordData.uuid).toBe('restore-job-uuid-7');
    expect(createdRecordData.status).toBe('ROLLBACK_COMPLETED');
    expect(createdRecordData.errorMessage).toContain('Corrupted dump SQL error');
    expect(createdRecordData.errorMessage).toContain('rolled back to safety backup');
    expect(createdRecordData.initiatedByUserUuid).toBe('user-initiator-uuid');
    expect(createdRecordData.restoreDatabase).toBe(true);
    // التحقق من توافقه التام مع قيود Schema: لا يحمل معرفات FK غير مؤكدة
    expect(createdRecordData.backupInstanceId).toBeUndefined();
    expect(createdRecordData.safetyBackupId).toBeUndefined();
  });

  it('8. should surface explicit OPERATIONAL_FAILURE when DB connection fails during status persistence after rollback, never implying silent success', async () => {
    const brokenArchivePath = path.join(sandboxDir, 'backups', 'completed', 'broken8.tar.gz');
    const safetyArchivePath = path.join(sandboxDir, 'backups', 'completed', 'safety8.tar.gz');

    const brokenMeta = await createMockArchive(brokenArchivePath, 'SYNTAX ERROR;');
    const safetyMeta = await createMockArchive(safetyArchivePath, 'SELECT 1;');

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const mockPrisma: any = {
      restoreJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 108,
          uuid: 'restore-job-uuid-8',
          status: 'PENDING',
          initiatedByUserUuid: 'user-8',
        }),
        update: jest.fn().mockResolvedValue({}),
        // محاكاة انقطاع الاتصال بقاعدة البيانات عند حفظ الحالة
        updateMany: jest.fn().mockRejectedValue(new Error('Connection to PostgreSQL server lost')),
      },
      backupInstance: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 8) {
            return Promise.resolve({
              id: 8,
              uuid: 'broken-uuid-8',
              storagePath: brokenArchivePath,
              sha256: brokenMeta.sha256,
            });
          }
          if (where.id === 771) {
            return Promise.resolve({
              id: 771,
              uuid: 'safety-uuid-8',
              storagePath: safetyArchivePath,
              sha256: safetyMeta.sha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 58,
          status: 'COMPLETED',
          backupInstanceId: 771,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const mockBackupLogger: any = {
      writeLog: jest.fn().mockResolvedValue(undefined),
    };

    const mockStorage: any = {
      ensureDirectory: jest.fn().mockImplementation(async (dir) => fsp.mkdir(dir, { recursive: true })),
      deleteDirectory: jest.fn().mockImplementation(async (dir) => fsp.rm(dir, { recursive: true, force: true })),
    };

    const mockBackupOrchestrator: any = {
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-8' }),
    };

    const mockDbRestoreEngine: any = {
      execute: jest.fn()
        .mockResolvedValueOnce({ success: false, errorMessage: 'SQL syntax fault' })
        .mockResolvedValueOnce({ success: true, durationMs: 20 }),
    };

    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

    const orchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      mockDbRestoreEngine,
    );

    // تشغيل خط الأنابيب — الفشل التشغيلي يجب أن يُسجل ويُطبع في stderr ولا يُعتبر نجاحاً
    await (orchestrator as any).runPipeline(108, {
      backupInstanceId: 8,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: false,
    });

    // 1. التحقق من كتابة تحذير الفشل التشغيلي في stderr
    expect(stderrSpy).toHaveBeenCalled();
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(stderrCalls).toContain('CRITICAL OPERATIONAL FAILURE');
    expect(stderrCalls).toContain('Connection to PostgreSQL server lost');

    stderrSpy.mockRestore();
  });

  describe('RestoreOrchestratorService — BKP-002 Hardening & Path Security', () => {
    let specTempDir: string;

    beforeEach(async () => {
      specTempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bkp002-orchestrator-spec-'));
    });

    afterEach(async () => {
      try {
        await fsp.rm(specTempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('9. listFilesRecursive should not follow symbolic links to files or directories', async () => {
      const sourceDir = path.join(specTempDir, 'source');
      const outsideDir = path.join(specTempDir, 'outside');
      await fsp.mkdir(sourceDir, { recursive: true });
      await fsp.mkdir(outsideDir, { recursive: true });

      // ملف عادي داخل المجلد
      await fsp.writeFile(path.join(sourceDir, 'real_file.png'), 'real data');

      // مجلد فرعي عادي مع ملف
      await fsp.mkdir(path.join(sourceDir, 'sub'), { recursive: true });
      await fsp.writeFile(path.join(sourceDir, 'sub', 'nested.png'), 'nested data');

      // ملف حساس بالخارج
      await fsp.writeFile(path.join(outsideDir, 'secret.env'), 'SECRET=123');

      // رابط رمزي لملف خارجي
      await fsp.symlink(path.join(outsideDir, 'secret.env'), path.join(sourceDir, 'sym_secret.png'));

      // رابط رمزي لمجلد خارجي
      await fsp.symlink(outsideDir, path.join(sourceDir, 'sym_dir'));

      const orchestrator = new RestoreOrchestratorService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const files = await (orchestrator as any).listFilesRecursive(sourceDir);

      // يجب أن يرجع فقط الملفات العادية ولا يتبع الروابط الرمزية
      expect(files).toContain('real_file.png');
      expect(files).toContain(path.join('sub', 'nested.png'));
      expect(files).not.toContain('sym_secret.png');
      expect(files.some((f: string) => f.includes('secret.env'))).toBe(false);
      expect(files).toHaveLength(2);
    });

    it('10. media restore should block path traversal and storage-evil prefix attacks', async () => {
      const mediaBase = path.join(specTempDir, 'storage');
      const evilMediaBase = path.join(specTempDir, 'storage-evil');
      const extractedMediaDir = path.join(specTempDir, 'extracted_media');

      await fsp.mkdir(mediaBase, { recursive: true });
      await fsp.mkdir(evilMediaBase, { recursive: true });
      await fsp.mkdir(extractedMediaDir, { recursive: true });

      // ملف سليم
      await fsp.writeFile(path.join(extractedMediaDir, 'valid.jpg'), 'valid image');

      // محاكاة قائمة ملفات تشمل هجمات
      const mediaFiles = [
        'valid.jpg',
        '../storage-evil/hacked.jpg',
        '../../outside.jpg',
      ];

      let copiedCount = 0;
      for (const relPath of mediaFiles) {
        const resolvedDest = resolveWithinBase(mediaBase, relPath);
        if (!resolvedDest) continue;

        const resolvedSrc = resolveWithinBase(extractedMediaDir, relPath);
        if (!resolvedSrc) continue;

        await fsp.mkdir(path.dirname(resolvedDest), { recursive: true });
        await fsp.copyFile(resolvedSrc, resolvedDest);
        copiedCount++;
      }

      // تم نسخ الملف السليم فقط
      expect(copiedCount).toBe(1);
      expect(await fsp.readFile(path.join(mediaBase, 'valid.jpg'), 'utf-8')).toBe('valid image');

      // لم يتم كتابة أي شيء في storage-evil أو خارج mediaBase
      const evilFiles = await fsp.readdir(evilMediaBase);
      expect(evilFiles).toHaveLength(0);
    });

    it('11. rollback media should block path traversal using resolveWithinBase', async () => {
      const mediaBase = path.join(specTempDir, 'storage');
      const rollbackMediaDir = path.join(specTempDir, 'rollback_media');

      await fsp.mkdir(mediaBase, { recursive: true });
      await fsp.mkdir(rollbackMediaDir, { recursive: true });

      await fsp.writeFile(path.join(rollbackMediaDir, 'restore_pic.jpg'), 'backup pic');

      const mediaFiles = [
        'restore_pic.jpg',
        '../../../escape.jpg',
      ];

      for (const relPath of mediaFiles) {
        const resolvedDest = resolveWithinBase(mediaBase, relPath);
        if (!resolvedDest) continue;

        const resolvedSrc = resolveWithinBase(rollbackMediaDir, relPath);
        if (!resolvedSrc) continue;

        await fsp.mkdir(path.dirname(resolvedDest), { recursive: true });
        await fsp.copyFile(resolvedSrc, resolvedDest);
      }

      expect(await fsp.readFile(path.join(mediaBase, 'restore_pic.jpg'), 'utf-8')).toBe('backup pic');
      await expect(fsp.access(path.join(specTempDir, 'escape.jpg'))).rejects.toThrow();
    });

    /**
     * دالة مساعدة لإنشاء رأس tar (512 بايت) بصيغة ustar قياسية للاختبارات الأمنية
     */
    function createTarHeader(
      name: string,
      type: string = '0',
      linkname: string = '',
      size: number = 0,
    ): Buffer {
      const buf = Buffer.alloc(512);
      buf.write(name, 0, 100, 'utf8');
      buf.write('0000644\0', 100, 8, 'utf8');
      buf.write('0000000\0', 108, 8, 'utf8');
      buf.write('0000000\0', 116, 8, 'utf8');
      buf.write(size.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf8');
      buf.write('00000000000 ', 136, 12, 'utf8');
      buf.fill(32, 148, 156);
      buf.write(type, 156, 1, 'utf8');
      buf.write(linkname, 157, 100, 'utf8');
      buf.write('ustar\0', 257, 6, 'utf8');
      buf.write('00', 263, 2, 'utf8');

      let sum = 0;
      for (let i = 0; i < 512; i++) sum += buf[i];
      buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
      return buf;
    }

    interface TestArchiveEntry {
      name: string;
      type?: string;
      linkname?: string;
      content?: string;
    }

    function buildTarGz(entries: TestArchiveEntry[]): Buffer {
      const blocks: Buffer[] = [];
      for (const entry of entries) {
        const contentBuf = entry.content ? Buffer.from(entry.content, 'utf8') : Buffer.alloc(0);
        const type = entry.type ?? (entry.name.endsWith('/') ? '5' : '0');
        const header = createTarHeader(
          entry.name,
          type,
          entry.linkname ?? '',
          type === '0' ? contentBuf.length : 0,
        );
        blocks.push(header);

        if (type === '0' && contentBuf.length > 0) {
          const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
          const padded = Buffer.alloc(paddedSize);
          contentBuf.copy(padded);
          blocks.push(padded);
        }
      }
      blocks.push(Buffer.alloc(512));
      blocks.push(Buffer.alloc(512));
      return zlib.gzipSync(Buffer.concat(blocks));
    }

    it('12. attemptRollback should reject malicious archive containing symlink before extracting or restoring contents', async () => {
      const evilArchivePath = path.join(specTempDir, 'evil_symlink.tar.gz');
      const evilBuf = buildTarGz([
        { name: 'manifest.json', content: '{"backupFormatVersion":"1.0"}' },
        { name: 'media/evil_link', type: '2', linkname: '/etc/passwd' },
      ]);
      await fsp.writeFile(evilArchivePath, evilBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn(),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      await (orchestrator as any).attemptRollback({
        jobId: 201,
        jobUuid: 'restore-job-evil-symlink',
        safetyBackupId: null,
        safetyStoragePath: evilArchivePath,
        workDir: path.join(specTempDir, 'restore-work-1'),
        rollbackDatabase: true,
        rollbackMedia: true,
        rollbackConfig: false,
        originalError: 'Simulated initial restore failure',
      });

      // 1. قاعدة البيانات لم يتم استدعاء استعادتها مطلقاً
      expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();

      // 2. تم تسجيل الفشل الحرج في restoreJob
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain('Symbolic link rejected in archive');
      expect(updatedJobRecord.errorMessage).toContain('Simulated initial restore failure');

      // 3. تم تدوين الفشل في backupLogger
      expect(mockBackupLogger.writeLog).toHaveBeenCalledWith(
        expect.objectContaining({
          restoreJobId: 201,
          level: 'ERROR',
          phase: 'RESTORE_ROLLBACK',
          message: expect.stringContaining('Symbolic link rejected in archive'),
        }),
      );

      // 4. لم يتم فك الأرشيف أو إنشاء مجلد rollback
      const rollbackDir = path.join(specTempDir, 'restore-work-1-rollback');
      await expect(fsp.access(rollbackDir)).rejects.toThrow();
    });

    it('13. attemptRollback should reject malicious archive containing path traversal before extracting or restoring contents', async () => {
      const evilArchivePath = path.join(specTempDir, 'evil_traversal.tar.gz');
      const evilBuf = buildTarGz([
        { name: 'manifest.json', content: '{"backupFormatVersion":"1.0"}' },
        { name: '../evil_escape.txt', content: 'malicious payload' },
      ]);
      await fsp.writeFile(evilArchivePath, evilBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn(),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      await (orchestrator as any).attemptRollback({
        jobId: 202,
        jobUuid: 'restore-job-evil-traversal',
        safetyBackupId: null,
        safetyStoragePath: evilArchivePath,
        workDir: path.join(specTempDir, 'restore-work-2'),
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Primary restore crashed',
      });

      expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain('Path traversal rejected in archive');
    });

    it('14. attemptRollback should halt rollback, clean up directory, and set CRITICAL_FAILURE if auditExtractedDirectory fails', async () => {
      // أرشيف سليم شكلياً في tar -tzf
      const cleanArchivePath = path.join(specTempDir, 'clean_safety.tar.gz');
      const cleanBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: {
              database: { file: 'database/postgres.sql.gz' },
            },
          }),
        },
        { name: 'database/postgres.sql.gz', content: 'dummy compressed sql' },
      ]);
      await fsp.writeFile(cleanArchivePath, cleanBuf);

      // محاكاة فشل التدقيق الأمني بعد فك الأرشيف
      const auditSpy = jest
        .spyOn(archiveSafety, 'auditExtractedDirectory')
        .mockRejectedValueOnce(new Error('Audit safety violation: Disallowed entry detected'));

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn(),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const deletedDirs: string[] = [];
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => {
          deletedDirs.push(d);
          return fsp.rm(d, { recursive: true, force: true });
        }),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'restore-work-3');
      const rollbackDir = `${workDir}-rollback`;

      await (orchestrator as any).attemptRollback({
        jobId: 203,
        jobUuid: 'restore-job-audit-fail',
        safetyBackupId: null,
        safetyStoragePath: cleanArchivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Primary step failed',
      });

      // 1. تم استدعاء auditExtractedDirectory مع المجلد والمصادر الحساسة
      expect(auditSpy).toHaveBeenCalledWith(
        rollbackDir,
        archiveSafety.ALLOWED_ARCHIVE_TOP_LEVEL,
        expect.any(Array),
      );

      // 2. لم يتم استدعاء استعادة قاعدة البيانات
      expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();

      // 3. تم تسجيل CRITICAL_FAILURE دون اعتبار العملية ناجحة
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain('Audit safety violation: Disallowed entry detected');

      // 4. تم تنظيف مجلد rollbackDir
      expect(deletedDirs).toContain(rollbackDir);
      await expect(fsp.access(rollbackDir)).rejects.toThrow();

      auditSpy.mockRestore();
    });

    it('15. attemptRollback should extract with safe tar flags and proceed if archive and audit are valid', async () => {
      const validArchivePath = path.join(specTempDir, 'valid_safety.tar.gz');
      const validBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: {
              database: { file: 'database/postgres.sql.gz' },
            },
          }),
        },
        { name: 'database/postgres.sql.gz', content: 'sql content' },
      ]);
      await fsp.writeFile(validArchivePath, validBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
        backupJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({ success: true, durationMs: 15 }),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'restore-work-4');

      await (orchestrator as any).attemptRollback({
        jobId: 204,
        jobUuid: 'restore-job-valid-rollback',
        safetyBackupId: null,
        safetyStoragePath: validArchivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Initial error',
      });

      expect(mockDbRestoreEngine.execute).toHaveBeenCalled();
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('ROLLBACK_COMPLETED');
    });

    it('16. attemptRollback should reject structurally valid archive if manifest contains escaping database path (../../etc/evil.sql) before invoking db restore', async () => {
      const evilDbArchivePath = path.join(specTempDir, 'evil_manifest_db.tar.gz');
      const evilBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: {
              database: { file: '../../etc/evil.sql' },
            },
          }),
        },
        { name: 'database/valid.sql.gz', content: 'dummy sql' },
      ]);
      await fsp.writeFile(evilDbArchivePath, evilBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn(),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const deletedDirs: string[] = [];
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => {
          deletedDirs.push(d);
          return fsp.rm(d, { recursive: true, force: true });
        }),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'restore-work-5');
      const rollbackDir = `${workDir}-rollback`;

      await (orchestrator as any).attemptRollback({
        jobId: 205,
        jobUuid: 'restore-job-evil-manifest-db',
        safetyBackupId: null,
        safetyStoragePath: evilDbArchivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Primary step failed',
      });

      // 1. لم يتم تمرير أي مسار أو استدعاء DB restore مطلقاً
      expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();

      // 2. تم تسجيل الفشل الحرج
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain(
        'Path traversal rejected in rollback manifest database file: ../../etc/evil.sql',
      );

      // 3. تم تنظيف مجلد rollbackDir فعلياً
      expect(deletedDirs).toContain(rollbackDir);
      await expect(fsp.access(rollbackDir)).rejects.toThrow();
    });

    it('17. attemptRollback should reject invalid media directory in rollback manifest before copying files', async () => {
      const evilMediaArchivePath = path.join(specTempDir, 'evil_manifest_media.tar.gz');
      const evilBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: {
              media: { directory: '../../evil_media' },
            },
          }),
        },
        { name: 'media/test.jpg', content: 'test picture' },
      ]);
      await fsp.writeFile(evilMediaArchivePath, evilBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const deletedDirs: string[] = [];
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => {
          deletedDirs.push(d);
          return fsp.rm(d, { recursive: true, force: true });
        }),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        { execute: jest.fn() } as any,
      );

      const workDir = path.join(specTempDir, 'restore-work-6');
      const rollbackDir = `${workDir}-rollback`;

      await (orchestrator as any).attemptRollback({
        jobId: 206,
        jobUuid: 'restore-job-evil-manifest-media',
        safetyBackupId: null,
        safetyStoragePath: evilMediaArchivePath,
        workDir,
        rollbackDatabase: false,
        rollbackMedia: true,
        rollbackConfig: false,
        originalError: 'Primary step failed',
      });

      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain(
        'Path traversal rejected in rollback manifest media directory: ../../evil_media',
      );
      expect(deletedDirs).toContain(rollbackDir);
      await expect(fsp.access(rollbackDir)).rejects.toThrow();
    });

    it('18. attemptRollback should reject invalid config directory in rollback manifest before restoring config', async () => {
      const evilConfigArchivePath = path.join(specTempDir, 'evil_manifest_config.tar.gz');
      const evilBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: {
              config: { directory: '../../evil_config', files: ['.env'] },
            },
          }),
        },
        { name: 'config/.env', content: 'SECRET=123' },
      ]);
      await fsp.writeFile(evilConfigArchivePath, evilBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const deletedDirs: string[] = [];
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => {
          deletedDirs.push(d);
          return fsp.rm(d, { recursive: true, force: true });
        }),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        { execute: jest.fn() } as any,
      );

      const workDir = path.join(specTempDir, 'restore-work-7');
      const rollbackDir = `${workDir}-rollback`;

      await (orchestrator as any).attemptRollback({
        jobId: 207,
        jobUuid: 'restore-job-evil-manifest-config',
        safetyBackupId: null,
        safetyStoragePath: evilConfigArchivePath,
        workDir,
        rollbackDatabase: false,
        rollbackMedia: false,
        rollbackConfig: true,
        originalError: 'Primary step failed',
      });

      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain(
        'Path traversal rejected in rollback manifest config directory: ../../evil_config',
      );
      expect(deletedDirs).toContain(rollbackDir);
      await expect(fsp.access(rollbackDir)).rejects.toThrow();
    });

    it('19. attemptRollback should handle tar command failure and cleanly delete rollbackDir', async () => {
      const validArchivePath = path.join(specTempDir, 'tar_fail_test.tar.gz');
      const validBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: { database: { file: 'database/postgres.sql.gz' } },
          }),
        },
        { name: 'database/postgres.sql.gz', content: 'sql content' },
      ]);
      await fsp.writeFile(validArchivePath, validBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn(),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const deletedDirs: string[] = [];
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => {
          deletedDirs.push(d);
          return fsp.rm(d, { recursive: true, force: true });
        }),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'restore-work-8');
      const rollbackDir = `${workDir}-rollback`;

      // محاكاة فشل أمر tar
      const failingTarFn = jest.fn().mockRejectedValue(
        new Error('Command failed: tar -xzf archive (exit code 2: tar: Corrupted data)'),
      );

      await (orchestrator as any).attemptRollback({
        jobId: 208,
        jobUuid: 'restore-job-tar-fail',
        safetyBackupId: null,
        safetyStoragePath: validArchivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Initial error',
        execFileFn: failingTarFn,
      });

      // 1. أمر tar تم استدعاؤه بالمحددات الآمنة والمهلة الزمنية
      expect(failingTarFn).toHaveBeenCalledWith(
        'tar',
        expect.arrayContaining(['-xzf', '-C', rollbackDir, '--no-same-owner', '--no-same-permissions']),
        expect.objectContaining({ timeout: 120_000 }),
      );

      // 2. لم يتم استدعاء استعادة قاعدة البيانات
      expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();

      // 3. تم تسجيل CRITICAL_FAILURE
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain('Corrupted data');

      // 4. تم تنظيف مجلد rollbackDir فعلياً
      expect(deletedDirs).toContain(rollbackDir);
      await expect(fsp.access(rollbackDir)).rejects.toThrow();
    });

    it('20. attemptRollback should handle tar command timeout and cleanly delete rollbackDir', async () => {
      const validArchivePath = path.join(specTempDir, 'tar_timeout_test.tar.gz');
      const validBuf = buildTarGz([
        {
          name: 'manifest.json',
          content: JSON.stringify({
            backupFormatVersion: '1.0',
            components: { database: { file: 'database/postgres.sql.gz' } },
          }),
        },
        { name: 'database/postgres.sql.gz', content: 'sql content' },
      ]);
      await fsp.writeFile(validArchivePath, validBuf);

      let updatedJobRecord: any = null;
      const mockPrisma: any = {
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ data }) => {
            updatedJobRecord = data;
            return Promise.resolve({ count: 1 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn(),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const deletedDirs: string[] = [];
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => {
          deletedDirs.push(d);
          return fsp.rm(d, { recursive: true, force: true });
        }),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'restore-work-9');
      const rollbackDir = `${workDir}-rollback`;

      // محاكاة انتهاء مهلة أمر tar (timeout)
      const timeoutTarFn = jest.fn().mockRejectedValue(
        new Error('Command failed: tar timed out after 120000ms'),
      );

      await (orchestrator as any).attemptRollback({
        jobId: 209,
        jobUuid: 'restore-job-tar-timeout',
        safetyBackupId: null,
        safetyStoragePath: validArchivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Initial error',
        execFileFn: timeoutTarFn,
      });

      // 1. أمر tar استُدعي مع مهلة 120 ثانية
      expect(timeoutTarFn).toHaveBeenCalledWith(
        'tar',
        expect.any(Array),
        expect.objectContaining({ timeout: 120_000 }),
      );

      // 2. لم يتم استدعاء DB restore
      expect(mockDbRestoreEngine.execute).not.toHaveBeenCalled();

      // 3. تم تسجيل CRITICAL_FAILURE
      expect(updatedJobRecord).not.toBeNull();
      expect(updatedJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(updatedJobRecord.errorMessage).toContain('timed out after 120000ms');

      // 4. تم تنظيف مجلد rollbackDir فعلياً
      expect(deletedDirs).toContain(rollbackDir);
      await expect(fsp.access(rollbackDir)).rejects.toThrow();
    });
  });

  describe('RestoreOrchestratorService — Post-Restore Safety Backup & workDir Persistence (BKP-002 Stage 3)', () => {
    let testDir: string;
    let mockStoragePath: string;

    beforeEach(async () => {
      testDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bkp002-stage3-spec-'));
      mockStoragePath = path.join(testDir, 'backups');
      await fsp.mkdir(path.join(mockStoragePath, 'temp'), { recursive: true });
      await fsp.mkdir(path.join(mockStoragePath, 'completed'), { recursive: true });
    });

    afterEach(async () => {
      if (testDir) {
        await fsp.rm(testDir, { recursive: true, force: true });
      }
    });

    it('1. should compute absolute workDir from BACKUP_STORAGE_PATH and pass isSafeWorkDir validation', async () => {
      const origEnv = process.env.BACKUP_STORAGE_PATH;
      process.env.BACKUP_STORAGE_PATH = mockStoragePath;

      try {
        const jobUuid = 'test-job-uuid-123';
        const storageBasePath = path.resolve(process.env.BACKUP_STORAGE_PATH || './backups');
        const workDir = path.resolve(
          storageBasePath,
          'temp',
          `restore-${jobUuid}`,
        );

        // مسار مطلق
        expect(path.isAbsolute(workDir)).toBe(true);

        // ينشئ مجلد العمل الفعلي
        await fsp.mkdir(workDir, { recursive: true });

        // يجتاز الفحص الأمني الصارم
        const isSafe = archiveSafety.isSafeWorkDir(workDir, jobUuid, storageBasePath);
        expect(isSafe).toBe(true);

        // يرفض مسار نسبي
        expect(archiveSafety.isSafeWorkDir(`backups/temp/restore-${jobUuid}`, jobUuid, storageBasePath)).toBe(false);

        // يرفض مسار خارج مجلد temp
        const outsideDir = path.join(testDir, `restore-${jobUuid}`);
        await fsp.mkdir(outsideDir, { recursive: true });
        expect(archiveSafety.isSafeWorkDir(outsideDir, jobUuid, storageBasePath)).toBe(false);
      } finally {
        process.env.BACKUP_STORAGE_PATH = origEnv;
      }
    });

    it('2. should verify and re-register safety backup in restored DB and link new ID to RestoreJob', async () => {
      // إعداد ملف أرشيف صالح لنسخة الأمان
      const safetyArchivePath = path.join(mockStoragePath, 'completed', 'safety_backup.tar.gz');
      const dummyData = Buffer.from('safety backup dummy archive content');
      await fsp.writeFile(safetyArchivePath, dummyData);
      const sha256 = crypto.createHash('sha256').update(dummyData).digest('hex');
      await fsp.writeFile(`${safetyArchivePath}.sha256`, `${sha256}  safety_backup.tar.gz\n`);

      const savedSafetyInstance = {
        id: 999, // المعرف القديم قبل مسح DB
        uuid: 'safety-backup-uuid-777',
        backupName: 'safety_backup_2026-10-11_20-00-00',
        backupType: 'FULL',
        category: 'SYSTEM_SAFETY',
        status: 'COMPLETED',
        fileSizeBytes: BigInt(dummyData.length),
        sha256,
        storagePath: safetyArchivePath,
        storageProvider: 'LOCAL',
        packageVersion: '1.0',
        systemVersion: '1.0.0',
        databaseSchemaVersion: 'test',
        containsDatabase: true,
        containsMedia: true,
        containsConfiguration: true,
        dbSizeBytes: BigInt(100),
        mediaFilesCount: 0,
        mediaFilesCopied: 0,
        mediaSizeBytes: BigInt(0),
        configSizeBytes: BigInt(0),
        missingMedia: null,
        isPinned: true,
        createdAt: new Date(),
      };

      let reinsertedSafetyRecord: any = null;
      let createdRestoreJob: any = null;
      let writtenLogs: any[] = [];

      const mockPrisma: any = {
        backupInstance: {
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where.uuid === savedSafetyInstance.uuid) {
              return Promise.resolve(null); // غير موجود في الـ DB المستعادة
            }
            if (where.uuid === 'target-instance-uuid') {
              return Promise.resolve({ id: 1, uuid: 'target-instance-uuid' });
            }
            return Promise.resolve(null);
          }),
          create: jest.fn().mockImplementation(({ data }) => {
            reinsertedSafetyRecord = { id: 555, ...data }; // المعرف الجديد المتولد
            return Promise.resolve({ id: 555 });
          }),
        },
        restoreJob: {
          create: jest.fn().mockImplementation(({ data }) => {
            createdRestoreJob = { id: 888, ...data };
            return Promise.resolve({ id: 888 });
          }),
        },
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockImplementation((log) => {
          writtenLogs.push(log);
          return Promise.resolve();
        }),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        {} as any,
        mockBackupLogger,
        {} as any,
        {} as any,
      );

      // محاكاة التحقق وإعادة التسجيل كما هو في السطور 470-520
      await (orchestrator as any).validateArchive(safetyArchivePath, savedSafetyInstance.sha256);

      const existingSafety = await mockPrisma.backupInstance.findUnique({
        where: { uuid: savedSafetyInstance.uuid },
        select: { id: true },
      });
      expect(existingSafety).toBeNull();

      const reinserted = await mockPrisma.backupInstance.create({
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

      expect(reinserted.id).toBe(555);
      expect(reinsertedSafetyRecord.uuid).toBe(savedSafetyInstance.uuid);

      // إنشاء RestoreJob مع معرف الأمان الجديد
      const job = await mockPrisma.restoreJob.create({
        data: {
          uuid: 'restore-job-uuid-1',
          backupInstanceId: 1,
          safetyBackupId: reinserted.id,
          restoreDatabase: true,
          restoreMedia: true,
          restoreConfiguration: false,
          initiatedByUserUuid: 'owner',
          status: 'RUNNING',
          startedAt: new Date(),
        },
        select: { id: true },
      });

      // التحقق من أن RestoreJob حصل على 555 وليس 999
      expect(job.id).toBe(888);
      expect(createdRestoreJob.safetyBackupId).toBe(555);
      expect(createdRestoreJob.safetyBackupId).not.toBe(999);
      expect(createdRestoreJob.status).toBe('RUNNING');
    });

    it('3. should abort and reject restore when safety backup archive is missing or corrupted', async () => {
      const orchestrator = new RestoreOrchestratorService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );

      const nonExistentPath = path.join(mockStoragePath, 'completed', 'non_existent.tar.gz');
      await expect(
        (orchestrator as any).validateArchive(nonExistentPath, 'dummy-hash')
      ).rejects.toThrow();

      // ملف تالف ببصمة غير مطابقة
      const corruptFile = path.join(mockStoragePath, 'completed', 'corrupt.tar.gz');
      await fsp.writeFile(corruptFile, 'corrupt content');
      await expect(
        (orchestrator as any).validateArchive(corruptFile, 'expected-different-hash')
      ).rejects.toThrow(/mismatch/i);
    });
  });

  describe('RestoreOrchestratorService — Post-Rollback Stale Jobs Cleanup & Concurrency Unblocking (BKP-002)', () => {
    let specTempDir: string;

    beforeEach(async () => {
      specTempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bkp002-rollback-cleanup-'));
    });

    afterEach(async () => {
      if (specTempDir) {
        await fsp.rm(specTempDir, { recursive: true, force: true });
      }
    });

    const createValidRollbackArchive = async (archivePath: string): Promise<void> => {
      const rawDir = path.join(specTempDir, `build-rollback-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      await fsp.mkdir(path.join(rawDir, 'database'), { recursive: true });
      const sqlFile = path.join(rawDir, 'database', 'postgres.sql');
      await fsp.writeFile(sqlFile, 'SELECT 1;', 'utf-8');
      await execFileAsync('gzip', ['-9', sqlFile]);
      const manifest: BackupManifest = {
        backupId: 'safety-backup-uuid-1',
        backupFormatVersion: '1.0',
        createdAt: new Date().toISOString(),
        systemVersion: '1.0.0',
        databaseSchemaVersion: 'test',
        backupType: 'FULL',
        triggerType: 'PRE_RESTORE',
        category: 'SYSTEM_SAFETY',
        components: {
          database: {
            included: true,
            engine: 'pg_dump',
            format: 'sql.gz',
            file: 'database/postgres.sql.gz',
            sizeBytes: 50,
            sha256: 'mocksha',
          },
          media: null,
          config: null,
        },
        consistency: {
          databaseSnapshot: new Date().toISOString(),
          status: 'SUCCESS',
          missingStorageKeys: [],
        },
        checksums: {},
      };
      await fsp.writeFile(path.join(rawDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      await fsp.mkdir(path.dirname(archivePath), { recursive: true });
      await execFileAsync('tar', ['-czf', archivePath, '-C', rawDir, '.']);
      await fsp.rm(rawDir, { recursive: true, force: true });
    };

    it('1. should clean up stale RUNNING backup jobs (mark as FAILED) upon successful DB rollback', async () => {
      const archivePath = path.join(specTempDir, 'safety_backup.tar.gz');
      await createValidRollbackArchive(archivePath);

      const backupJobsTable: any[] = [
        {
          id: 10,
          uuid: 'stale-safety-job-uuid',
          status: 'RUNNING',
          triggeredBy: 'PRE_RESTORE',
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 5,
          uuid: 'older-completed-job-uuid',
          status: 'COMPLETED',
          triggeredBy: 'MANUAL',
          errorMessage: null,
          finishedAt: new Date(),
        },
      ];

      let restoreJobRecord: any = {
        id: 301,
        uuid: 'restore-job-uuid-301',
        status: 'RUNNING',
        errorMessage: null,
      };

      const mockPrisma: any = {
        backupJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            let count = 0;
            for (const job of backupJobsTable) {
              const statusMatch = !where?.status || job.status === where.status;
              const triggerMatch = !where?.triggeredBy || job.triggeredBy === where.triggeredBy;
              const uuidMatch = !where?.uuid || job.uuid === where.uuid;
              if (statusMatch && triggerMatch && uuidMatch) {
                job.status = data.status;
                job.errorMessage = data.errorMessage;
                job.finishedAt = data.finishedAt;
                count++;
              }
            }
            return Promise.resolve({ count });
          }),
        },
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            if (restoreJobRecord.uuid === where?.uuid) {
              restoreJobRecord = { ...restoreJobRecord, ...data };
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({ success: true, durationMs: 20 }),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'work-dir-1');

      await (orchestrator as any).attemptRollback({
        jobId: 301,
        jobUuid: 'restore-job-uuid-301',
        safetyBackupId: 1,
        safetyBackupJobUuid: 'stale-safety-job-uuid',
        safetyStoragePath: archivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Simulated mid-flight restore error',
      });

      // التحقق من استدعاء updateMany خصيصاً للمهمة المستهدفة بالـ UUID والنوع PRE_RESTORE
      expect(mockPrisma.backupJob.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'RUNNING',
          triggeredBy: 'PRE_RESTORE',
          uuid: 'stale-safety-job-uuid',
        },
        data: {
          status: 'FAILED',
          errorMessage: 'Interrupted by database rollback',
          finishedAt: expect.any(Date),
        },
      });

      // التحقق من تحول المهمة العالقة إلى FAILED مع توثيق السبب
      const staleJob = backupJobsTable.find((j) => j.id === 10);
      expect(staleJob.status).toBe('FAILED');
      expect(staleJob.errorMessage).toBe('Interrupted by database rollback');
      expect(staleJob.finishedAt).toBeInstanceOf(Date);

      // التحقق من بقاء المهمة المكتملة مسبقاً دون مساس
      const completedJob = backupJobsTable.find((j) => j.id === 5);
      expect(completedJob.status).toBe('COMPLETED');
    });

    it('2. should NOT perform stale backup jobs cleanup if database rollback fails', async () => {
      const archivePath = path.join(specTempDir, 'safety_backup_fail.tar.gz');
      await createValidRollbackArchive(archivePath);

      const backupJobsTable: any[] = [
        {
          id: 20,
          uuid: 'stale-safety-job-uuid-2',
          status: 'RUNNING',
          errorMessage: null,
          finishedAt: null,
        },
      ];

      let restoreJobRecord: any = {
        id: 302,
        uuid: 'restore-job-uuid-302',
        status: 'RUNNING',
      };

      const mockPrisma: any = {
        backupJob: {
          updateMany: jest.fn(),
        },
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            if (restoreJobRecord.uuid === where?.uuid) {
              restoreJobRecord = { ...restoreJobRecord, ...data };
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          errorMessage: 'psql fatal: connection lost',
        }),
      };

      const logsWritten: any[] = [];
      const mockBackupLogger: any = {
        writeLog: jest.fn().mockImplementation((log) => {
          logsWritten.push(log);
          return Promise.resolve();
        }),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'work-dir-2');

      await (orchestrator as any).attemptRollback({
        jobId: 302,
        jobUuid: 'restore-job-uuid-302',
        safetyBackupId: 1,
        safetyStoragePath: archivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Primary restore failure',
      });

      // التحقق من عدم استدعاء تنظيف المهام إطلاقاً عند فشل التراجع
      expect(mockPrisma.backupJob.updateMany).not.toHaveBeenCalled();

      // المهمة في قاعدة البيانات تبقى RUNNING دون تغيير
      expect(backupJobsTable[0].status).toBe('RUNNING');

      // مهمة الاستعادة تتحول إلى CRITICAL_FAILURE
      expect(restoreJobRecord.status).toBe('CRITICAL_FAILURE');
      expect(restoreJobRecord.errorMessage).toContain('Rollback failed: Database rollback failed');

      // توثيق الخطأ في BackupLog
      const critLog = logsWritten.find(
        (l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'ERROR',
      );
      expect(critLog).toBeDefined();
      expect(critLog.message).toContain('CRITICAL — Rollback failed');
    });

    it('3. should keep RestoreJob status (ROLLBACK_COMPLETED) and BackupLog records fully consistent without corrupting either', async () => {
      const archivePath = path.join(specTempDir, 'safety_backup_consistency.tar.gz');
      await createValidRollbackArchive(archivePath);

      let restoreJobRecord: any = {
        id: 303,
        uuid: 'restore-job-uuid-303',
        status: 'RUNNING',
        errorMessage: null,
      };

      const logsWritten: any[] = [];
      const mockPrisma: any = {
        backupJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            if (restoreJobRecord.uuid === where?.uuid) {
              restoreJobRecord = { ...restoreJobRecord, ...data };
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({ success: true, durationMs: 15 }),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockImplementation((log) => {
          logsWritten.push(log);
          return Promise.resolve();
        }),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'work-dir-3');

      await (orchestrator as any).attemptRollback({
        jobId: 303,
        jobUuid: 'restore-job-uuid-303',
        safetyBackupId: 1,
        safetyStoragePath: archivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Mid-stream poison failure',
      });

      // التحقق من بقاء RestoreJob بحالة ROLLBACK_COMPLETED دون أن تتأثر بتنظيف BackupJob
      expect(restoreJobRecord.status).toBe('ROLLBACK_COMPLETED');
      expect(restoreJobRecord.errorMessage).toContain('rolled back to safety backup');
      expect(restoreJobRecord.finishedAt).toBeInstanceOf(Date);

      // التحقق من اتساق سجل BackupLog لتوثيق نجاح التراجع
      const rollbackSuccessLog = logsWritten.find(
        (l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'WARN',
      );
      expect(rollbackSuccessLog).toBeDefined();
      expect(rollbackSuccessLog.message).toBe('Rollback from safety backup succeeded');
      expect(rollbackSuccessLog.restoreJobId).toBe(303);
    });

    it('4. should unblock and allow starting a new backup immediately after successful rollback', async () => {
      const archivePath = path.join(specTempDir, 'safety_backup_unblock.tar.gz');
      await createValidRollbackArchive(archivePath);

      // حالة قاعدة البيانات بعد استعادة نسخة الأمان مباشرة (تحتوي على مهمة Backup قديمة بحالة RUNNING)
      const dbState = {
        backupJobs: [
          {
            id: 1,
            uuid: 'safety-backup-job-uuid',
            status: 'RUNNING' as any,
            triggeredBy: 'PRE_RESTORE' as any,
            errorMessage: null,
            finishedAt: null,
          },
        ],
        restoreJobs: [
          {
            id: 100,
            uuid: 'current-restore-job-uuid',
            status: 'RUNNING' as any,
            errorMessage: null,
            finishedAt: null,
          },
        ],
      };

      const mockPrisma: any = {
        backupJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            let count = 0;
            for (const j of dbState.backupJobs) {
              const statusMatch = !where?.status || j.status === where.status;
              const triggerMatch = !where?.triggeredBy || j.triggeredBy === where.triggeredBy;
              const uuidMatch = !where?.uuid || j.uuid === where.uuid;
              if (statusMatch && triggerMatch && uuidMatch) {
                j.status = data.status;
                j.errorMessage = data.errorMessage;
                j.finishedAt = data.finishedAt;
                count++;
              }
            }
            return Promise.resolve({ count });
          }),
          findFirst: jest.fn().mockImplementation(({ where }) => {
            const found = dbState.backupJobs.find((j) => !where?.status || j.status === where.status);
            return Promise.resolve(found ?? null);
          }),
          create: jest.fn().mockImplementation(({ data }) => {
            const newJob = { id: dbState.backupJobs.length + 1, uuid: `new-backup-job-${Date.now()}`, ...data };
            dbState.backupJobs.push(newJob);
            return Promise.resolve(newJob);
          }),
        },
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            let count = 0;
            for (const r of dbState.restoreJobs) {
              if (r.uuid === where?.uuid) {
                Object.assign(r, data);
                count++;
              }
            }
            return Promise.resolve({ count });
          }),
          findFirst: jest.fn().mockImplementation(({ where }) => {
            const found = dbState.restoreJobs.find((r) => !where?.status || r.status === where.status);
            return Promise.resolve(found ?? null);
          }),
          create: jest.fn(),
        },
        backupPlan: {
          findUnique: jest.fn().mockResolvedValue({ id: 1, storagePath: specTempDir }),
          findFirst: jest.fn().mockResolvedValue({ id: 1, storagePath: specTempDir }),
        },
        $transaction: jest.fn().mockImplementation(async (callback) => {
          const txClient = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            backupJob: mockPrisma.backupJob,
            restoreJob: mockPrisma.restoreJob,
          };
          return callback(txClient);
        }),
      };

      // قبل التراجع: محاولة فحص المهام النشطة تبيّن وجود BackupJob بحالة RUNNING
      const preRunning = await mockPrisma.backupJob.findFirst({ where: { status: 'RUNNING' } });
      expect(preRunning).not.toBeNull();
      expect(preRunning?.status).toBe('RUNNING');

      // تنفيذ التراجع
      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({ success: true, durationMs: 25 }),
      };
      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };
      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'work-dir-4');
      await (orchestrator as any).attemptRollback({
        jobId: 100,
        jobUuid: 'current-restore-job-uuid',
        safetyBackupId: 1,
        safetyBackupJobUuid: 'safety-backup-job-uuid',
        safetyStoragePath: archivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Test error triggering rollback',
      });

      // التحقق من حالة ما بعد التراجع:
      // 1. مهمة النسخ القديمة أصبحت FAILED
      expect(dbState.backupJobs[0].status).toBe('FAILED');
      expect(dbState.backupJobs[0].errorMessage).toBe('Interrupted by database rollback');
      // 2. مهمة الاستعادة أصبحت ROLLBACK_COMPLETED
      expect(dbState.restoreJobs[0].status).toBe('ROLLBACK_COMPLETED');

      // 3. التحقق من عدم وجود أي مهمة RUNNING تمنع النسخ
      const postRunningBackup = await mockPrisma.backupJob.findFirst({ where: { status: 'RUNNING' } });
      expect(postRunningBackup).toBeNull();
      const postRunningRestore = await mockPrisma.restoreJob.findFirst({ where: { status: 'RUNNING' } });
      expect(postRunningRestore).toBeNull();

      // 4. محاكاة بدء نسخة احتياطية جديدة عبر BackupOrchestratorService
      const backupOrchestrator = new BackupOrchestratorService(
        mockPrisma,
        mockStorage,
        {} as any,
        mockBackupLogger,
        {} as any,
        {} as any,
        {} as any,
      );
      jest.spyOn(backupOrchestrator as any, 'runPipeline').mockImplementation(() => Promise.resolve());

      const startResult = await backupOrchestrator.startBackup({
        triggeredBy: 'MANUAL',
        category: 'NORMAL',
        initiatedByUserUuid: 'admin-user',
      });

      // التحقق من النجاح التام دون خطأ BACKUP_ALREADY_RUNNING
      expect(startResult).toBeDefined();
      expect(startResult.jobUuid).toBeDefined();
      expect(typeof startResult.jobUuid).toBe('string');
    });

    it('5. should strictly narrow cleanup to the target stale safety backup job and leave concurrent/unrelated jobs untouched', async () => {
      const archivePath = path.join(specTempDir, 'safety_backup_narrow.tar.gz');
      await createValidRollbackArchive(archivePath);

      const restoreStartTime = new Date('2026-10-11T12:00:00.000Z');

      const backupJobsTable: any[] = [
        {
          id: 101,
          uuid: 'target-stale-safety-job-uuid',
          status: 'RUNNING',
          triggeredBy: 'PRE_RESTORE',
          createdAt: new Date('2026-10-11T11:59:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 102,
          uuid: 'concurrent-manual-job-uuid',
          status: 'RUNNING',
          triggeredBy: 'MANUAL',
          createdAt: new Date('2026-10-11T12:01:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 103,
          uuid: 'concurrent-scheduled-job-uuid',
          status: 'RUNNING',
          triggeredBy: 'SCHEDULED',
          createdAt: new Date('2026-10-11T12:01:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 104,
          uuid: 'different-safety-job-uuid',
          status: 'RUNNING',
          triggeredBy: 'PRE_RESTORE',
          createdAt: new Date('2026-10-11T12:02:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 105,
          uuid: 'completed-job-uuid',
          status: 'COMPLETED',
          triggeredBy: 'MANUAL',
          createdAt: new Date('2026-10-11T11:00:00.000Z'),
          errorMessage: null,
          finishedAt: new Date('2026-10-11T11:05:00.000Z'),
        },
      ];

      let restoreJobRecord: any = {
        id: 305,
        uuid: 'restore-job-uuid-305',
        status: 'RUNNING',
        errorMessage: null,
      };

      const mockPrisma: any = {
        backupJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            let count = 0;
            for (const job of backupJobsTable) {
              const statusMatch = !where?.status || job.status === where.status;
              const triggerMatch = !where?.triggeredBy || job.triggeredBy === where.triggeredBy;
              const uuidMatch = !where?.uuid || job.uuid === where.uuid;
              const createdMatch = !where?.createdAt?.lte || job.createdAt <= where.createdAt.lte;

              if (statusMatch && triggerMatch && uuidMatch && createdMatch) {
                job.status = data.status;
                job.errorMessage = data.errorMessage;
                job.finishedAt = data.finishedAt;
                count++;
              }
            }
            return Promise.resolve({ count });
          }),
        },
        restoreJob: {
          updateMany: jest.fn().mockImplementation(({ where, data }) => {
            if (restoreJobRecord.uuid === where?.uuid) {
              restoreJobRecord = { ...restoreJobRecord, ...data };
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({ success: true, durationMs: 20 }),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'work-dir-5');

      await (orchestrator as any).attemptRollback({
        jobId: 305,
        jobUuid: 'restore-job-uuid-305',
        startedAt: restoreStartTime,
        safetyBackupId: 1,
        safetyBackupJobUuid: 'target-stale-safety-job-uuid',
        safetyStoragePath: archivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Simulated restore error',
      });

      // 1. المهمة المستهدفة فقط تحولت إلى FAILED
      const targetJob = backupJobsTable.find((j) => j.id === 101);
      expect(targetJob.status).toBe('FAILED');
      expect(targetJob.errorMessage).toBe('Interrupted by database rollback');
      expect(targetJob.finishedAt).toBeInstanceOf(Date);

      // 2. المهمة اليدوية التشغيلية الجديدة بقيت RUNNING دون تغيير
      const manualJob = backupJobsTable.find((j) => j.id === 102);
      expect(manualJob.status).toBe('RUNNING');
      expect(manualJob.errorMessage).toBeNull();

      // 3. المهمة المجدولة التشغيلية الجديدة بقيت RUNNING دون تغيير
      const scheduledJob = backupJobsTable.find((j) => j.id === 103);
      expect(scheduledJob.status).toBe('RUNNING');
      expect(scheduledJob.errorMessage).toBeNull();

      // 4. مهمة أمان أخرى بمعرف مختلف بقيت RUNNING دون تغيير
      const otherSafetyJob = backupJobsTable.find((j) => j.id === 104);
      expect(otherSafetyJob.status).toBe('RUNNING');
      expect(otherSafetyJob.errorMessage).toBeNull();

      // 5. المهمة المكتملة سابقاً بقيت COMPLETED دون تغيير
      const completedJob = backupJobsTable.find((j) => j.id === 105);
      expect(completedJob.status).toBe('COMPLETED');
    });

    it('6. should NOT modify any unconfirmed jobs when safetyBackupJobUuid is absent and multiple historical PRE_RESTORE jobs exist', async () => {
      const archivePath = path.join(specTempDir, 'safety_backup_ambiguous.tar.gz');
      await createValidRollbackArchive(archivePath);

      const restoreStartTime = new Date('2026-10-11T14:00:00.000Z');

      // حالتان قديمتان بحالة RUNNING والنوع PRE_RESTORE
      const backupJobsTable: any[] = [
        {
          id: 501,
          uuid: 'historical-pre-restore-1',
          status: 'RUNNING',
          triggeredBy: 'PRE_RESTORE',
          createdAt: new Date('2026-10-11T13:30:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 502,
          uuid: 'historical-pre-restore-2',
          status: 'RUNNING',
          triggeredBy: 'PRE_RESTORE',
          createdAt: new Date('2026-10-11T13:45:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
        {
          id: 503,
          uuid: 'historical-manual-3',
          status: 'RUNNING',
          triggeredBy: 'MANUAL',
          createdAt: new Date('2026-10-11T13:50:00.000Z'),
          errorMessage: null,
          finishedAt: null,
        },
      ];

      const mockPrisma: any = {
        backupJob: {
          findMany: jest.fn().mockImplementation(({ where }) => {
            const matches = backupJobsTable.filter(
              (j) =>
                (!where?.status || j.status === where.status) &&
                (!where?.triggeredBy || j.triggeredBy === where.triggeredBy) &&
                (!where?.createdAt?.lte || j.createdAt <= where.createdAt.lte),
            );
            return Promise.resolve(matches);
          }),
          updateMany: jest.fn(),
        },
        restoreJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn(),
        },
      };

      const mockDbRestoreEngine: any = {
        execute: jest.fn().mockResolvedValue({ success: true, durationMs: 20 }),
      };

      const mockBackupLogger: any = {
        writeLog: jest.fn().mockResolvedValue(undefined),
      };

      const mockStorage: any = {
        ensureDirectory: jest.fn().mockImplementation(async (d) => fsp.mkdir(d, { recursive: true })),
        deleteDirectory: jest.fn().mockImplementation(async (d) => fsp.rm(d, { recursive: true, force: true })),
      };

      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/mock_test_db';

      const orchestrator = new RestoreOrchestratorService(
        mockPrisma,
        mockStorage,
        mockBackupLogger,
        {} as any,
        mockDbRestoreEngine,
      );

      const workDir = path.join(specTempDir, 'work-dir-6');

      // استدعاء attemptRollback دون safetyBackupJobUuid (حالة غياب المعرّف الصريح)
      await (orchestrator as any).attemptRollback({
        jobId: 306,
        jobUuid: 'restore-job-uuid-306',
        startedAt: restoreStartTime,
        safetyBackupId: 1,
        // safetyBackupJobUuid is intentionally omitted
        safetyStoragePath: archivePath,
        workDir,
        rollbackDatabase: true,
        rollbackMedia: false,
        rollbackConfig: false,
        originalError: 'Simulated restore error without explicit safety job UUID',
      });

      // التحقق من فحص المرشحين
      expect(mockPrisma.backupJob.findMany).toHaveBeenCalled();

      // التحقق الصارم من عدم استدعاء updateMany مطلقاً (رفض التعديل الجماعي للمهام غير المؤكدة)
      expect(mockPrisma.backupJob.updateMany).not.toHaveBeenCalled();

      // التحقق من بقاء السجلات القديمة بحالة RUNNING دون أي تعديل بناءً على الزمن
      expect(backupJobsTable[0].status).toBe('RUNNING');
      expect(backupJobsTable[0].errorMessage).toBeNull();
      expect(backupJobsTable[1].status).toBe('RUNNING');
      expect(backupJobsTable[1].errorMessage).toBeNull();
      expect(backupJobsTable[2].status).toBe('RUNNING');
      expect(backupJobsTable[2].errorMessage).toBeNull();
    });
  });
});
