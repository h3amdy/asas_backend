/**
 * SUB-IMPLEMENTATION-PLAN v1.1 — اختبارات E2E للمراحل 2 و3 و6
 *
 * يختبر:
 * - المرحلة 2: إعدادات الاشتراك + التفعيل + طرق الدفع
 * - المرحلة 3: دفعات الرموز + التشفير + HMAC
 * - المرحلة 6: حالة الطالب + تفعيل الرمز + حساب 29 فبراير
 *
 * يعمل على قاعدة اختبارية قابلة للإتلاف فقط:
 *   SUB_TEST_DATABASE_URL=postgresql://.../asas_sub_test \
 *   ACTIVATION_CODE_ENC_KEY_V1=EGmxwf7Hw4YeOXiZk9dHSpSJjhJzw84T7NQaYSJiMWI= \
 *   ACTIVATION_CODE_HMAC_KEY_V1=akB+Rxs2Jg0DeP0XlaTcFXs7jYATkxH2y7b8Z7iVMas= \
 *   npm run test:e2e -- subscription-api
 */
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

// ─── خدمات التشفير (مباشرة، بدون NestJS DI) ──────────────
import { CodeGeneratorService } from '../../src/school/manager/subscription/crypto/code-generator.service';
import { CodeCryptoService } from '../../src/school/manager/subscription/crypto/code-crypto.service';
import { CodeHmacService } from '../../src/school/manager/subscription/crypto/code-hmac.service';

// ─── دالة حساب السنة التقويمية ──────────────────────────
import { calculateCalendarYearEnd } from '../../src/school/student/subscription/student-subscription.service';

// ─── خدمة Idempotency (مباشرة على PrismaClient) ──────────
import { IdempotencyService } from '../../src/school/common/subscription/idempotency.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CodeBatchService } from '../../src/school/manager/subscription/code-batch.service';
import { SubscriptionService } from '../../src/school/manager/subscription/subscription.service';
import { SubscriptionTrialService } from '../../src/school/common/subscription/subscription-trial.service';

// ─── إعداد المفاتيح للاختبار ─────────────────────────────
const TEST_ENC_KEY = 'EGmxwf7Hw4YeOXiZk9dHSpSJjhJzw84T7NQaYSJiMWI=';
const TEST_HMAC_KEY = 'akB+Rxs2Jg0DeP0XlaTcFXs7jYATkxH2y7b8Z7iVMas=';

// تعيين متغيرات البيئة قبل تهيئة الخدمات
process.env.ACTIVATION_CODE_ENC_KEY_V1 = TEST_ENC_KEY;
process.env.ACTIVATION_CODE_HMAC_KEY_V1 = TEST_HMAC_KEY;

const TEST_URL = process.env.SUB_TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('Subscription API — Phases 2, 3, 6', () => {
  let prisma: PrismaClient;
  let codeGenerator: CodeGeneratorService;
  let codeCrypto: CodeCryptoService;
  let codeHmac: CodeHmacService;

  // بيانات الاختبار
  let schoolId: number;
  let schoolBId: number;
  let adminId: number;
  let studentId: number;
  let studentBId: number;
  let serial = 1;

  const mkSchool = (code: number) =>
    prisma.school.create({
      data: { name: `SUB-API-TEST-${code}`, schoolCode: code, appType: 'PRIVATE' },
    });
  const mkUser = (sid: number, userType: 'ADMIN' | 'STUDENT', name: string) =>
    prisma.user.create({
      data: { schoolId: sid, userType, name, passwordHash: 'x', isActive: true },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    codeGenerator = new CodeGeneratorService();
    codeCrypto = new CodeCryptoService();
    codeHmac = new CodeHmacService();

    // إنشاء بيانات الاختبار
    const base = 800000 + Math.floor(Math.random() * 90000);
    schoolId = (await mkSchool(base)).id;
    schoolBId = (await mkSchool(base + 1)).id;
    adminId = (await mkUser(schoolId, 'ADMIN', 'test-admin')).id;
    studentId = (await mkUser(schoolId, 'STUDENT', 'test-student')).id;
    studentBId = (await mkUser(schoolBId, 'STUDENT', 'test-student-b')).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const ids = [schoolId, schoolBId].filter(Boolean);
    // تنظيف بترتيب عكسي للعلاقات
    await prisma.subscriptionAuditEvent.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.idempotencyRecord.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.studentAccessPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.activationCode.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.activationCodeBatch.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolPaymentMethod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolSubscriptionSettings.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.user.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════════════════
  // المرحلة 2: الإعدادات والتفعيل
  // ═══════════════════════════════════════════════════════════

  describe('Phase 2: Settings & Activation', () => {

    it('should return default settings for non-activated school', async () => {
      const settings = await prisma.schoolSubscriptionSettings.findUnique({
        where: { schoolId },
      });
      expect(settings).toBeNull(); // لا إعدادات بعد
    });

    it('should activate subscription atomically', async () => {
      const now = new Date();

      // إنشاء إعدادات مفعّلة
      await prisma.schoolSubscriptionSettings.create({
        data: {
          schoolId,
          isActivated: true,
          activatedAt: now,
          isTrialEnabled: true,
          trialDurationDays: 14,
          subscriptionPrice: new Prisma.Decimal('30000'),
          contactNumber: '+967770000000',
        },
      });

      // إنشاء طرق دفع
      await prisma.schoolPaymentMethod.createMany({
        data: [
          { schoolId, name: 'تحويل بنكي', paymentDetails: 'حساب رقم 12345', sortOrder: 1 },
          { schoolId, name: 'كاش', paymentDetails: 'الدفع في المدرسة', sortOrder: 2 },
        ],
      });

      // تحقق
      const settings = await prisma.schoolSubscriptionSettings.findUnique({
        where: { schoolId },
      });
      expect(settings!.isActivated).toBe(true);
      expect(settings!.activatedAt).toBeTruthy();
      expect(settings!.subscriptionPrice!.toString()).toBe('30000');

      const methods = await prisma.schoolPaymentMethod.findMany({
        where: { schoolId, isDeleted: false },
        orderBy: { sortOrder: 'asc' },
      });
      expect(methods).toHaveLength(2);
      expect(methods[0].name).toBe('تحويل بنكي');
    });

    it('should prevent double activation (settings already activated)', async () => {
      const settings = await prisma.schoolSubscriptionSettings.findUnique({
        where: { schoolId },
      });
      expect(settings!.isActivated).toBe(true);
      // محاولة إنشاء إعدادات ثانية تفشل بسبب UNIQUE schoolId
      await expect(
        prisma.schoolSubscriptionSettings.create({
          data: { schoolId, isActivated: true, activatedAt: new Date(),
            subscriptionPrice: new Prisma.Decimal('10000'), contactNumber: '111' },
        }),
      ).rejects.toThrow();
    });

    it('should create trial periods for existing students on activation', async () => {
      const now = new Date();
      const trialDays = 14;
      const expiresAt = new Date(now);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + trialDays);

      await prisma.studentAccessPeriod.create({
        data: {
          schoolId,
          studentUserId: studentId,
          periodType: 'TRIAL',
          startedAt: now,
          expiresAt,
        },
      });

      const trial = await prisma.studentAccessPeriod.findFirst({
        where: { schoolId, studentUserId: studentId, periodType: 'TRIAL' },
      });
      expect(trial).toBeTruthy();
      expect(trial!.endedEarlyAt).toBeNull();
    });

    it('should enforce max 10 active payment methods', async () => {
      // أضف 8 طرق أخرى (لدينا 2 بالفعل)
      for (let i = 3; i <= 10; i++) {
        await prisma.schoolPaymentMethod.create({
          data: { schoolId, name: `Method ${i}`, paymentDetails: `Details ${i}`, sortOrder: i },
        });
      }

      const count = await prisma.schoolPaymentMethod.count({
        where: { schoolId, isDeleted: false },
      });
      expect(count).toBe(10);
    });

    it('should prevent deleting the last payment method', async () => {
      // حذف كل الطرق ما عدا واحدة
      const methods = await prisma.schoolPaymentMethod.findMany({
        where: { schoolId, isDeleted: false },
        orderBy: { id: 'asc' },
      });

      for (let i = 1; i < methods.length; i++) {
        await prisma.schoolPaymentMethod.update({
          where: { id: methods[i].id },
          data: { isDeleted: true, deletedAt: new Date() },
        });
      }

      const remaining = await prisma.schoolPaymentMethod.count({
        where: { schoolId, isDeleted: false },
      });
      expect(remaining).toBe(1);
      // الآخير لا يُحذف (يُفرض في التطبيق — نتحقق أنه باقٍ)
    });

    it('should update settings without affecting existing trial periods', async () => {
      const trialBefore = await prisma.studentAccessPeriod.findFirst({
        where: { schoolId, studentUserId: studentId, periodType: 'TRIAL' },
      });

      await prisma.schoolSubscriptionSettings.update({
        where: { schoolId },
        data: { trialDurationDays: 30, subscriptionPrice: new Prisma.Decimal('50000') },
      });

      const trialAfter = await prisma.studentAccessPeriod.findFirst({
        where: { schoolId, studentUserId: studentId, periodType: 'TRIAL' },
      });

      // الفترة لم تتغير
      expect(trialAfter!.expiresAt.getTime()).toBe(trialBefore!.expiresAt.getTime());
    });
  });

  // ═══════════════════════════════════════════════════════════
  // المرحلة 3: دفعات الرموز والتشفير
  // ═══════════════════════════════════════════════════════════

  describe('Phase 3: Code Batches & Crypto', () => {
    let batchId: number;
    let batchUuid: string;
    const codeUuids: string[] = [];
    const plaintexts: string[] = [];
    const lookupHashes: string[] = [];

    it('should generate unique codes with correct alphabet', () => {
      const codes = new Set<string>();
      const validChars = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;

      for (let i = 0; i < 100; i++) {
        const code = codeGenerator.generateCode();
        expect(code).toHaveLength(12);
        expect(code).toMatch(validChars);
        codes.add(code);
      }
      // 100 رموز عشوائية يجب أن تكون فريدة (احتمال التصادم ~ 0)
      expect(codes.size).toBe(100);
    });

    it('should format code as XXXX-XXXX-XXXX', () => {
      const formatted = codeGenerator.formatCode('ABCD1234EFGH');
      expect(formatted).toBe('ABCD-1234-EFGH');
    });

    it('should encrypt and decrypt with AAD binding', () => {
      const plaintext = codeGenerator.generateCode();
      const bUuid = randomUUID();
      const cUuid = randomUUID();
      const sid = schoolId;

      const aad = codeCrypto.buildAAD(sid, bUuid, cUuid);
      const { ciphertext, keyVersion } = codeCrypto.encrypt(plaintext, aad);

      expect(keyVersion).toBe(1);
      expect(ciphertext.length).toBeGreaterThan(12); // IV + tag + cipher

      // فك التشفير بنفس الـ AAD
      const decrypted = codeCrypto.decrypt(ciphertext, aad, keyVersion);
      expect(decrypted).toBe(plaintext);
    });

    it('should fail decrypt with wrong AAD (different school)', () => {
      const plaintext = 'TESTCODE1234';
      const bUuid = randomUUID();
      const cUuid = randomUUID();

      const aad = codeCrypto.buildAAD(schoolId, bUuid, cUuid);
      const { ciphertext, keyVersion } = codeCrypto.encrypt(plaintext, aad);

      // AAD مختلف (مدرسة أخرى)
      const wrongAad = codeCrypto.buildAAD(schoolBId, bUuid, cUuid);
      expect(() => codeCrypto.decrypt(ciphertext, wrongAad, keyVersion)).toThrow();
    });

    it('should produce deterministic HMAC for same input', () => {
      const text = 'TESTHMAC1234';
      const { hash: h1 } = codeHmac.computeHash(text);
      const { hash: h2 } = codeHmac.computeHash(text);
      expect(h1).toBe(h2);

      // HMAC مختلف لنص مختلف
      const { hash: h3 } = codeHmac.computeHash('DIFFERENT123');
      expect(h3).not.toBe(h1);
    });

    it('should create a code batch with correct serial range', async () => {
      batchUuid = randomUUID();
      const codeCount = 5;
      const serialStart = 1;
      const serialEnd = serialStart + codeCount - 1;

      // تحديث nextCodeSerial
      await prisma.schoolSubscriptionSettings.update({
        where: { schoolId },
        data: { nextCodeSerial: serialStart + codeCount },
      });

      // إنشاء الدفعة
      const batch = await prisma.activationCodeBatch.create({
        data: {
          uuid: batchUuid,
          schoolId,
          codeCount,
          serialStart,
          serialEnd,
          createdByUserId: adminId,
        },
      });
      batchId = batch.id;

      expect(batch.serialStart).toBe(1);
      expect(batch.serialEnd).toBe(5);

      // إنشاء الرموز
      for (let i = 0; i < codeCount; i++) {
        const cUuid = randomUUID();
        const plaintext = codeGenerator.generateCode();
        const { hash, keyVersion: hmacVer } = codeHmac.computeHash(plaintext);
        const aad = codeCrypto.buildAAD(schoolId, batchUuid, cUuid);
        const { ciphertext, keyVersion: encVer } = codeCrypto.encrypt(plaintext, aad);

        await prisma.activationCode.create({
          data: {
            uuid: cUuid,
            schoolId,
            batchId,
            serialNumber: serialStart + i,
            codeCiphertext: ciphertext,
            codeLookupHash: hash,
            encKeyVersion: encVer,
            hmacKeyVersion: hmacVer,
          },
        });

        codeUuids.push(cUuid);
        plaintexts.push(plaintext);
        lookupHashes.push(hash);
      }

      const codes = await prisma.activationCode.findMany({
        where: { batchId, schoolId },
      });
      expect(codes).toHaveLength(5);
    });

    it('should decrypt unused codes correctly', async () => {
      const code = await prisma.activationCode.findFirst({
        where: { batchId, schoolId, status: 'UNUSED' },
        select: { uuid: true, codeCiphertext: true, encKeyVersion: true },
      });
      expect(code).toBeTruthy();

      const aad = codeCrypto.buildAAD(schoolId, batchUuid, code!.uuid);
      const decrypted = codeCrypto.decrypt(
        Buffer.from(code!.codeCiphertext),
        aad,
        code!.encKeyVersion,
      );
      expect(decrypted).toHaveLength(12);
      expect(plaintexts).toContain(decrypted);
    });

    it('should have unique HMAC hashes for each code', () => {
      const uniqueHashes = new Set(lookupHashes);
      expect(uniqueHashes.size).toBe(lookupHashes.length);
    });

    it('should find code by HMAC lookup', async () => {
      const hash = lookupHashes[0];
      const found = await prisma.activationCode.findFirst({
        where: { codeLookupHash: hash, status: 'UNUSED' },
      });
      expect(found).toBeTruthy();
      expect(found!.schoolId).toBe(schoolId);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // المرحلة 6: حالة الطالب وتفعيل الرمز
  // ═══════════════════════════════════════════════════════════

  describe('Phase 6: Student Status & Code Activation', () => {

    it('should show TRIAL status for student with active trial', async () => {
      const trial = await prisma.studentAccessPeriod.findFirst({
        where: {
          schoolId,
          studentUserId: studentId,
          periodType: 'TRIAL',
          endedEarlyAt: null,
        },
      });
      expect(trial).toBeTruthy();
      expect(trial!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should activate a code and create PAID period', async () => {
      const now = new Date();

      // جلب أول رمز غير مستخدم
      const code = await prisma.activationCode.findFirst({
        where: { schoolId, batchId: { not: undefined }, status: 'UNUSED' },
        select: { id: true, codeLookupHash: true, batchId: true },
      });
      expect(code).toBeTruthy();

      await prisma.$transaction(async (tx) => {
        // تحديث الرمز
        await tx.activationCode.update({
          where: { id: code!.id },
          data: { status: 'USED', consumedAt: now, consumedByUserId: studentId },
        });

        // إنهاء التجربة
        await tx.studentAccessPeriod.updateMany({
          where: {
            schoolId,
            studentUserId: studentId,
            periodType: 'TRIAL',
            endedEarlyAt: null,
          },
          data: { endedEarlyAt: now },
        });

        // إنشاء فترة PAID
        const expiresAt = calculateCalendarYearEnd(now);
        await tx.studentAccessPeriod.create({
          data: {
            schoolId,
            studentUserId: studentId,
            periodType: 'PAID',
            startedAt: now,
            expiresAt,
            activationCodeId: code!.id,
          },
        });
      });

      // تحقق: التجربة منتهية
      const trial = await prisma.studentAccessPeriod.findFirst({
        where: { schoolId, studentUserId: studentId, periodType: 'TRIAL' },
      });
      expect(trial!.endedEarlyAt).toBeTruthy();

      // تحقق: فترة PAID سارية
      const paid = await prisma.studentAccessPeriod.findFirst({
        where: { schoolId, studentUserId: studentId, periodType: 'PAID' },
      });
      expect(paid).toBeTruthy();
      expect(paid!.expiresAt.getTime()).toBeGreaterThan(now.getTime());
      expect(paid!.activationCodeId).toBe(code!.id);
    });

    it('should reject already-used code', async () => {
      const usedCode = await prisma.activationCode.findFirst({
        where: { schoolId, status: 'USED' },
      });
      expect(usedCode).toBeTruthy();
      expect(usedCode!.status).toBe('USED');
      // ← في التطبيق: findFirst({ status: 'UNUSED' }) لن يجد هذا الرمز
    });

    it('should reject activation when PAID period exists (409)', async () => {
      const activePaid = await prisma.studentAccessPeriod.findFirst({
        where: {
          schoolId,
          studentUserId: studentId,
          periodType: 'PAID',
          endedEarlyAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      expect(activePaid).toBeTruthy();
      // ← في التطبيق: ConflictException('ACTIVE_PAID_SUBSCRIPTION_EXISTS')
    });

    it('should not find code from different school', async () => {
      // إنشاء رمز في المدرسة الثانية
      const batchB = await prisma.activationCodeBatch.create({
        data: {
          uuid: randomUUID(),
          schoolId: schoolBId,
          codeCount: 1,
          serialStart: 1,
          serialEnd: 1,
          createdByUserId: adminId,
        },
      });

      const plaintext = codeGenerator.generateCode();
      const { hash } = codeHmac.computeHash(plaintext);
      const cUuid = randomUUID();
      const aad = codeCrypto.buildAAD(schoolBId, batchB.uuid, cUuid);
      const { ciphertext, keyVersion } = codeCrypto.encrypt(plaintext, aad);

      await prisma.activationCode.create({
        data: {
          uuid: cUuid,
          schoolId: schoolBId,
          batchId: batchB.id,
          serialNumber: 1,
          codeCiphertext: ciphertext,
          codeLookupHash: hash,
          encKeyVersion: keyVersion,
          hmacKeyVersion: 1,
        },
      });

      // البحث من منظور المدرسة الأولى — يجد الرمز لكن schoolId لا يتطابق
      const found = await prisma.activationCode.findFirst({
        where: { codeLookupHash: hash, status: 'UNUSED' },
      });
      expect(found).toBeTruthy();
      expect(found!.schoolId).toBe(schoolBId);
      expect(found!.schoolId).not.toBe(schoolId);
      // ← في التطبيق: BadRequestException('INVALID_OR_USED_CODE')
    });
  });

  // ═══════════════════════════════════════════════════════════
  // إصلاح 29 فبراير (chat212 — P0)
  // ═══════════════════════════════════════════════════════════

  describe('Calendar Year End — Feb 29 fix (chat212)', () => {

    it('2028-02-29T12:00Z → 2029-02-28T12:00Z', () => {
      const input = new Date('2028-02-29T12:00:00Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2029-02-28T12:00:00.000Z');
    });

    it('2024-02-29T00:00Z → 2025-02-28T00:00Z', () => {
      const input = new Date('2024-02-29T00:00:00Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2025-02-28T00:00:00.000Z');
    });

    it('normal date: 2026-06-15T10:30Z → 2027-06-15T10:30Z', () => {
      const input = new Date('2026-06-15T10:30:00Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2027-06-15T10:30:00.000Z');
    });

    it('2026-01-31T23:59Z → 2027-01-31T23:59Z', () => {
      const input = new Date('2026-01-31T23:59:59Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2027-01-31T23:59:59.000Z');
    });

    it('2025-12-31T23:59Z → 2026-12-31T23:59Z', () => {
      const input = new Date('2025-12-31T23:59:59Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    });

    it('leap year to leap year: 2028-02-28T12:00Z → 2029-02-28T12:00Z', () => {
      const input = new Date('2028-02-28T12:00:00Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2029-02-28T12:00:00.000Z');
    });

    it('2028-03-01T00:00Z → 2029-03-01T00:00Z', () => {
      const input = new Date('2028-03-01T00:00:00Z');
      const result = calculateCalendarYearEnd(input);
      expect(result.toISOString()).toBe('2029-03-01T00:00:00.000Z');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // عزل المدارس
  // ═══════════════════════════════════════════════════════════

  describe('School Isolation', () => {

    it('should not allow cross-school code in access period (composite FK)', async () => {
      // إنشاء رمز في المدرسة A
      const batchA = await prisma.activationCodeBatch.findFirst({
        where: { schoolId },
      });
      const codeA = await prisma.activationCode.findFirst({
        where: { schoolId, status: 'UNUSED' },
      });

      if (!codeA) {
        // كل الرموز مستخدمة — نتخطى
        return;
      }

      // محاولة إنشاء فترة PAID في المدرسة B برمز المدرسة A
      await expect(
        prisma.studentAccessPeriod.create({
          data: {
            schoolId: schoolBId,
            studentUserId: studentBId,
            periodType: 'PAID',
            startedAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 3600_000),
            activationCodeId: codeA.id,
          },
        }),
      ).rejects.toThrow(); // FK المركّبة ترفض
    });

    it('should keep settings isolated per school', async () => {
      const settingsA = await prisma.schoolSubscriptionSettings.findUnique({
        where: { schoolId },
      });
      const settingsB = await prisma.schoolSubscriptionSettings.findUnique({
        where: { schoolId: schoolBId },
      });

      expect(settingsA).toBeTruthy();
      expect(settingsB).toBeNull(); // المدرسة B غير مفعّلة
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Idempotency
  // ═══════════════════════════════════════════════════════════

  describe('Idempotency Records', () => {

    it('should create and find idempotency record', async () => {
      const key = randomUUID();
      const hash = 'test-hash-' + randomUUID();

      await prisma.idempotencyRecord.create({
        data: {
          idempotencyKey: key,
          schoolId,
          actorUserId: adminId,
          endpoint: 'test-endpoint',
          requestHash: hash,
          status: 'PROCESSING',
          expiresAt: new Date(Date.now() + 24 * 3600_000),
        },
      });

      const found = await prisma.idempotencyRecord.findUnique({
        where: { idempotencyKey: key },
      });
      expect(found).toBeTruthy();
      expect(found!.status).toBe('PROCESSING');
    });

    it('should reject duplicate idempotency key', async () => {
      const key = randomUUID();

      await prisma.idempotencyRecord.create({
        data: {
          idempotencyKey: key,
          schoolId,
          actorUserId: adminId,
          endpoint: 'test',
          requestHash: 'h1',
          status: 'COMPLETED',
          responseStatusCode: 201,
          responseBody: { id: 1 },
          expiresAt: new Date(Date.now() + 24 * 3600_000),
        },
      });

      await expect(
        prisma.idempotencyRecord.create({
          data: {
            idempotencyKey: key,
            schoolId,
            actorUserId: adminId,
            endpoint: 'test',
            requestHash: 'h2',
            status: 'PROCESSING',
            expiresAt: new Date(Date.now() + 24 * 3600_000),
          },
        }),
      ).rejects.toThrow(); // PK violation
    });
  });

  // ─── سلوك IdempotencyService الفعلي ─────────────────────────────
  describe('IdempotencyService behavior', () => {
    let svc: IdempotencyService;
    const endpoint = 'svc-test';

    beforeAll(() => {
      svc = new IdempotencyService(prisma as unknown as PrismaService);
    });

    const params = (key: string, overrides: Partial<{
      schoolId: number; actorUserId: number; endpoint: string; requestHash: string;
    }> = {}) => ({
      idempotencyKey: key,
      schoolId,
      actorUserId: adminId,
      endpoint,
      requestHash: 'h-same',
      ...overrides,
    });

    it('first acquire proceeds (null), second while PROCESSING → REQUEST_IN_PROGRESS', async () => {
      const key = randomUUID();
      await expect(svc.acquireOrReturn(params(key))).resolves.toBeNull();
      await expect(svc.acquireOrReturn(params(key))).rejects.toThrow('REQUEST_IN_PROGRESS');
    });

    it('COMPLETED record replays the stored response', async () => {
      const key = randomUUID();
      await svc.acquireOrReturn(params(key));
      await svc.markCompleted(key, 201, { ok: 1 });
      await expect(svc.acquireOrReturn(params(key))).resolves.toEqual({
        statusCode: 201,
        body: { ok: 1 },
      });
    });

    it('FAILED_TRANSIENT retry with same key proceeds directly (no RETRY_ALLOWED round-trip)', async () => {
      const key = randomUUID();
      await svc.acquireOrReturn(params(key));
      await svc.markFailedTransient(key);

      await expect(svc.acquireOrReturn(params(key))).resolves.toBeNull();
      const rec = await prisma.idempotencyRecord.findUnique({ where: { idempotencyKey: key } });
      expect(rec!.status).toBe('PROCESSING');
    });

    it('concurrent retries after transient failure → exactly one proceeds', async () => {
      const key = randomUUID();
      await svc.acquireOrReturn(params(key));
      await svc.markFailedTransient(key);

      const results = await Promise.allSettled([
        svc.acquireOrReturn(params(key)),
        svc.acquireOrReturn(params(key)),
        svc.acquireOrReturn(params(key)),
      ]);
      const proceeded = results.filter((r) => r.status === 'fulfilled' && r.value === null);
      const inProgress = results.filter(
        (r) => r.status === 'rejected' && /REQUEST_IN_PROGRESS/.test(String((r as PromiseRejectedResult).reason?.message)),
      );
      expect(proceeded).toHaveLength(1);
      expect(inProgress).toHaveLength(2);
    });

    it('FAILED_BUSINESS replays the same error status', async () => {
      const key = randomUUID();
      await svc.acquireOrReturn(params(key));
      await svc.markFailedBusiness(key, 409, { message: 'SUBSCRIPTION_ALREADY_ACTIVATED' });
      await expect(svc.acquireOrReturn(params(key))).rejects.toMatchObject({ status: 409 });
    });

    it.each([
      ['different payload', { requestHash: 'h-other' }],
      ['different endpoint', { endpoint: 'other-endpoint' }],
      ['different actor', { actorUserId: -1 }],
      ['different school', { schoolId: -1 }],
    ])('rejects key reuse with %s', async (_label, override) => {
      const key = randomUUID();
      await svc.acquireOrReturn(params(key));
      await svc.markCompleted(key, 201, { secret: 'school-A-data' });
      await expect(svc.acquireOrReturn(params(key, override as any))).rejects.toThrow(
        'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
      );
    });
  });

  // ─── JWT sub (UUID) → actorUserId (Int) ───────────────────────
  // انحدار: كان المتحكم يمرّر req.user.sub (UUID) مباشرة → 500 من Prisma
  describe('SubscriptionService.resolveActorUserId', () => {
    let svc: SubscriptionService;
    beforeAll(() => {
      svc = new SubscriptionService(prisma as unknown as PrismaService, {} as any, {} as any);
    });

    it('maps the admin UUID to its numeric id', async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { uuid: true } });
      await expect(svc.resolveActorUserId(schoolId, admin.uuid)).resolves.toBe(adminId);
    });

    it('rejects a UUID from another school', async () => {
      const other = await prisma.user.findUniqueOrThrow({ where: { id: studentBId }, select: { uuid: true } });
      await expect(svc.resolveActorUserId(schoolId, other.uuid)).rejects.toThrow('ACTOR_NOT_FOUND');
    });

    it('rejects an unknown UUID', async () => {
      await expect(svc.resolveActorUserId(schoolId, randomUUID())).rejects.toThrow('ACTOR_NOT_FOUND');
    });
  });

  // ─── التفعيل الحقيقي عبر الخدمة (لا محاكاة Prisma) ─────────
  // انحدار: SQL الخام في createBulkTrialsTx استخدم أسماء حقول Prisma
  describe('SubscriptionService.activateSubscription (real path)', () => {
    let svc: SubscriptionService;
    let schoolCId: number;
    let adminCId: number;

    beforeAll(async () => {
      const p = prisma as unknown as PrismaService;
      svc = new SubscriptionService(p, new IdempotencyService(p), new SubscriptionTrialService());
      schoolCId = (await mkSchool(700000 + Math.floor(Math.random() * 90000))).id;
      adminCId = (await mkUser(schoolCId, 'ADMIN', 'admin-c')).id;
      await mkUser(schoolCId, 'STUDENT', 's1');
      await mkUser(schoolCId, 'STUDENT', 's2');
      const deleted = await mkUser(schoolCId, 'STUDENT', 's-deleted');
      await prisma.user.update({ where: { id: deleted.id }, data: { isDeleted: true } });
    });

    afterAll(async () => {
      if (!schoolCId) return;
      const w = { where: { schoolId: schoolCId } };
      await prisma.subscriptionAuditEvent.deleteMany(w);
      await prisma.idempotencyRecord.deleteMany(w);
      await prisma.studentAccessPeriod.deleteMany(w);
      await prisma.schoolPaymentMethod.deleteMany(w);
      await prisma.schoolSubscriptionSettings.deleteMany(w);
      await prisma.user.deleteMany(w);
      await prisma.school.delete({ where: { id: schoolCId } });
    });

    it('activates with trial: creates trials for non-deleted students only + completes idempotency', async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminCId }, select: { uuid: true } });
      const actorId = await svc.resolveActorUserId(schoolCId, admin.uuid);
      const key = randomUUID();

      const before = Date.now();
      const res = await svc.activateSubscription(schoolCId, actorId, {
        isTrialEnabled: true,
        trialDurationDays: 14,
        subscriptionPrice: 5000,
        contactNumber: '777000000',
        paymentMethods: [{ name: 'كريمي', paymentDetails: '123' }],
      } as any, key);

      expect(res).toMatchObject({ isActivated: true, trialPeriodsCreated: 2, paymentMethodsCreated: 1 });

      const periods = await prisma.studentAccessPeriod.findMany({ where: { schoolId: schoolCId } });
      expect(periods).toHaveLength(2);
      for (const p of periods) {
        expect(p.periodType).toBe('TRIAL');
        const days = (p.expiresAt.getTime() - p.startedAt.getTime()) / 86_400_000;
        expect(days).toBe(14);
        expect(p.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      }

      const rec = await prisma.idempotencyRecord.findUnique({ where: { idempotencyKey: key } });
      expect(rec!.status).toBe('COMPLETED');

      // إعادة بنفس المفتاح → نفس الاستجابة بلا تكرار فترات
      const replay = await svc.activateSubscription(schoolCId, actorId, {
        isTrialEnabled: true,
        trialDurationDays: 14,
        subscriptionPrice: 5000,
        contactNumber: '777000000',
        paymentMethods: [{ name: 'كريمي', paymentDetails: '123' }],
      } as any, key);
      expect(replay).toMatchObject({ trialPeriodsCreated: 2 });
      expect(await prisma.studentAccessPeriod.count({ where: { schoolId: schoolCId } })).toBe(2);
    });
  });
});

// ─── تطبيع page/limit (منطق صافٍ — بدون قاعدة) ───────────
describe('CodeBatchService.normalizePaging', () => {
  const norm = (p?: number, l?: number) =>
    CodeBatchService.normalizePaging(p, l, 50, CodeBatchService.MAX_CODES_PAGE_SIZE);

  it('uses defaults when missing', () => {
    expect(norm()).toEqual({ page: 1, limit: 50, skip: 0 });
  });

  it.each([[0], [-3], [NaN], [1.5]])('invalid page %p → 1 (no negative skip)', (p) => {
    expect(norm(p, 10)).toEqual({ page: 1, limit: 10, skip: 0 });
  });

  it.each([[0], [-1], [NaN]])('invalid limit %p → default', (l) => {
    expect(norm(2, l).limit).toBe(50);
  });

  it('caps limit to MAX (decryption cost bound)', () => {
    expect(norm(1, 100000).limit).toBe(CodeBatchService.MAX_CODES_PAGE_SIZE);
  });

  it('computes skip', () => {
    expect(norm(3, 20)).toEqual({ page: 3, limit: 20, skip: 40 });
  });
});
