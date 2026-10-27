/**
 * SUB-IMPLEMENTATION-PLAN v1.1 — اختبارات الدفعات الكبيرة والتزامن
 *
 * يختبر:
 * - إنشاء 1000 رمز في معاملة واحدة
 * - عدم تكرار HMAC أو الأرقام التسلسلية
 * - طلبان متزامنان (1000+1000) لنفس المدرسة → نطاقان متتاليان
 *
 * يعمل على قاعدة اختبارية فقط:
 *   SUB_TEST_DATABASE_URL=postgresql://.../asas_sub_test npm run test:e2e -- subscription-stress
 */
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { CodeGeneratorService } from '../../src/school/manager/subscription/crypto/code-generator.service';
import { CodeCryptoService } from '../../src/school/manager/subscription/crypto/code-crypto.service';
import { CodeHmacService } from '../../src/school/manager/subscription/crypto/code-hmac.service';

// مفاتيح اختبار فقط — ليست إنتاجية
process.env.ACTIVATION_CODE_ENC_KEY_V1 = 'EGmxwf7Hw4YeOXiZk9dHSpSJjhJzw84T7NQaYSJiMWI=';
process.env.ACTIVATION_CODE_HMAC_KEY_V1 = 'akB+Rxs2Jg0DeP0XlaTcFXs7jYATkxH2y7b8Z7iVMas=';

const TEST_URL = process.env.SUB_TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('Subscription Stress Tests — Large Batches & Concurrency', () => {
  let prisma: PrismaClient;
  let codeGenerator: CodeGeneratorService;
  let codeCrypto: CodeCryptoService;
  let codeHmac: CodeHmacService;

  let schoolId: number;
  let adminId: number;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    codeGenerator = new CodeGeneratorService();
    codeCrypto = new CodeCryptoService();
    codeHmac = new CodeHmacService();

    const base = 700000 + Math.floor(Math.random() * 90000);
    const school = await prisma.school.create({
      data: { name: `STRESS-TEST-${base}`, schoolCode: base, appType: 'PRIVATE' },
    });
    schoolId = school.id;
    const admin = await prisma.user.create({
      data: { schoolId, userType: 'ADMIN', name: 'stress-admin', passwordHash: 'x', isActive: true },
    });
    adminId = admin.id;

    // تفعيل الاشتراك
    await prisma.schoolSubscriptionSettings.create({
      data: {
        schoolId,
        isActivated: true,
        activatedAt: new Date(),
        isTrialEnabled: true,
        trialDurationDays: 14,
        subscriptionPrice: new Prisma.Decimal('30000'),
        contactNumber: '+967770000000',
        nextCodeSerial: 1,
      },
    });
  }, 30000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.subscriptionAuditEvent.deleteMany({ where: { schoolId } });
    await prisma.idempotencyRecord.deleteMany({ where: { schoolId } });
    await prisma.studentAccessPeriod.deleteMany({ where: { schoolId } });
    await prisma.activationCode.deleteMany({ where: { schoolId } });
    await prisma.activationCodeBatch.deleteMany({ where: { schoolId } });
    await prisma.schoolPaymentMethod.deleteMany({ where: { schoolId } });
    await prisma.schoolSubscriptionSettings.deleteMany({ where: { schoolId } });
    await prisma.user.deleteMany({ where: { schoolId } });
    await prisma.school.deleteMany({ where: { id: schoolId } });
    await prisma.$disconnect();
  }, 30000);

  /**
   * دالة مساعدة — تحاكي CodeBatchService.createBatch
   * (مباشرة على Prisma بدون NestJS DI لأننا في E2E)
   */
  async function createBatchDirect(codeCount: number): Promise<{
    batchId: number;
    batchUuid: string;
    serialStart: number;
    serialEnd: number;
    hashes: string[];
    durationMs: number;
  }> {
    const start = Date.now();

    return prisma.$transaction(async (tx) => {
      // 1. قفل + قراءة serial
      const settings = await tx.$queryRaw<Array<{
        next_code_serial: number;
        is_activated: boolean;
      }>>`
        SELECT next_code_serial, is_activated
        FROM "school_subscription_settings"
        WHERE school_id = ${schoolId}
        FOR UPDATE
      `;

      if (!settings.length || !settings[0].is_activated) {
        throw new Error('NOT_ACTIVATED');
      }

      const serialStart = settings[0].next_code_serial;
      const serialEnd = serialStart + codeCount - 1;

      // 2. تحديث serial
      await tx.schoolSubscriptionSettings.update({
        where: { schoolId },
        data: { nextCodeSerial: serialStart + codeCount },
      });

      // 3. توليد رموز
      const batchUuid = randomUUID();
      const codesData: Array<{
        uuid: string;
        schoolId: number;
        batchId: number;
        serialNumber: number;
        codeCiphertext: Buffer;
        codeLookupHash: string;
        encKeyVersion: number;
        hmacKeyVersion: number;
      }> = [];
      const hashes: string[] = [];

      for (let i = 0; i < codeCount; i++) {
        const cUuid = randomUUID();
        const plaintext = codeGenerator.generateCode();
        const { hash, keyVersion: hmacVer } = codeHmac.computeHash(plaintext);
        const aad = codeCrypto.buildAAD(schoolId, batchUuid, cUuid);
        const { ciphertext, keyVersion: encVer } = codeCrypto.encrypt(plaintext, aad);

        codesData.push({
          uuid: cUuid,
          schoolId,
          batchId: 0,
          serialNumber: serialStart + i,
          codeCiphertext: ciphertext,
          codeLookupHash: hash,
          encKeyVersion: encVer,
          hmacKeyVersion: hmacVer,
        });
        hashes.push(hash);
      }

      // 4. إنشاء الدفعة
      const batch = await tx.activationCodeBatch.create({
        data: {
          uuid: batchUuid,
          schoolId,
          codeCount,
          serialStart,
          serialEnd,
          createdByUserId: adminId,
        },
      });

      // 5. إنشاء الرموز
      await tx.activationCode.createMany({
        data: codesData.map((c) => ({
          uuid: c.uuid,
          schoolId: c.schoolId,
          batchId: batch.id,
          serialNumber: c.serialNumber,
          codeCiphertext: c.codeCiphertext,
          codeLookupHash: c.codeLookupHash,
          encKeyVersion: c.encKeyVersion,
          hmacKeyVersion: c.hmacKeyVersion,
        })),
      });

      const durationMs = Date.now() - start;

      return {
        batchId: batch.id,
        batchUuid,
        serialStart,
        serialEnd,
        hashes,
        durationMs,
      };
    }, { timeout: 60_000 });
  }

  // ═══════════════════════════════════════════════════════════
  // اختبار 1: دفعة 1000 رمز
  // ═══════════════════════════════════════════════════════════

  it('should create a batch of 1000 codes within 5 seconds', async () => {
    const result = await createBatchDirect(1000);

    expect(result.serialEnd - result.serialStart + 1).toBe(1000);

    // تحقق من العدد الفعلي
    const count = await prisma.activationCode.count({
      where: { batchId: result.batchId, schoolId },
    });
    expect(count).toBe(1000);

    // هدف الأداء: < 5 ثوانٍ
    console.log(`  ⏱ Batch of 1000 codes created in ${result.durationMs}ms`);
    expect(result.durationMs).toBeLessThan(5000);
  }, 15000);

  // ═══════════════════════════════════════════════════════════
  // اختبار 2: لا تكرار في HMAC
  // ═══════════════════════════════════════════════════════════

  it('should have 1000 unique HMAC hashes (no collisions)', async () => {
    const hashes = await prisma.activationCode.findMany({
      where: { schoolId },
      select: { codeLookupHash: true },
    });

    const uniqueHashes = new Set(hashes.map(h => h.codeLookupHash));
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  // ═══════════════════════════════════════════════════════════
  // اختبار 3: لا تكرار في الأرقام التسلسلية
  // ═══════════════════════════════════════════════════════════

  it('should have unique serial numbers across all codes', async () => {
    const serials = await prisma.activationCode.findMany({
      where: { schoolId },
      select: { serialNumber: true },
    });

    const uniqueSerials = new Set(serials.map(s => s.serialNumber));
    expect(uniqueSerials.size).toBe(serials.length);
  });

  // ═══════════════════════════════════════════════════════════
  // اختبار 4: طلبان متزامنان — نطاقان متتاليان
  // ═══════════════════════════════════════════════════════════

  it('should handle concurrent batch creation with non-overlapping serial ranges', async () => {
    // أعد ضبط nextCodeSerial لتبدأ من 2001
    await prisma.schoolSubscriptionSettings.update({
      where: { schoolId },
      data: { nextCodeSerial: 2001 },
    });

    const batchSize = 100; // أصغر للسرعة

    // إطلاق طلبين متزامنين
    const [resultA, resultB] = await Promise.all([
      createBatchDirect(batchSize),
      createBatchDirect(batchSize),
    ]);

    console.log(`  ⏱ Concurrent batch A: ${resultA.durationMs}ms (serial ${resultA.serialStart}-${resultA.serialEnd})`);
    console.log(`  ⏱ Concurrent batch B: ${resultB.durationMs}ms (serial ${resultB.serialStart}-${resultB.serialEnd})`);

    // النطاقان لا يتداخلان
    const rangeA = new Set<number>();
    for (let i = resultA.serialStart; i <= resultA.serialEnd; i++) rangeA.add(i);

    for (let i = resultB.serialStart; i <= resultB.serialEnd; i++) {
      expect(rangeA.has(i)).toBe(false); // لا تداخل
    }

    // كلاهما 100 رمز
    expect(resultA.serialEnd - resultA.serialStart + 1).toBe(batchSize);
    expect(resultB.serialEnd - resultB.serialStart + 1).toBe(batchSize);

    // النطاقان متتاليان (أحدهما يبدأ حيث ينتهي الآخر)
    const starts = [resultA.serialStart, resultB.serialStart].sort((a, b) => a - b);
    const ends = [resultA.serialEnd, resultB.serialEnd].sort((a, b) => a - b);
    expect(starts[1]).toBe(ends[0] + 1);

    // لا تكرار في HMAC عبر الدفعتين
    const allHashes = [...resultA.hashes, ...resultB.hashes];
    const uniqueHashes = new Set(allHashes);
    expect(uniqueHashes.size).toBe(allHashes.length);
  }, 30000);

  // ═══════════════════════════════════════════════════════════
  // اختبار 5: فك التشفير لعينة من الدفعة الكبيرة
  // ═══════════════════════════════════════════════════════════

  it('should decrypt a sample of codes from the large batch', async () => {
    const batch = await prisma.activationCodeBatch.findFirst({
      where: { schoolId, codeCount: 1000 },
      select: { id: true, uuid: true },
    });
    expect(batch).toBeTruthy();

    // عينة من 10 رموز
    const sample = await prisma.activationCode.findMany({
      where: { batchId: batch!.id, schoolId, status: 'UNUSED' },
      take: 10,
      select: { uuid: true, codeCiphertext: true, encKeyVersion: true },
    });

    for (const code of sample) {
      const aad = codeCrypto.buildAAD(schoolId, batch!.uuid, code.uuid);
      const plaintext = codeCrypto.decrypt(
        Buffer.from(code.codeCiphertext),
        aad,
        code.encKeyVersion,
      );
      expect(plaintext).toHaveLength(12);
      expect(plaintext).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    }
  });
});
