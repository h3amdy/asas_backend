import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { RetentionService } from './services/retention.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { BackupCategory, BackupInstanceStatus } from '@prisma/client';

const execFileAsync = promisify(execFile);

/**
 * دالة التحقق من أن المسار يقع بشكل صارم داخل المجلد الأب باستخدام path.relative
 * تمنع أي تجاوز للمسارات (Path Traversal أو إشارات خاطئة)
 */
function isStrictlyInside(childPath: string, parentDir: string): boolean {
  const resolvedChild = path.resolve(childPath);
  const resolvedParent = path.resolve(parentDir);
  const rel = path.relative(resolvedParent, resolvedChild);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * صمامات الأمان الاستباقية (Pre-Flight Safety Assertion)
 * تمنع أي تشغيل إذا لم يتم إثبات العزل التام
 */
function assertStrictSafety(tempDbName: string, sandboxDir: string): void {
  // 1. التحقق من نمط اسم قاعدة بيانات الاختبار
  const DB_TEST_REGEX = /^asas_retention_test_\d+_[a-z0-9]+$/;
  if (!DB_TEST_REGEX.test(tempDbName)) {
    throw new Error(`CRITICAL SECURITY FAILURE: Database name "${tempDbName}" violates test naming format.`);
  }

  // 2. حظر صارم لأسماء قواعد البيانات التطويرية أو الإنتاجية
  const FORBIDDEN_DBS = ['asas_dev', 'asasprod', 'asas_staging', 'asas_production', 'postgres', 'template1'];
  const lowerDb = tempDbName.toLowerCase();
  if (FORBIDDEN_DBS.includes(lowerDb) || lowerDb.includes('prod') || lowerDb.includes('staging') || lowerDb.includes('dev')) {
    throw new Error(`CRITICAL SECURITY FAILURE: Database "${tempDbName}" matches a protected database name.`);
  }

  // 3. التحقق من مضيف قاعدة البيانات
  const host = process.env.PGHOST || 'localhost';
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`CRITICAL SECURITY FAILURE: PostgreSQL host "${host}" is not local.`);
  }

  // 4. التحقق من مجلد الاختبار المؤقت باستخدام path.relative ومراعاة symlinks على macOS
  const realSystemTmp = fs.realpathSync(os.tmpdir());
  const realSandbox = fs.realpathSync(sandboxDir);
  const relToTmp = path.relative(realSystemTmp, realSandbox);
  if (relToTmp.startsWith('..') || path.isAbsolute(relToTmp) || relToTmp.length === 0) {
    throw new Error(`CRITICAL SECURITY FAILURE: Sandbox directory "${sandboxDir}" is not inside system tmp directory.`);
  }

  // 5. حظر المسارات الحساسة للنظام والمشروع
  const FORBIDDEN_PATHS = ['backups-staging', './backups', '/www/', '/var/data/', '/var/backups/'];
  if (FORBIDDEN_PATHS.some((pattern) => sandboxDir.includes(pattern))) {
    throw new Error(`CRITICAL SECURITY FAILURE: Sandbox directory "${sandboxDir}" contains protected path pattern.`);
  }
}

/**
 * مزود تخزين محلي محمي (Guarded Local Storage Provider)
 * يضمن عدم حذف أي ملف أو مجلد خارج حدود مجلد الاختبار المؤقت
 */
class GuardedLocalStorageProvider extends LocalStorageProvider {
  constructor(private readonly allowedSandbox: string) {
    super();
  }

  override async deleteFile(filePath: string): Promise<void> {
    if (!isStrictlyInside(filePath, this.allowedSandbox)) {
      throw new Error(`SECURITY VIOLATION: Attempted to delete file outside test sandbox: ${filePath}`);
    }
    return super.deleteFile(filePath);
  }

  override async deleteDirectory(dirPath: string): Promise<void> {
    if (!isStrictlyInside(dirPath, this.allowedSandbox)) {
      throw new Error(`SECURITY VIOLATION: Attempted to delete directory outside test sandbox: ${dirPath}`);
    }
    return super.deleteDirectory(dirPath);
  }
}

describe('BKP-002 Isolated Retention Verification Integration Runner', () => {
  let sandboxDir: string;
  let tempDbName: string;
  let tempDbUrl: string;
  let prisma: PrismaService;
  let storage: GuardedLocalStorageProvider;
  let retentionService: RetentionService;

  // سجل الموارد المنشأة بدقة لضمان عدم حذف موارد لم ينشئها الاختبار
  const registry = {
    sandboxCreated: false,
    sandboxDir: '',
    dbCreated: false,
    dbName: '',
    prismaConnected: false,
  };

  beforeAll(async () => {
    // 1. توليد اسم عشوائي آمن ومجلد مؤقت
    tempDbName = `asas_retention_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}`;

    const rawSandbox = await fsp.mkdtemp(path.join(os.tmpdir(), 'retention-test-sandbox-'));
    sandboxDir = await fsp.realpath(rawSandbox);

    // 2. اجتياز حواجز السلامة الإلزامية قبل إنشاء أي مورد
    assertStrictSafety(tempDbName, sandboxDir);

    // توثيق المجلد في السجل
    registry.sandboxDir = sandboxDir;
    registry.sandboxCreated = true;

    // 3. إنشاء قاعدة البيانات المؤقتة
    await execFileAsync('createdb', ['-h', 'localhost', '-p', '5432', tempDbName]);
    registry.dbName = tempDbName;
    registry.dbCreated = true;

    // 4. تطبيق مخطط Prisma المعتمد عبر prisma db push دون --accept-data-loss
    await execFileAsync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    // 5. تهيئة PrismaService والتحقق عبر SELECT current_database()
    prisma = new PrismaService({
      datasourceUrl: tempDbUrl,
    });
    await prisma.onModuleInit();
    registry.prismaConnected = true;

    const dbVerification: any = await prisma.$queryRawUnsafe('SELECT current_database() as db_name;');
    const activeDbName = dbVerification[0]?.db_name;
    if (activeDbName !== tempDbName) {
      throw new Error(
        `CRITICAL ISOLATION FAILURE: Connected to database "${activeDbName}" instead of test database "${tempDbName}"!`,
      );
    }

    // 6. تهيئة مزود التخزين المحمي وخدمة الاحتفاظ
    storage = new GuardedLocalStorageProvider(sandboxDir);
    retentionService = new RetentionService(prisma, storage);
  }, 60000);

  afterAll(async () => {
    // تنظيف الموارد بالترتيب المعكوس، وفقط ما تم إنشاؤه بواسطة هذا الاختبار
    if (registry.prismaConnected && prisma) {
      try {
        await prisma.$disconnect();
      } catch {}
    }

    if (registry.dbCreated && registry.dbName) {
      try {
        // إنهاء الاتصالات النشطة بقاعدة الاختبار قبل حذفها
        await execFileAsync('psql', [
          '-h',
          'localhost',
          '-p',
          '5432',
          '-d',
          'postgres',
          '-c',
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${registry.dbName}';`,
        ]);
        await execFileAsync('dropdb', ['-h', 'localhost', '-p', '5432', '--if-exists', registry.dbName]);
      } catch {}
    }

    if (registry.sandboxCreated && registry.sandboxDir) {
      try {
        await fsp.rm(registry.sandboxDir, { recursive: true, force: true });
      } catch {}
    }
  });

  beforeEach(async () => {
    // تنظيف الجداول قبل كل اختبار للحفاظ على العزل بين السيناريوهات
    await prisma.backupInstance.deleteMany();
    await prisma.backupPlan.deleteMany();
  });

  // مساعد لإنشاء خطة اختبار
  async function createPlan(overrides?: Partial<any>) {
    return prisma.backupPlan.create({
      data: {
        name: 'Staging Isolation Plan',
        enabled: true,
        autoCleanup: true,
        maxBackups: 3,
        maxAgeDays: 7,
        scheduleType: 'DAILY',
        runTime: '02:00',
        timezone: 'Asia/Aden',
        storageType: 'LOCAL',
        storagePath: path.join(sandboxDir, 'storage-plan'),
        ...overrides,
      },
    });
  }

  // مساعد لإنشاء نسخة احتياطية اصطناعية
  async function createInstance(data: {
    planId?: number;
    backupName: string;
    status: BackupInstanceStatus;
    category?: BackupCategory;
    isPinned?: boolean;
    isDeleted?: boolean;
    deletedAt?: Date | null;
    createdAt?: Date;
    storagePath: string;
  }) {
    return prisma.backupInstance.create({
      data: {
        uuid: crypto.randomUUID(),
        planId: data.planId,
        backupName: data.backupName,
        status: data.status,
        category: data.category ?? BackupCategory.NORMAL,
        isPinned: data.isPinned ?? false,
        isDeleted: data.isDeleted ?? false,
        deletedAt: data.deletedAt,
        createdAt: data.createdAt ?? new Date(),
        fileSizeBytes: BigInt(2048),
        sha256: crypto.createHash('sha256').update(data.backupName).digest('hex'),
        storagePath: data.storagePath,
        storageProvider: 'LOCAL',
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو 1: حماية النسخ المثبتة ونسخ الأمان والحد الأدنى للنسخ الناجحة (applyRetentionForPlan)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('1. applyRetentionForPlan: Soft-delete policy & MIN_SAFE_BACKUPS protection', () => {
    it('should protect pinned, SYSTEM_SAFETY, and MIN_SAFE_BACKUPS (3) successes, soft-deleting only excess success and failed instances', async () => {
      const plan = await createPlan({ maxBackups: 3, maxAgeDays: 7 });

      const now = Date.now();
      const fifteenDaysAgo = new Date(now - 15 * 24 * 60 * 60 * 1000);
      const twelveDaysAgo = new Date(now - 12 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);

      // أ. نسخة مثبتة قديمة (15 يوماً) - يجب ألا تُحذف
      const pinned = await createInstance({
        planId: plan.id,
        backupName: 'backup_pinned_old',
        status: BackupInstanceStatus.SUCCESS,
        isPinned: true,
        createdAt: fifteenDaysAgo,
        storagePath: path.join(sandboxDir, 'pinned.tar.gz'),
      });

      // ب. نسخة أمان نظام قديمة (15 يوماً) - يجب ألا تُحذف
      const safety = await createInstance({
        planId: plan.id,
        backupName: 'backup_safety_old',
        status: BackupInstanceStatus.SUCCESS,
        category: BackupCategory.SYSTEM_SAFETY,
        createdAt: fifteenDaysAgo,
        storagePath: path.join(sandboxDir, 'safety.tar.gz'),
      });

      // ج. ثلاث نسخ ناجحة حديثة تمثل الحد الأدنى الآمن (MIN_SAFE_BACKUPS = 3)
      const safe1 = await createInstance({
        planId: plan.id,
        backupName: 'backup_safe_1',
        status: BackupInstanceStatus.SUCCESS,
        createdAt: oneDayAgo,
        storagePath: path.join(sandboxDir, 'safe1.tar.gz'),
      });
      const safe2 = await createInstance({
        planId: plan.id,
        backupName: 'backup_safe_2',
        status: BackupInstanceStatus.SUCCESS,
        createdAt: twoDaysAgo,
        storagePath: path.join(sandboxDir, 'safe2.tar.gz'),
      });
      const safe3 = await createInstance({
        planId: plan.id,
        backupName: 'backup_safe_3',
        status: BackupInstanceStatus.SUCCESS,
        createdAt: threeDaysAgo,
        storagePath: path.join(sandboxDir, 'safe3.tar.gz'),
      });

      // د. نسخة ناجحة رابعة قديمة (15 يوماً) - مؤهلة للحذف وتترك 3 نسخ ناجحة
      const excessSuccess = await createInstance({
        planId: plan.id,
        backupName: 'backup_excess_success',
        status: BackupInstanceStatus.SUCCESS,
        createdAt: fifteenDaysAgo,
        storagePath: path.join(sandboxDir, 'excess_success.tar.gz'),
      });

      // هـ. نسخة فاشلة قديمة (12 يوماً) - تحذف دون أن تؤثر في رصيد النسخ الناجحة
      const excessFailed = await createInstance({
        planId: plan.id,
        backupName: 'backup_excess_failed',
        status: BackupInstanceStatus.FAILED,
        createdAt: twelveDaysAgo,
        storagePath: path.join(sandboxDir, 'excess_failed.tar.gz'),
      });

      // تشغيل منطق الخطة
      const deletedCount = await (retentionService as any).applyRetentionForPlan(plan);
      expect(deletedCount).toBe(2); // فقط النسخة الناجحة الزائدة والنسخة الفاشلة

      // التحقق من قاعدة البيانات
      const dbPinned = await prisma.backupInstance.findUnique({ where: { id: pinned.id } });
      const dbSafety = await prisma.backupInstance.findUnique({ where: { id: safety.id } });
      const dbSafe1 = await prisma.backupInstance.findUnique({ where: { id: safe1.id } });
      const dbSafe2 = await prisma.backupInstance.findUnique({ where: { id: safe2.id } });
      const dbSafe3 = await prisma.backupInstance.findUnique({ where: { id: safe3.id } });
      const dbExcessSuccess = await prisma.backupInstance.findUnique({ where: { id: excessSuccess.id } });
      const dbExcessFailed = await prisma.backupInstance.findUnique({ where: { id: excessFailed.id } });

      // النسخ المحمية لم تُعلم كـ isDeleted
      expect(dbPinned?.isDeleted).toBe(false);
      expect(dbSafety?.isDeleted).toBe(false);
      expect(dbSafe1?.isDeleted).toBe(false);
      expect(dbSafe2?.isDeleted).toBe(false);
      expect(dbSafe3?.isDeleted).toBe(false);

      // النسخ الزائدة تم تعليمها بـ isDeleted: true
      expect(dbExcessSuccess?.isDeleted).toBe(true);
      expect(dbExcessSuccess?.deletedAt).not.toBeNull();
      expect(dbExcessFailed?.isDeleted).toBe(true);
      expect(dbExcessFailed?.deletedAt).not.toBeNull();

      // عدد النسخ الناجحة غير المحذوفة بقي 5 (1 مثبتة + 1 أمان + 3 عادية)
      const activeSuccessCount = await prisma.backupInstance.count({
        where: { isDeleted: false, status: BackupInstanceStatus.SUCCESS },
      });
      expect(activeSuccessCount).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو 2: حماية النسخ المثبتة ونسخ الأمان من الحذف الفعلي (purgeDeletedInstances)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('2. purgeDeletedInstances: Protection for pinned and SYSTEM_SAFETY instances', () => {
    it('should NEVER purge pinned or SYSTEM_SAFETY instances from disk or database even if marked isDeleted before 7 days', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      // ملفات حقيقية على القرص في مسار الاختبار
      const pinnedFile = path.join(sandboxDir, 'purge_pinned.tar.gz');
      const safetyFile = path.join(sandboxDir, 'purge_safety.tar.gz');
      await fsp.writeFile(pinnedFile, 'PINNED_BACKUP_CONTENT');
      await fsp.writeFile(safetyFile, 'SAFETY_BACKUP_CONTENT');

      // نسخ معلّمة خطأً بـ isDeleted: true وتاريخ حذف قبل 10 أيام
      const pinnedInstance = await createInstance({
        backupName: 'purge_pinned_instance',
        status: BackupInstanceStatus.SUCCESS,
        isPinned: true,
        isDeleted: true,
        deletedAt: tenDaysAgo,
        storagePath: pinnedFile,
      });

      const safetyInstance = await createInstance({
        backupName: 'purge_safety_instance',
        status: BackupInstanceStatus.SUCCESS,
        category: BackupCategory.SYSTEM_SAFETY,
        isDeleted: true,
        deletedAt: tenDaysAgo,
        storagePath: safetyFile,
      });

      // تشغيل التطهير الفعلي
      const purged = await (retentionService as any).purgeDeletedInstances();
      expect(purged).toBe(0);

      // 1. السجلات ما زالت موجودة في قاعدة البيانات
      const checkPinned = await prisma.backupInstance.findUnique({ where: { id: pinnedInstance.id } });
      const checkSafety = await prisma.backupInstance.findUnique({ where: { id: safetyInstance.id } });
      expect(checkPinned).not.toBeNull();
      expect(checkSafety).not.toBeNull();

      // 2. الملفات ما زالت موجودة على القرص
      expect(fs.existsSync(pinnedFile)).toBe(true);
      expect(fs.existsSync(safetyFile)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو 3: معالجة أخطاء الملفات (ENOENT وفشل الحذف الحقيقي والتطهير الناجح)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('3. purgeDeletedInstances: ENOENT tolerance and real deletion failure handling', () => {
    it('should tolerate ENOENT by deleting DB record, retain DB record on real deletion failure, and cleanly purge valid archives with sidecars', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      // أ. حالة ENOENT: الملف غير موجود على القرص
      const enoentFile = path.join(sandboxDir, 'non_existent_archive.tar.gz');
      const enoentInstance = await createInstance({
        backupName: 'instance_enoent',
        status: BackupInstanceStatus.SUCCESS,
        isDeleted: true,
        deletedAt: tenDaysAgo,
        storagePath: enoentFile,
      });

      // ب. حالة فشل حقيقي (non-ENOENT): المسار يشير إلى مجلد، مما يجعل unlink يرمي خطأ EPERM/EISDIR حتمياً
      const failingDirPath = path.join(sandboxDir, 'failing_archive_directory');
      await fsp.mkdir(failingDirPath, { recursive: true });
      const failingInstance = await createInstance({
        backupName: 'instance_failing_delete',
        status: BackupInstanceStatus.SUCCESS,
        isDeleted: true,
        deletedAt: tenDaysAgo,
        storagePath: failingDirPath,
      });

      // ج. حالة نجاح كامل: الأرشيف موجود مع ملفات sidecars (.sha256 و .manifest.json)
      const validArchive = path.join(sandboxDir, 'valid_to_purge.tar.gz');
      const validSha = `${validArchive}.sha256`;
      const validManifest = `${validArchive}.manifest.json`;
      await fsp.writeFile(validArchive, 'VALID_ARCHIVE_DATA');
      await fsp.writeFile(validSha, 'MOCK_SHA256_HASH');
      await fsp.writeFile(validManifest, '{"backupId":"test"}');

      const validInstance = await createInstance({
        backupName: 'instance_valid_purge',
        status: BackupInstanceStatus.SUCCESS,
        isDeleted: true,
        deletedAt: tenDaysAgo,
        storagePath: validArchive,
      });

      // تنفيذ التطهير
      const purgedCount = await (retentionService as any).purgeDeletedInstances();

      // تم تطهير نسختين: ENOENT والنسخة الصالحة
      expect(purgedCount).toBe(2);

      // 1. تحقق ENOENT: تم حذف سجل قاعدة البيانات بنجاح رغم عدم وجود الملف
      const checkEnoent = await prisma.backupInstance.findUnique({ where: { id: enoentInstance.id } });
      expect(checkEnoent).toBeNull();

      // 2. تحقق الفشل الحقيقي: لم يتم حذف سجل قاعدة البيانات لحماية المرجع وإعادة المحاولة لاحقاً
      const checkFailing = await prisma.backupInstance.findUnique({ where: { id: failingInstance.id } });
      expect(checkFailing).not.toBeNull();
      expect(fs.existsSync(failingDirPath)).toBe(true);

      // 3. تحقق النجاح الكامل: تم حذف الأرشيف وملفات sidecars، وحذف سجل قاعدة البيانات
      const checkValid = await prisma.backupInstance.findUnique({ where: { id: validInstance.id } });
      expect(checkValid).toBeNull();
      expect(fs.existsSync(validArchive)).toBe(false);
      expect(fs.existsSync(validSha)).toBe(false);
      expect(fs.existsSync(validManifest)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // سيناريو 4: التشغيل الكامل عبر runRetention والتحقق من مهلة الأمان (7 أيام)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('4. runRetention: Complete pipeline execution & 7-day grace period enforcement', () => {
    it('should soft-delete eligible instance via applyRetentionForPlan but preserve it from purge in the same run due to 7-day grace period', async () => {
      const plan = await createPlan({ maxBackups: 3, maxAgeDays: 5 });

      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const filePath = path.join(sandboxDir, 'grace_period_test.tar.gz');
      await fsp.writeFile(filePath, 'GRACE_PERIOD_ARCHIVE');

      // إنشاء 3 نسخ آمنة حديثة
      for (let i = 1; i <= 3; i++) {
        await createInstance({
          planId: plan.id,
          backupName: `grace_safe_${i}`,
          status: BackupInstanceStatus.SUCCESS,
          createdAt: new Date(),
          storagePath: path.join(sandboxDir, `safe_${i}.tar.gz`),
        });
      }

      // نسخة رابعة قديمة (عمرها 8 أيام) نشطة
      const excessInstance = await createInstance({
        planId: plan.id,
        backupName: 'grace_excess_candidate',
        status: BackupInstanceStatus.SUCCESS,
        createdAt: eightDaysAgo,
        storagePath: filePath,
      });

      // تشغيل الدورة الكاملة لـ runRetention
      await retentionService.runRetention();

      // فحص النتيجة:
      // النسخة تم وسمها بـ isDeleted: true في المرحلة الأولى (applyRetentionForPlan)،
      // لكنها لم تُحذف من القرص ولا من الـ DB في المرحلة الثانية (purgeDeletedInstances)
      // لأن deletedAt يساوي لحظة التشغيل (أحدث بكثير من 7 أيام)!
      const checkInstance = await prisma.backupInstance.findUnique({ where: { id: excessInstance.id } });
      expect(checkInstance).not.toBeNull();
      expect(checkInstance?.isDeleted).toBe(true);
      expect(checkInstance?.deletedAt).not.toBeNull();
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
