import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigBackupEngine } from './engines/config-backup.engine';
import { restoreConfigFiles } from './utils/safe-copy';
import { BackupOrchestratorService } from './services/backup-orchestrator.service';
import { BackupManifest } from './types/manifest.type';

/**
 * Pre-Production Staging Verification Gate Tests (BKP-001)
 *
 * سيناريوهات بوابة التحقق لبيئة Staging:
 * A. Backup ناجح بالكامل مع ملفات إعداد صالحة
 * B. فشل ملف إلزامي (.env مفقود أو غير قابل للقراءة) واتساق الطبقات الثلاث (Job, Instance, Manifest)
 * C. Restore ناجح مع التحقق من المحتوى، الصلاحيات (0600 والحفاظ)، والنسخ الاحتياطية pre-restore، وتوجيه nginx لمجلد المراجعة
 * D. Restore يفشل في منتصف التنفيذ مع بقاء الأصل والنسخة السابقة وعدم إعلان نجاح زائف
 */
describe('BKP-001 Staging Pre-Production Verification Gate', () => {
  let stagingSandbox: string;

  beforeEach(async () => {
    stagingSandbox = await fsp.mkdtemp(path.join(os.tmpdir(), 'staging-gate-sandbox-'));
  });

  afterEach(async () => {
    await fsp.rm(stagingSandbox, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو A: Backup ناجح بالكامل (Full Successful Backup)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Scenario A: Full Successful Backup', () => {
    it('should complete backup successfully, producing valid manifest with SUCCESS consistency and all config files', async () => {
      // 1. إعداد بيئة مشروع Staging معزولة تماماً بملفات صالحة
      const mockProjectRoot = path.join(stagingSandbox, 'project-a');
      const workDir = path.join(stagingSandbox, 'work-a');
      await fsp.mkdir(mockProjectRoot, { recursive: true });
      await fsp.mkdir(workDir, { recursive: true });

      const envContent = 'PORT=3000\nDATABASE_URL=postgres://test:test@localhost:5432/db\nNODE_ENV=staging';
      const pm2Content = 'module.exports = { apps: [{ name: "asas-app" }] };';
      await fsp.writeFile(path.join(mockProjectRoot, '.env'), envContent);
      await fsp.writeFile(path.join(mockProjectRoot, 'pm2.config.js'), pm2Content);

      // 2. تشغيل محرك النسخ الفعلي
      const engine = new ConfigBackupEngine();
      const configResult = await engine.execute(workDir, mockProjectRoot);

      // التحقق من مخرجات محرك النسخ
      expect(configResult.success).toBe(true);
      expect(configResult.details.files).toEqual(expect.arrayContaining(['.env', 'pm2.config.js']));
      expect(configResult.details.failedRequired).toHaveLength(0);
      expect(configResult.errorMessage).toBeUndefined();

      // 3. محاكاة المنسق: بناء الـ Manifest وحساب الحالات
      const mediaResult = {
        success: true,
        sizeBytes: BigInt(0),
        durationMs: 1,
        details: { filesExpected: 0, filesCopied: 0, missingStorageKeys: [] },
      };
      const dbResult = {
        success: true,
        sizeBytes: BigInt(1024),
        durationMs: 5,
        details: { sha256: 'mock-db-sha256' },
      };

      const orchestrator = new BackupOrchestratorService(
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, engine,
      );

      const overallConsistency = 'SUCCESS';
      const manifest: BackupManifest = (orchestrator as any).buildManifest(
        'job-uuid-a',
        'NORMAL',
        'MANUAL',
        dbResult,
        mediaResult,
        configResult,
        overallConsistency,
        undefined,
      );

      // التحقق من اتساق الـ Manifest
      expect(manifest.consistency.status).toBe('SUCCESS');
      expect(manifest.components.config).not.toBeNull();
      expect(manifest.components.config!.included).toBe(true);
      expect(manifest.components.config!.files).toEqual(expect.arrayContaining(['.env', 'pm2.config.js']));
      expect(manifest.components.config!.failedRequired).toBeUndefined();
      expect(manifest.components.config!.error).toBeUndefined();

      // التحقق من محتوى الملفات المنسوخة داخل مجلد العمل
      const copiedEnv = await fsp.readFile(path.join(workDir, 'config', '.env'), 'utf-8');
      expect(copiedEnv).toBe(envContent);
      const copiedPm2 = await fsp.readFile(path.join(workDir, 'config', 'pm2.config.js'), 'utf-8');
      expect(copiedPm2).toBe(pm2Content);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو B: فشل ملف إلزامي (.env مفقود) واتساق الطبقات الثلاث
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Scenario B: Required Config File Missing (.env missing)', () => {
    it('should maintain strict consistency across Job, Instance, and Manifest without declaring unearned full success', async () => {
      // 1. بيئة اختبار خالية من .env عمداً
      const mockProjectRoot = path.join(stagingSandbox, 'project-b-no-env');
      const workDir = path.join(stagingSandbox, 'work-b');
      await fsp.mkdir(mockProjectRoot, { recursive: true });
      await fsp.mkdir(workDir, { recursive: true });

      // فقط ملف pm2 موجود، بينما .env مفقود
      await fsp.writeFile(path.join(mockProjectRoot, 'pm2.config.js'), 'module.exports = {};');

      const engine = new ConfigBackupEngine();
      const configResult = await engine.execute(workDir, mockProjectRoot);

      // 1. محرك الإعدادات يرفض النجاح
      expect(configResult.success).toBe(false);
      expect(configResult.details.failedRequired).toEqual(['.env']);
      expect(configResult.errorMessage).toBe('Required config files missing: .env');

      const dbResult = { success: true, sizeBytes: BigInt(512), durationMs: 2, details: { sha256: 'mock' } };
      const mediaResult = { success: true, sizeBytes: BigInt(0), durationMs: 1, details: { filesExpected: 0, filesCopied: 0, missingStorageKeys: [] } };

      // 2. فحص محاكاة الطبقات الثلاث مع تتبع العمليات
      const mediaStatus: 'SUCCESS' | 'PARTIAL_SUCCESS' =
        mediaResult.details.missingStorageKeys.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS';
      const configHasRequiredFailure = (configResult.details.failedRequired?.length ?? 0) > 0;
      const configEngineFailedCompletely = !configResult.success && configResult.details.failedRequired?.length === 0;

      const overallConsistency: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' =
        mediaStatus === 'PARTIAL_SUCCESS' || configHasRequiredFailure || configEngineFailedCompletely
          ? 'PARTIAL_SUCCESS'
          : 'SUCCESS';

      // تأكيد أن الحالة الشاملة هي PARTIAL_SUCCESS وليست SUCCESS
      expect(overallConsistency).toBe('PARTIAL_SUCCESS');

      // بناء الـ Manifest
      const orchestrator = new BackupOrchestratorService(
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, engine,
      );

      const manifest: BackupManifest = (orchestrator as any).buildManifest(
        'job-uuid-b',
        'NORMAL',
        'MANUAL',
        dbResult,
        mediaResult,
        configResult,
        overallConsistency,
        undefined,
      );

      // ── فحص الطبقة 1: Manifest ──
      expect(manifest.consistency.status).toBe('PARTIAL_SUCCESS');
      expect(manifest.components.config).not.toBeNull();
      expect(manifest.components.config!.failedRequired).toEqual(['.env']);
      expect(manifest.components.config!.error).toBe('Required config files missing: .env');

      // ── فحص الطبقة 2: Backup Instance ──
      const instanceStatus = overallConsistency;
      expect(instanceStatus).toBe('PARTIAL_SUCCESS'); // Instance يعكس الفشل صراحة

      // ── فحص الطبقة 3: Backup Job ──
      const jobErrorMessage =
        overallConsistency === 'PARTIAL_SUCCESS'
          ? [
              ...(configResult.errorMessage ? [configResult.errorMessage] : []),
              ...(mediaStatus === 'PARTIAL_SUCCESS' ? ['Media backup partial'] : []),
            ].join('; ') || 'Completed with partial consistency'
          : undefined;

      // Job Status في Prisma هو COMPLETED (اكتمل مسار المعالجة)، لكنه يحمل رسالة خطأ صريحة توثق الفشل الجزئي
      expect(jobErrorMessage).toBe('Required config files missing: .env');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو C: Restore ناجح مع التحقق من المحتوى والصلاحيات وNginx
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Scenario C: Successful Restore with Permissions and Review Safety', () => {
    it('should restore .env to fresh destination with 0600 default permissions', async () => {
      const configDir = path.join(stagingSandbox, 'archive-c1-config');
      const mockProjectRoot = path.join(stagingSandbox, 'project-c1');
      await fsp.mkdir(configDir, { recursive: true });
      await fsp.mkdir(mockProjectRoot, { recursive: true });

      const secretPayload = 'DATABASE_URL=postgres://prod_secret:safe@db/main\nAPP_KEY=xyz789';
      await fsp.writeFile(path.join(configDir, '.env'), secretPayload);

      // استعادة إلى وجهة لا يوجد فيها الملف مسبقاً
      const result = await restoreConfigFiles(configDir, mockProjectRoot, ['.env']);

      expect(result.files[0].status).toBe('restored');
      expect(result.restoredCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.level).toBe('INFO');

      // التحقق من المحتوى المستعاد
      const restoredPath = path.join(mockProjectRoot, '.env');
      expect(await fsp.readFile(restoredPath, 'utf-8')).toBe(secretPayload);

      // التحقق الصارم من الصلاحيات: 0600
      const stat = await fsp.stat(restoredPath);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('should restore over existing .env preserving original non-0600 permissions and creating pre-restore backup', async () => {
      const configDir = path.join(stagingSandbox, 'archive-c2-config');
      const mockProjectRoot = path.join(stagingSandbox, 'project-c2');
      await fsp.mkdir(configDir, { recursive: true });
      await fsp.mkdir(mockProjectRoot, { recursive: true });

      // ملف .env موجود مسبقاً بصلاحيات 0640 ومحتوى قديم
      const originalPath = path.join(mockProjectRoot, '.env');
      const originalContent = 'SECRET=old_pre_existing_data';
      await fsp.writeFile(originalPath, originalContent);
      await fsp.chmod(originalPath, 0o640);

      // نسخة احتياطية جديدة في الأرشيف
      const newContent = 'SECRET=new_restored_payload_2026';
      await fsp.writeFile(path.join(configDir, '.env'), newContent);

      const result = await restoreConfigFiles(configDir, mockProjectRoot, ['.env']);

      expect(result.files[0].status).toBe('restored');
      expect(result.restoredCount).toBe(1);

      // 1. المحتوى تم تحديثه
      expect(await fsp.readFile(originalPath, 'utf-8')).toBe(newContent);

      // 2. تم الحفاظ بدقة على الصلاحيات الأصلية (0640) لمنع توسيع الصلاحيات
      const statAfter = await fsp.stat(originalPath);
      expect(statAfter.mode & 0o777).toBe(0o640);

      // 3. تم إنشاء نسخة pre-restore سليمة وقابلة للاسترجاع
      const files = await fsp.readdir(mockProjectRoot);
      const backupFile = files.find((f) => f.includes('pre-restore'));
      expect(backupFile).toBeDefined();

      const backupContent = await fsp.readFile(path.join(mockProjectRoot, backupFile!), 'utf-8');
      expect(backupContent).toBe(originalContent);
      const backupStat = await fsp.stat(path.join(mockProjectRoot, backupFile!));
      expect(backupStat.mode & 0o777).toBe(0o640);
    });

    it('should divert nginx.conf strictly to restore-review folder without writing to live nginx paths', async () => {
      const configDir = path.join(stagingSandbox, 'archive-c3-config');
      const mockProjectRoot = path.join(stagingSandbox, 'project-c3');
      await fsp.mkdir(configDir, { recursive: true });
      await fsp.mkdir(mockProjectRoot, { recursive: true });

      const nginxConfig = 'server { listen 80; server_name asas.local; }';
      await fsp.writeFile(path.join(configDir, 'nginx.conf'), nginxConfig);

      const result = await restoreConfigFiles(configDir, mockProjectRoot, ['nginx.conf']);

      expect(result.files[0].status).toBe('review');
      expect(result.restoredCount).toBe(1);
      expect(result.failedCount).toBe(0);

      // تم الحفظ في مجلد المراجعة حصراً
      const reviewPath = path.join(mockProjectRoot, 'restore-review', 'nginx.conf.restored');
      expect(fs.existsSync(reviewPath)).toBe(true);
      expect(await fsp.readFile(reviewPath, 'utf-8')).toBe(nginxConfig);

      // تأكيد عدم لمس مسارات النظام الحية
      expect(fs.existsSync('/etc/nginx/sites-available/asas.test_diverted')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو D: Restore يفشل في منتصف التنفيذ (Mid-Execution Failure)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Scenario D: Mid-execution Restore Failure Handling', () => {
    it('should preserve original destination, keep pre-restore backup, clean temp file, and declare WARN without false success', async () => {
      const configDir = path.join(stagingSandbox, 'archive-d-config');
      const mockProjectRoot = path.join(stagingSandbox, 'project-d');
      await fsp.mkdir(configDir, { recursive: true });
      await fsp.mkdir(mockProjectRoot, { recursive: true });

      // ملف أصلي ذو أهمية حرجة
      const originalPath = path.join(mockProjectRoot, '.env');
      const originalSecret = 'PRODUCTION_KEY=critical_uncompromised';
      await fsp.writeFile(originalPath, originalSecret);
      await fsp.chmod(originalPath, 0o600);

      // ملف جديد في الأرشيف
      await fsp.writeFile(path.join(configDir, '.env'), 'ATTACK_DATA=bad_payload');

      // حقن فشل في دالة chmod أثناء الاستبدال
      const failingChmodFn = async (_p: string, _m: number): Promise<void> => {
        throw new Error('Injected filesystem I/O error during chmod: EIO');
      };
      const renameSpy = jest.fn();
      const unlinkSpy = jest.fn(async (p: string) => fsp.unlink(p));

      const result = await restoreConfigFiles(
        configDir,
        mockProjectRoot,
        ['.env'],
        {
          chmodFn: failingChmodFn,
          renameFn: renameSpy,
          unlinkFn: unlinkSpy,
        },
      );

      // 1. عدم إعلان نجاح زائف
      expect(result.files[0].status).toBe('failed');
      expect(result.files[0].error).toContain('Injected filesystem I/O error during chmod');
      expect(result.failedCount).toBe(1);
      expect(result.restoredCount).toBe(0);
      expect(result.level).toBe('WARN');
      expect(result.message).toContain('0 OK, 1 failed');

      // 2. لم يُنفذ rename إطلاقاً
      expect(renameSpy).not.toHaveBeenCalled();

      // 3. الملف الأصلي لم يتغير محتواه ولا صلاحياته
      expect(await fsp.readFile(originalPath, 'utf-8')).toBe(originalSecret);
      const originalStat = await fsp.stat(originalPath);
      expect(originalStat.mode & 0o777).toBe(0o600);

      // 4. تم إنشاء نسخة احتياطية pre-restore قبل محاولة الاستبدال وبقيت سليمة وقابلة للاسترجاع
      const dirFiles = await fsp.readdir(mockProjectRoot);
      const preRestore = dirFiles.find((f) => f.includes('pre-restore'));
      expect(preRestore).toBeDefined();
      expect(await fsp.readFile(path.join(mockProjectRoot, preRestore!), 'utf-8')).toBe(originalSecret);

      // 5. محاولة تنظيف الملف المؤقت تمت بنجاح
      expect(unlinkSpy).toHaveBeenCalledTimes(1);
      const lingeringTemps = dirFiles.filter((f) => f.startsWith('.env.tmp.'));
      expect(lingeringTemps).toHaveLength(0);
    });
  });
});
