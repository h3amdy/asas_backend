import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PgDumpEngine } from './engines/pg-dump.engine';
import { MediaBackupEngine } from './engines/media-backup.engine';
import { ConfigBackupEngine } from './engines/config-backup.engine';
import { DbRestoreEngine } from './engines/db-restore.engine';
import { restoreConfigFiles } from './utils/safe-copy';
import { BackupManifest } from './types/manifest.type';
import { RestoreOrchestratorService } from './services/restore-orchestrator.service';

const execFileAsync = promisify(execFile);

describe('BKP-001 End-to-End Staging Lifecycle Gate', () => {
  let e2eSandbox: string;
  const dbUrlSource = 'postgresql://localhost:5432/asas_staging_e2e_test';
  const dbUrlTarget = 'postgresql://localhost:5432/asas_staging_e2e_restored_db';

  beforeAll(async () => {
    // التأكد من وجود قواعد بيانات الاختبار المعزولة
    try {
      await execFileAsync('createdb', ['asas_staging_e2e_test']);
    } catch {}
    try {
      await execFileAsync('createdb', ['asas_staging_e2e_restored_db']);
    } catch {}

    // تجهيز قاعدة البيانات المصدرية
    await execFileAsync('psql', [
      dbUrlSource,
      '-c',
      `
      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_assets (
        id SERIAL PRIMARY KEY,
        uuid UUID DEFAULT gen_random_uuid(),
        storage_key VARCHAR(255) NOT NULL,
        content_type VARCHAR(100) NOT NULL,
        variants_json TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO platform_settings (key, value) VALUES ('school_name', 'Madrasat Al-Najah Staging')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      DELETE FROM media_assets;
      INSERT INTO media_assets (storage_key, content_type) VALUES
        ('schools/logo1.png', 'image/png'),
        ('lessons/audio1.mp3', 'audio/mpeg');
      `,
    ]);
  });

  beforeEach(async () => {
    e2eSandbox = await fsp.mkdtemp(path.join(os.tmpdir(), 'e2e-staging-lifecycle-'));
  });

  afterEach(async () => {
    if (e2eSandbox) {
      await fsp.rm(e2eSandbox, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    // تنظيف قواعد بيانات الاختبار المعزولة
    try {
      await execFileAsync('dropdb', ['--if-exists', 'asas_staging_e2e_test']);
      await execFileAsync('dropdb', ['--if-exists', 'asas_staging_e2e_restored_db']);
    } catch {
      // تجاهل إذا كانت مستخدمة
    }
  });

  it('1. should execute a real Full Backup pipeline and produce a verified tar.gz archive with sidecar sha256 and manifest', async () => {
    const workDir = path.join(e2eSandbox, 'work');
    const storageDir = path.join(e2eSandbox, 'storage');
    const mockProjectDir = path.join(e2eSandbox, 'mock_project');
    const mediaStorageDir = path.join(e2eSandbox, 'media_base');

    await fsp.mkdir(workDir, { recursive: true });
    await fsp.mkdir(storageDir, { recursive: true });
    await fsp.mkdir(mockProjectDir, { recursive: true });
    await fsp.mkdir(path.join(mediaStorageDir, 'schools'), { recursive: true });
    await fsp.mkdir(path.join(mediaStorageDir, 'lessons'), { recursive: true });

    // 1. إنشاء ملفات وسائط حقيقية على القرص تطابق مفاتيح قاعدة البيانات
    const pngDummy = Buffer.from('FAKE_PNG_BINARY_CONTENT_FOR_STAGING_TEST');
    const mp3Dummy = Buffer.from('FAKE_MP3_AUDIO_CONTENT_FOR_STAGING_TEST');
    await fsp.writeFile(path.join(mediaStorageDir, 'schools', 'logo1.png'), pngDummy);
    await fsp.writeFile(path.join(mediaStorageDir, 'lessons', 'audio1.mp3'), mp3Dummy);

    // 2. إنشاء ملفات إعداد حقيقية في جذر المشروع الوهمي
    const envContent = 'DATABASE_URL=postgresql://staging_user:secret@localhost:5432/asas\nAPP_KEY=staging_key_2026';
    const pm2Content = 'module.exports = { apps: [{ name: "asas-staging" }] };';
    await fsp.writeFile(path.join(mockProjectDir, '.env'), envContent);
    await fsp.writeFile(path.join(mockProjectDir, 'pm2.config.js'), pm2Content);

    // ── أ. تنفيذ pg_dump الحقيقي ──
    const pgEngine = new PgDumpEngine();
    const dbResult = await pgEngine.execute(workDir, dbUrlSource);
    expect(dbResult.success).toBe(true);
    expect(dbResult.details.mediaStorageKeys).toEqual(expect.arrayContaining(['schools/logo1.png', 'lessons/audio1.mp3']));

    const gzFile = path.join(workDir, 'database', 'postgres.sql.gz');
    expect(fs.existsSync(gzFile)).toBe(true);
    expect(dbResult.details.sha256).toBeDefined();

    // ── ب. تنفيذ محرك الوسائط الحقيقي ──
    const mediaEngine = new MediaBackupEngine();
    const mediaResult = await mediaEngine.execute(workDir, mediaStorageDir, dbResult.details.mediaStorageKeys);
    expect(mediaResult.success).toBe(true);
    expect(mediaResult.details.filesExpected).toBe(2);
    expect(mediaResult.details.filesCopied).toBe(2);
    expect(mediaResult.details.missingStorageKeys).toHaveLength(0);

    // ── ج. تنفيذ محرك التكوين الحقيقي ──
    const configEngine = new ConfigBackupEngine();
    const configResult = await configEngine.execute(workDir, mockProjectDir);
    expect(configResult.success).toBe(true);
    expect(configResult.details.files).toEqual(expect.arrayContaining(['.env', 'pm2.config.js']));

    // ── د. بناء manifest.json وحساب الـ Checksums ──
    const checksums: Record<string, string> = {};
    const computeSha256 = async (filePath: string) => {
      const data = await fsp.readFile(filePath);
      return crypto.createHash('sha256').update(data).digest('hex');
    };
    checksums['database/postgres.sql.gz'] = dbResult.details.sha256;
    checksums['media/schools/logo1.png'] = await computeSha256(path.join(workDir, 'media', 'schools', 'logo1.png'));
    checksums['media/lessons/audio1.mp3'] = await computeSha256(path.join(workDir, 'media', 'lessons', 'audio1.mp3'));
    checksums['config/.env'] = await computeSha256(path.join(workDir, 'config', '.env'));
    checksums['config/pm2.config.js'] = await computeSha256(path.join(workDir, 'config', 'pm2.config.js'));

    const manifest: BackupManifest = {
      backupId: 'e2e-job-uuid-1',
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0-staging',
      databaseSchemaVersion: '20261010_test',
      backupType: 'FULL',
      triggerType: 'MANUAL',
      category: 'NORMAL',
      components: {
        database: {
          included: true,
          engine: 'pg_dump',
          format: 'sql.gz',
          file: 'database/postgres.sql.gz',
          sizeBytes: Number(dbResult.sizeBytes),
          sha256: dbResult.details.sha256,
        },
        media: {
          included: true,
          directory: 'media/',
          filesExpected: 2,
          filesCopied: 2,
          sizeBytes: Number(mediaResult.sizeBytes),
        },
        config: {
          included: true,
          directory: 'config/',
          files: configResult.details.files,
          sizeBytes: Number(configResult.sizeBytes),
        },
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: 'SUCCESS',
        missingStorageKeys: [],
      },
      checksums,
    };

    const manifestPath = path.join(workDir, 'manifest.json');
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // ── هـ. ضغط الأرشيف tar.gz ──
    const archivePath = path.join(storageDir, 'backup_staging_e2e.tar.gz');
    await execFileAsync('tar', ['-czf', archivePath, '-C', workDir, '.']);
    expect(fs.existsSync(archivePath)).toBe(true);

    // ── و. توليد SHA-256 الخارجي كـ sidecar ──
    const archiveSha256 = await computeSha256(archivePath);
    const checksumSidecarPath = `${archivePath}.sha256`;
    await fsp.writeFile(checksumSidecarPath, `${archiveSha256}  backup_staging_e2e.tar.gz\n`, 'utf-8');
    expect(fs.existsSync(checksumSidecarPath)).toBe(true);

    // 2. التحقق من الأرشيف ومحتويات manifest و تطابق Checksum
    const { stdout: tarList } = await execFileAsync('tar', ['-tzf', archivePath]);
    expect(tarList).toContain('database/postgres.sql.gz');
    expect(tarList).toContain('media/schools/logo1.png');
    expect(tarList).toContain('media/lessons/audio1.mp3');
    expect(tarList).toContain('config/.env');
    expect(tarList).toContain('config/pm2.config.js');
    expect(tarList).toContain('manifest.json');

    const sidecarContent = await fsp.readFile(checksumSidecarPath, 'utf-8');
    expect(sidecarContent.trim()).toBe(`${archiveSha256}  backup_staging_e2e.tar.gz`);
  });

  it('2. should extract archive and execute full E2E Restore for DB, Media, and Config with exact data verification', async () => {
    // ننشئ نسخة أرشيف مصغرة متكاملة ونستعيدها
    const workDir = path.join(e2eSandbox, 'work_restore');
    const extractDir = path.join(e2eSandbox, 'extracted');
    const restoreMediaDir = path.join(e2eSandbox, 'restored_media');
    const restoreProjectDir = path.join(e2eSandbox, 'restored_project');

    await fsp.mkdir(workDir, { recursive: true });
    await fsp.mkdir(extractDir, { recursive: true });
    await fsp.mkdir(restoreMediaDir, { recursive: true });
    await fsp.mkdir(restoreProjectDir, { recursive: true });

    // أخذ dump من asas_staging_e2e_test
    const pgEngine = new PgDumpEngine();
    await pgEngine.execute(workDir, dbUrlSource);

    // وضع ملفات وسائط وتكوين
    await fsp.mkdir(path.join(workDir, 'media', 'schools'), { recursive: true });
    await fsp.writeFile(path.join(workDir, 'media', 'schools', 'restored_logo.png'), 'RESTORED_LOGO_BINARY');

    await fsp.mkdir(path.join(workDir, 'config'), { recursive: true });
    const secretEnv = 'RESTORED_ENV_KEY=super_secret_restored_2026';
    await fsp.writeFile(path.join(workDir, 'config', '.env'), secretEnv);
    const nginxConf = 'server { listen 443 ssl; server_name restored.asas.local; }';
    await fsp.writeFile(path.join(workDir, 'config', 'nginx.conf'), nginxConf);

    // إنشاء الأرشيف
    const archivePath = path.join(e2eSandbox, 'archive_to_restore.tar.gz');
    await execFileAsync('tar', ['-czf', archivePath, '-C', workDir, '.']);

    // فك الأرشيف في extractDir
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir]);

    // ── أ. استعادة قاعدة البيانات عبر DbRestoreEngine الفعلي في dbUrlTarget ──
    const dbRestoreEngine = new DbRestoreEngine();
    const sqlGzPath = path.join(extractDir, 'database', 'postgres.sql.gz');
    const dbRestoreResult = await dbRestoreEngine.execute(sqlGzPath, dbUrlTarget);
    expect(dbRestoreResult.success).toBe(true);

    // التحقق الفعلي من محتوى قاعدة البيانات المستعادة عبر استعلام psql
    const { stdout: settingValue } = await execFileAsync('psql', [
      dbUrlTarget,
      '-t',
      '-c',
      "SELECT value FROM platform_settings WHERE key = 'school_name';",
    ]);
    expect(settingValue.trim()).toBe('Madrasat Al-Najah Staging');

    const { stdout: mediaCount } = await execFileAsync('psql', [
      dbUrlTarget,
      '-t',
      '-c',
      'SELECT count(*) FROM media_assets;',
    ]);
    expect(parseInt(mediaCount.trim(), 10)).toBe(2);

    // ── ب. استعادة ملفات الوسائط والتحقق من محتواها ──
    const srcMediaFile = path.join(extractDir, 'media', 'schools', 'restored_logo.png');
    const destMediaFile = path.join(restoreMediaDir, 'schools', 'restored_logo.png');
    await fsp.mkdir(path.dirname(destMediaFile), { recursive: true });
    await fsp.copyFile(srcMediaFile, destMediaFile);

    expect(await fsp.readFile(destMediaFile, 'utf-8')).toBe('RESTORED_LOGO_BINARY');

    // ── ج. استعادة الإعدادات عبر restoreConfigFiles والتحقق من الصلاحيات وNginx ──
    const configResult = await restoreConfigFiles(
      path.join(extractDir, 'config'),
      restoreProjectDir,
      ['.env', 'nginx.conf'],
    );

    // 1. .env استُعيد بصلاحيات 0600
    expect(configResult.files.find((f) => f.fileName === '.env')?.status).toBe('restored');
    const restoredEnvPath = path.join(restoreProjectDir, '.env');
    expect(await fsp.readFile(restoredEnvPath, 'utf-8')).toBe(secretEnv);
    const envStat = await fsp.stat(restoredEnvPath);
    expect(envStat.mode & 0o777).toBe(0o600);

    // 2. nginx.conf وُجّه لمجلد المراجعة ولم يلمس مسار الإنتاج
    expect(configResult.files.find((f) => f.fileName === 'nginx.conf')?.status).toBe('review');
    const reviewNginx = path.join(restoreProjectDir, 'restore-review', 'nginx.conf.restored');
    expect(fs.existsSync(reviewNginx)).toBe(true);
    expect(await fsp.readFile(reviewNginx, 'utf-8')).toBe(nginxConf);
    expect(fs.existsSync('/etc/nginx/sites-available/asas.restored_test')).toBe(false);
  });

  it('3. should rollback safely from safety backup when database restore fails with data corruption', async () => {
    // 1. حالة قاعدة البيانات الحالية المضمونة (Safety State)
    await execFileAsync('psql', [
      dbUrlSource,
      '-c',
      "UPDATE platform_settings SET value = 'PRE_RESTORE_SAFE_STATE' WHERE key = 'school_name';",
    ]);

    // 2. أخذ Safety Backup فعلي للـ DB
    const safetyWorkDir = path.join(e2eSandbox, 'safety_work');
    await fsp.mkdir(safetyWorkDir, { recursive: true });
    const pgEngine = new PgDumpEngine();
    await pgEngine.execute(safetyWorkDir, dbUrlSource);
    const safetyGz = path.join(safetyWorkDir, 'database', 'postgres.sql.gz');
    expect(fs.existsSync(safetyGz)).toBe(true);

    // 3. محاكاة dump تالف للاستعادة الفاشلة (Corrupted Dump at archive level)
    const corruptDir = path.join(e2eSandbox, 'corrupt_work');
    await fsp.mkdir(corruptDir, { recursive: true });
    const corruptGz = path.join(corruptDir, 'postgres.sql.gz');
    // ملف تالف غير صالح كـ gzip يمثل تلف أثناء النقل أو انقطاع القرص
    await fsp.writeFile(corruptGz, Buffer.from('CORRUPTED_HEADER_NOT_A_VALID_GZIP_ARCHIVE_DATA'));

    // 4. محاولة استعادة الـ dump التالف عبر DbRestoreEngine
    const dbRestoreEngine = new DbRestoreEngine();
    const restoreResult = await dbRestoreEngine.execute(corruptGz, dbUrlSource);
    expect(restoreResult.success).toBe(false); // فشل متوقع

    // 5. تفعيل الـ Rollback التلقائي باستعادة الـ Safety Backup
    const rollbackResult = await dbRestoreEngine.execute(safetyGz, dbUrlSource);
    expect(rollbackResult.success).toBe(true);

    // 6. التحقق من بقاء وسلامة البيانات الأصلية 100% دون أي فقدان
    const { stdout: recoveredValue } = await execFileAsync('psql', [
      dbUrlSource,
      '-t',
      '-c',
      "SELECT value FROM platform_settings WHERE key = 'school_name';",
    ]);
    expect(recoveredValue.trim()).toBe('PRE_RESTORE_SAFE_STATE');
  });

  it('4. should abort psql on internal SQL error (-v ON_ERROR_STOP=1), prevent following statements, and rollback full DB state', async () => {
    // 1. تثبيت حالة أساسية واضحة وشاملة في قاعدة البيانات (Baseline State)
    await execFileAsync('psql', [
      dbUrlSource,
      '-c',
      `
      DELETE FROM platform_settings;
      INSERT INTO platform_settings (key, value) VALUES
        ('school_name', 'PRE_CRASH_SCHOOL'),
        ('system_version', 'v2.5.0-baseline');

      DELETE FROM media_assets;
      INSERT INTO media_assets (storage_key, content_type) VALUES
        ('baseline/asset1.png', 'image/png'),
        ('baseline/asset2.mp3', 'audio/mpeg');
      `,
    ]);

    // التحقق من الحالة الأساسية قبل بدء أي عملية استعادة
    const { stdout: baselineSettingsCount } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', 'SELECT count(*) FROM platform_settings;',
    ]);
    expect(parseInt(baselineSettingsCount.trim(), 10)).toBe(2);

    const { stdout: baselineMediaCount } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', 'SELECT count(*) FROM media_assets;',
    ]);
    expect(parseInt(baselineMediaCount.trim(), 10)).toBe(2);

    // 2. أخذ Safety Backup كامل للحالة الأساسية
    const safetyWorkDir = path.join(e2eSandbox, 'safety_work_sql_test');
    await fsp.mkdir(safetyWorkDir, { recursive: true });
    const pgEngine = new PgDumpEngine();
    await pgEngine.execute(safetyWorkDir, dbUrlSource);
    const safetyGz = path.join(safetyWorkDir, 'database', 'postgres.sql.gz');
    expect(fs.existsSync(safetyGz)).toBe(true);

    // 3. بناء أرشيف نسخة احتياطية مسمومة تحتوي على:
    // - أمر أ (صالح): ينفذ تعديلاً جزئياً
    // - أمر ب (خطأ SQL قاتل): يصطدم بخطأ نحوي متعمد
    // - أمر ج (صالح): لا ينبغي تنفيذه إطلاقاً بسبب توقف psql عند الخطأ السابق
    const brokenWorkDir = path.join(e2eSandbox, 'broken_archive_work');
    await fsp.mkdir(path.join(brokenWorkDir, 'database'), { recursive: true });
    const brokenSqlPath = path.join(brokenWorkDir, 'database', 'postgres.sql');

    const poisonedSql = `
-- أمر 1: صالح جزئياً
INSERT INTO platform_settings (key, value) VALUES ('partial_leak_key', 'LEAKED_VALUE_BEFORE_ERROR');

-- أمر 2: خطأ SQL قاتل ومتعمد
THIS IS A SYNTAX ERROR THAT MUST HALT PSQL EXECUTION IMMEDIATELY;;;

-- أمر 3: صالح، لا ينبغي أن يُنفذ قط
INSERT INTO platform_settings (key, value) VALUES ('never_executed_key', 'SHOULD_NOT_EXIST');
`;
    await fsp.writeFile(brokenSqlPath, poisonedSql, 'utf-8');
    await execFileAsync('gzip', ['-9', brokenSqlPath]);
    const brokenSqlGzPath = path.join(brokenWorkDir, 'database', 'postgres.sql.gz');
    const brokenGzData = await fsp.readFile(brokenSqlGzPath);
    const brokenDbSha256 = crypto.createHash('sha256').update(brokenGzData).digest('hex');

    const brokenManifest: BackupManifest = {
      backupId: 'broken-backup-uuid-4',
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0-staging',
      databaseSchemaVersion: '20261010_test',
      backupType: 'FULL',
      triggerType: 'MANUAL',
      category: 'NORMAL',
      components: {
        database: {
          included: true,
          engine: 'pg_dump',
          format: 'sql.gz',
          file: 'database/postgres.sql.gz',
          sizeBytes: brokenGzData.length,
          sha256: brokenDbSha256,
        },
        media: null,
        config: null,
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: 'SUCCESS',
        missingStorageKeys: [],
      },
      checksums: {
        'database/postgres.sql.gz': brokenDbSha256,
      },
    };
    await fsp.writeFile(path.join(brokenWorkDir, 'manifest.json'), JSON.stringify(brokenManifest, null, 2), 'utf-8');

    const brokenArchivePath = path.join(e2eSandbox, 'broken_backup.tar.gz');
    await execFileAsync('tar', ['-czf', brokenArchivePath, '-C', brokenWorkDir, '.']);
    const brokenArchiveData = await fsp.readFile(brokenArchivePath);
    const brokenArchiveSha256 = crypto.createHash('sha256').update(brokenArchiveData).digest('hex');
    await fsp.writeFile(`${brokenArchivePath}.sha256`, `${brokenArchiveSha256}  broken_backup.tar.gz\n`, 'utf-8');

    // تجهيز أرشيف الـ Safety Backup متكاملاً مع manifest.json
    const safetyArchiveWorkDir = path.join(e2eSandbox, 'safety_archive_work');
    await fsp.mkdir(path.join(safetyArchiveWorkDir, 'database'), { recursive: true });
    await fsp.copyFile(safetyGz, path.join(safetyArchiveWorkDir, 'database', 'postgres.sql.gz'));
    const safetyGzData = await fsp.readFile(safetyGz);
    const safetyDbSha256 = crypto.createHash('sha256').update(safetyGzData).digest('hex');

    const safetyManifest: BackupManifest = {
      backupId: 'safety-backup-uuid-4',
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0-staging',
      databaseSchemaVersion: '20261010_test',
      backupType: 'FULL',
      triggerType: 'MANUAL',
      category: 'SYSTEM_SAFETY',
      components: {
        database: {
          included: true,
          engine: 'pg_dump',
          format: 'sql.gz',
          file: 'database/postgres.sql.gz',
          sizeBytes: safetyGzData.length,
          sha256: safetyDbSha256,
        },
        media: null,
        config: null,
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: 'SUCCESS',
        missingStorageKeys: [],
      },
      checksums: {
        'database/postgres.sql.gz': safetyDbSha256,
      },
    };
    await fsp.writeFile(path.join(safetyArchiveWorkDir, 'manifest.json'), JSON.stringify(safetyManifest, null, 2), 'utf-8');

    const safetyArchivePath = path.join(e2eSandbox, 'safety_backup.tar.gz');
    await execFileAsync('tar', ['-czf', safetyArchivePath, '-C', safetyArchiveWorkDir, '.']);
    const safetyArchiveData = await fsp.readFile(safetyArchivePath);
    const safetyArchiveSha256 = crypto.createHash('sha256').update(safetyArchiveData).digest('hex');
    await fsp.writeFile(`${safetyArchivePath}.sha256`, `${safetyArchiveSha256}  safety_backup.tar.gz\n`, 'utf-8');

    // 4. إعداد منسق الاستعادة RestoreOrchestratorService مع محرك الاستعادة الفعلي DbRestoreEngine
    let restoreJobRecord: any = {
      id: 204,
      uuid: 'restore-e2e-job-uuid-204',
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
              uuid: 'broken-backup-uuid-4',
              storagePath: brokenArchivePath,
              sha256: brokenArchiveSha256,
            });
          }
          if (where.id === 999) {
            return Promise.resolve({
              id: 999,
              uuid: 'safety-backup-uuid-4',
              storagePath: safetyArchivePath,
              sha256: safetyArchiveSha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 70,
          uuid: 'safety-job-uuid-e2e',
          status: 'COMPLETED',
          backupInstanceId: 999,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-uuid-e2e' }),
    };

    // استخدام محرك الاستعادة الفعلي مع -v ON_ERROR_STOP=1
    const realDbRestoreEngine = new DbRestoreEngine();
    process.env.DATABASE_URL = dbUrlSource;

    const restoreOrchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      realDbRestoreEngine,
    );

    // 5. تنفيذ الاستعادة عبر المنسق (RestoreOrchestratorService)
    // نلاحظ: الاختبار لا يستدعي Rollback يدوياً، بل يترك المنسق ليكتشف الخطأ وينفذ التراجع تلقائياً
    await (restoreOrchestrator as any).runPipeline(204, {
      backupInstanceId: 1,
      restoreDatabase: true,
      restoreMedia: false,
      restoreConfiguration: false,
    });

    // 6. التحقق من مسار المنسق وسجل العمليات
    // أ. المنسق رصد الخطأ النحوي وأبلغ عنه
    const errorLog = logsWritten.find((l) => l.phase === 'RESTORE_DB' && l.level === 'ERROR');
    expect(errorLog).toBeDefined();
    expect(errorLog.message).toContain('syntax error');

    // ب. المنسق قام بالتراجع التلقائي وسجل النجاح
    const rollbackLog = logsWritten.find((l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'WARN');
    expect(rollbackLog).toBeDefined();
    expect(rollbackLog.message).toBe('Rollback from safety backup succeeded');

    // ج. حالة المهمة في Prisma أصبحت ROLLBACK_COMPLETED وليست COMPLETED ولا FAILED
    expect(restoreJobRecord.status).toBe('ROLLBACK_COMPLETED');
    expect(restoreJobRecord.errorMessage).toContain('syntax error');
    expect(restoreJobRecord.errorMessage).toContain('rolled back to safety backup');

    // 6. التحقق الشامل والدقيق من تطابق بيانات قاعدة الاختبار مع الحالة السابقة كاملة:
    // أ. جدول platform_settings:
    const { stdout: finalSettingsCount } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', 'SELECT count(*) FROM platform_settings;',
    ]);
    expect(parseInt(finalSettingsCount.trim(), 10)).toBe(2);

    const { stdout: schoolNameVal } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', "SELECT value FROM platform_settings WHERE key = 'school_name';",
    ]);
    expect(schoolNameVal.trim()).toBe('PRE_CRASH_SCHOOL');

    const { stdout: sysVersionVal } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', "SELECT value FROM platform_settings WHERE key = 'system_version';",
    ]);
    expect(sysVersionVal.trim()).toBe('v2.5.0-baseline');

    // ب. تنظيف التسريب الجزئي: التأكد من زوال partial_leak_key تماماً
    const { stdout: leakedCleared } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', "SELECT count(*) FROM platform_settings WHERE key = 'partial_leak_key';",
    ]);
    expect(parseInt(leakedCleared.trim(), 10)).toBe(0);

    // ج. جدول media_assets:
    const { stdout: finalMediaCount } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', 'SELECT count(*) FROM media_assets;',
    ]);
    expect(parseInt(finalMediaCount.trim(), 10)).toBe(2);

    const { stdout: mediaKeys } = await execFileAsync('psql', [
      dbUrlSource, '-t', '-c', 'SELECT storage_key FROM media_assets ORDER BY storage_key ASC;',
    ]);
    const keys = mediaKeys.trim().split(/\s+/);
    expect(keys).toEqual(['baseline/asset1.png', 'baseline/asset2.mp3']);
  });

  it('5. should execute safety rollback of BOTH database and media when required config (.env) fails after DB & Media restore, setting ROLLBACK_COMPLETED', async () => {
    // 1. تجهيز الحالة الأساسية في قاعدة بيانات Staging المعزولة
    await execFileAsync('psql', [
      dbUrlSource,
      '-c',
      `
      TRUNCATE platform_settings;
      INSERT INTO platform_settings (key, value) VALUES ('env_rollback_test', 'PRE_RESTORE_BASELINE_DB_VAL');
      TRUNCATE media_assets;
      INSERT INTO media_assets (storage_key, content_type) VALUES ('schools/env_test_logo.png', 'image/png');
      `,
    ]);

    // تجهيز مجلد الوسائط الفعلي الأساسي
    const mediaBaseDir = path.join(e2eSandbox, 'real_media_storage');
    await fsp.mkdir(path.join(mediaBaseDir, 'schools'), { recursive: true });
    const baselineMediaFile = path.join(mediaBaseDir, 'schools', 'env_test_logo.png');
    await fsp.writeFile(baselineMediaFile, 'ORIGINAL_BASELINE_MEDIA_BYTES', 'utf-8');

    // 2. إنشاء أرشيف الأمان الحقيقي (Safety Backup) يحتوي الحالة الأساسية للـ DB والـ Media
    const safetyWorkDir = path.join(e2eSandbox, 'safety_work_5');
    await fsp.mkdir(path.join(safetyWorkDir, 'database'), { recursive: true });
    await fsp.mkdir(path.join(safetyWorkDir, 'media', 'schools'), { recursive: true });

    const pgEngine = new PgDumpEngine();
    const safetyDumpRes = await pgEngine.execute(safetyWorkDir, dbUrlSource);
    expect(safetyDumpRes.success).toBe(true);
    const safetyGz = path.join(safetyWorkDir, 'database', 'postgres.sql.gz');
    const safetyGzData = await fsp.readFile(safetyGz);
    const safetyDbSha256 = crypto.createHash('sha256').update(safetyGzData).digest('hex');

    await fsp.writeFile(
      path.join(safetyWorkDir, 'media', 'schools', 'env_test_logo.png'),
      'ORIGINAL_BASELINE_MEDIA_BYTES',
      'utf-8',
    );

    const safetyManifest: BackupManifest = {
      backupId: 'safety-backup-uuid-5',
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0-staging',
      databaseSchemaVersion: '20261010_test',
      backupType: 'FULL',
      triggerType: 'MANUAL',
      category: 'SYSTEM_SAFETY',
      components: {
        database: {
          included: true,
          engine: 'pg_dump',
          format: 'sql.gz',
          file: 'database/postgres.sql.gz',
          sizeBytes: safetyGzData.length,
          sha256: safetyDbSha256,
        },
        media: {
          included: true,
          directory: 'media/',
          filesExpected: 1,
          filesCopied: 1,
          sizeBytes: 30,
        },
        config: null,
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: 'SUCCESS',
        missingStorageKeys: [],
      },
      checksums: {
        'database/postgres.sql.gz': safetyDbSha256,
      },
    };
    await fsp.writeFile(path.join(safetyWorkDir, 'manifest.json'), JSON.stringify(safetyManifest, null, 2), 'utf-8');

    const safetyArchivePath = path.join(e2eSandbox, 'safety_backup_5.tar.gz');
    await execFileAsync('tar', ['-czf', safetyArchivePath, '-C', safetyWorkDir, '.']);
    const safetyArchiveData = await fsp.readFile(safetyArchivePath);
    const safetyArchiveSha256 = crypto.createHash('sha256').update(safetyArchiveData).digest('hex');
    await fsp.writeFile(`${safetyArchivePath}.sha256`, `${safetyArchiveSha256}  safety_backup_5.tar.gz\n`, 'utf-8');

    // 3. إنشاء الأرشيف المستهدف للاستعادة (Target Restore Archive):
    // يحتوي DB معدلة + Media معدلة + ملف .env
    const targetWorkDir = path.join(e2eSandbox, 'target_work_5');
    await fsp.mkdir(path.join(targetWorkDir, 'database'), { recursive: true });
    await fsp.mkdir(path.join(targetWorkDir, 'media', 'schools'), { recursive: true });
    await fsp.mkdir(path.join(targetWorkDir, 'config'), { recursive: true });

    const mutatedSql = `
    DROP TABLE IF EXISTS platform_settings;
    CREATE TABLE platform_settings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO platform_settings (key, value) VALUES ('env_rollback_test', 'MUTATED_NEW_DB_VAL');
    `;
    const targetSqlPath = path.join(targetWorkDir, 'database', 'postgres.sql');
    await fsp.writeFile(targetSqlPath, mutatedSql, 'utf-8');
    await execFileAsync('gzip', ['-9', targetSqlPath]);
    const targetGz = path.join(targetWorkDir, 'database', 'postgres.sql.gz');
    const targetGzData = await fsp.readFile(targetGz);
    const targetDbSha256 = crypto.createHash('sha256').update(targetGzData).digest('hex');

    await fsp.writeFile(
      path.join(targetWorkDir, 'media', 'schools', 'env_test_logo.png'),
      'MUTATED_NEW_MEDIA_BYTES',
      'utf-8',
    );

    await fsp.writeFile(
      path.join(targetWorkDir, 'config', '.env'),
      'APP_SECRET=new_secret_key_restored\n',
      'utf-8',
    );

    const targetManifest: BackupManifest = {
      backupId: 'target-restore-uuid-5',
      backupFormatVersion: '1.0',
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0-staging',
      databaseSchemaVersion: '20261010_test',
      backupType: 'FULL',
      triggerType: 'MANUAL',
      category: 'NORMAL',
      components: {
        database: {
          included: true,
          engine: 'pg_dump',
          format: 'sql.gz',
          file: 'database/postgres.sql.gz',
          sizeBytes: targetGzData.length,
          sha256: targetDbSha256,
        },
        media: {
          included: true,
          directory: 'media/',
          filesExpected: 1,
          filesCopied: 1,
          sizeBytes: 25,
        },
        config: {
          included: true,
          directory: 'config/',
          files: ['.env'],
          sizeBytes: 35,
        },
      },
      consistency: {
        databaseSnapshot: new Date().toISOString(),
        status: 'SUCCESS',
        missingStorageKeys: [],
      },
      checksums: {
        'database/postgres.sql.gz': targetDbSha256,
      },
    };
    await fsp.writeFile(path.join(targetWorkDir, 'manifest.json'), JSON.stringify(targetManifest, null, 2), 'utf-8');

    const targetArchivePath = path.join(e2eSandbox, 'target_backup_5.tar.gz');
    await execFileAsync('tar', ['-czf', targetArchivePath, '-C', targetWorkDir, '.']);
    const targetArchiveData = await fsp.readFile(targetArchivePath);
    const targetArchiveSha256 = crypto.createHash('sha256').update(targetArchiveData).digest('hex');
    await fsp.writeFile(`${targetArchivePath}.sha256`, `${targetArchiveSha256}  target_backup_5.tar.gz\n`, 'utf-8');

    // 4. إنشاء جذر مشروع وهمي مع إحداث إفشال حتمي لكتابة ملف .env
    const mockProjectRoot = path.join(e2eSandbox, 'mock_proj_fail_env');
    await fsp.mkdir(mockProjectRoot, { recursive: true });
    await fsp.writeFile(path.join(mockProjectRoot, 'package.json'), '{}', 'utf-8');
    await fsp.mkdir(path.join(mockProjectRoot, 'src'), { recursive: true });
    await fsp.mkdir(path.join(mockProjectRoot, '.env'), { recursive: true }); // مجلد يمنع كتابة ملف .env

    process.env.MEDIA_STORAGE_PATH = mediaBaseDir;
    process.env.PROJECT_ROOT = mockProjectRoot;
    process.env.DATABASE_URL = dbUrlSource;

    let restoreJobRecord: any = {
      id: 205,
      uuid: 'restore-e2e-job-uuid-205',
      status: 'PENDING',
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      safetyBackupId: null,
    };

    let backupInstanceUpdateCalls: any[] = [];
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
              uuid: 'target-restore-uuid-5',
              storagePath: targetArchivePath,
              sha256: targetArchiveSha256,
            });
          }
          if (where.id === 995) {
            return Promise.resolve({
              id: 995,
              uuid: 'safety-backup-uuid-5',
              storagePath: safetyArchivePath,
              sha256: safetyArchiveSha256,
              isPinned: true,
            });
          }
          return Promise.resolve(null);
        }),
        update: jest.fn().mockImplementation((args) => {
          backupInstanceUpdateCalls.push(args);
          return Promise.resolve({});
        }),
      },
      backupJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 75,
          uuid: 'safety-job-uuid-5',
          status: 'COMPLETED',
          backupInstanceId: 995,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      startBackup: jest.fn().mockResolvedValue({ jobUuid: 'safety-job-uuid-5' }),
    };

    const realDbRestoreEngine = new DbRestoreEngine();

    const restoreOrchestrator = new RestoreOrchestratorService(
      mockPrisma,
      mockStorage,
      mockBackupLogger,
      mockBackupOrchestrator,
      realDbRestoreEngine,
    );

    try {
      // 5. تشغيل خط الاستعادة (DB + Media + Config)
      await (restoreOrchestrator as any).runPipeline(205, {
        backupInstanceId: 5,
        restoreDatabase: true,
        restoreMedia: true,
        restoreConfiguration: true,
      });

      // 6. التحقق من مسار التراجع التلقائي والنتائج الفعلية:
      // أ. تم رصد فشل استعادة .env في السجلات
      const configFailLog = logsWritten.find((l) => l.phase === 'RESTORE_CONFIG' && l.level === 'ERROR');
      expect(configFailLog).toBeDefined();
      expect(configFailLog.message).toContain('Required config file failed to restore: .env');

      // ب. تم تنفيذ التراجع التلقائي بنجاح
      const rollbackLog = logsWritten.find((l) => l.phase === 'RESTORE_ROLLBACK' && l.level === 'WARN');
      expect(rollbackLog).toBeDefined();
      expect(rollbackLog.message).toBe('Rollback from safety backup succeeded');

      // ج. حالة المهمة ROLLBACK_COMPLETED قطعيًا
      expect(restoreJobRecord.status).toBe('ROLLBACK_COMPLETED');
      expect(restoreJobRecord.status).not.toBe('COMPLETED');
      expect(restoreJobRecord.status).not.toBe('FAILED');
      expect(restoreJobRecord.errorMessage).toContain('Required config file failed to restore: .env');
      expect(restoreJobRecord.errorMessage).toContain('rolled back to safety backup');

      // د. التحقق من تطابق قاعدة بيانات PostgreSQL الحقيقية مع الحالة السابقة تماماً
      const { stdout: dbVal } = await execFileAsync('psql', [
        dbUrlSource, '-t', '-c', "SELECT value FROM platform_settings WHERE key = 'env_rollback_test';",
      ]);
      expect(dbVal.trim()).toBe('PRE_RESTORE_BASELINE_DB_VAL');
      expect(dbVal.trim()).not.toBe('MUTATED_NEW_DB_VAL');

      // هـ. التحقق من تطابق الوسائط الحقيقية على القرص مع الحالة السابقة تماماً
      const finalMediaBytes = await fsp.readFile(baselineMediaFile, 'utf-8');
      expect(finalMediaBytes).toBe('ORIGINAL_BASELINE_MEDIA_BYTES');
      expect(finalMediaBytes).not.toBe('MUTATED_NEW_MEDIA_BYTES');

      // و. لم يتم تحديث lastRestoredAt قطعيًا
      const updatedRestoredAt = backupInstanceUpdateCalls.some((c) => c.data?.lastRestoredAt !== undefined);
      expect(updatedRestoredAt).toBe(false);
    } finally {
      delete process.env.PROJECT_ROOT;
      delete process.env.MEDIA_STORAGE_PATH;
    }
  });
});
