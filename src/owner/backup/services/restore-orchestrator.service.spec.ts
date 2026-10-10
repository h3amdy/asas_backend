import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { RestoreOrchestratorService } from './restore-orchestrator.service';
import { DbRestoreEngine } from '../engines/db-restore.engine';
import { BackupManifest } from '../types/manifest.type';

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
});
