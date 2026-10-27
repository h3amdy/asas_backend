/**
 * SUB-IMPLEMENTATION-PLAN v1.1 — المرحلة 1 §1.6
 * اختبار قيود قاعدة بيانات نظام الاشتراكات (CHECK + FK مركّبة + RESTRICT)
 *
 * يعمل على قاعدة اختبارية قابلة للإتلاف فقط:
 *   SUB_TEST_DATABASE_URL=postgresql://.../asas_sub_test npm run test:e2e -- schema-constraints
 * بدون المتغير → يُتخطى (حماية من التشغيل على قاعدة التطوير).
 */
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const TEST_URL = process.env.SUB_TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('Subscription schema constraints (Phase 1)', () => {
  let prisma: PrismaClient;
  let schoolA: number;
  let schoolB: number;
  let adminA: number;
  let studentA: number;
  let studentB: number;
  let batchA: number;
  let batchB: number;
  let serial = 1;

  /** يتوقع رفض قاعدة البيانات مع اسم القيد المذكور */
  const expectViolation = async (op: Promise<unknown>, constraint: string) => {
    await expect(op).rejects.toThrow(new RegExp(constraint));
  };

  const rawInsertCode = (opts: {
    schoolId: number;
    batchId: number;
    status?: 'UNUSED' | 'USED';
    consumedAt?: Date | null;
    consumedBy?: number | null;
  }) => {
    const s = serial++;
    return prisma.$executeRaw`
      INSERT INTO activation_codes
        (uuid, school_id, batch_id, serial_number, code_ciphertext, code_lookup_hash,
         enc_key_version, hmac_key_version, status, consumed_at, consumed_by_user_id)
      VALUES
        (${randomUUID()}::uuid, ${opts.schoolId}, ${opts.batchId}, ${s}, ${Buffer.from('x')},
         ${'h-' + randomUUID()}, 1, 1, ${opts.status ?? 'UNUSED'}::"ActivationCodeStatus",
         ${opts.consumedAt ?? null}, ${opts.consumedBy ?? null})`;
  };

  const createCode = (schoolId: number, batchId: number) =>
    prisma.activationCode.create({
      data: {
        uuid: randomUUID(),
        schoolId,
        batchId,
        serialNumber: serial++,
        codeCiphertext: Buffer.from('x'),
        codeLookupHash: 'h-' + randomUUID(),
        encKeyVersion: 1,
        hmacKeyVersion: 1,
      },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
    await prisma.$connect();

    const mkSchool = (code: number) =>
      prisma.school.create({
        data: { name: `SUB-TEST-${code}`, schoolCode: code, appType: 'PRIVATE' },
      });
    const mkUser = (schoolId: number, userType: 'ADMIN' | 'STUDENT', name: string) =>
      prisma.user.create({
        data: { schoolId, userType, name, passwordHash: 'x', isActive: true },
      });

    const base = 900000 + Math.floor(Math.random() * 90000);
    schoolA = (await mkSchool(base)).id;
    schoolB = (await mkSchool(base + 1)).id;
    adminA = (await mkUser(schoolA, 'ADMIN', 'admin-a')).id;
    studentA = (await mkUser(schoolA, 'STUDENT', 'student-a')).id;
    studentB = (await mkUser(schoolB, 'STUDENT', 'student-b')).id;

    const mkBatch = (schoolId: number) =>
      prisma.activationCodeBatch.create({
        data: {
          uuid: randomUUID(),
          schoolId,
          codeCount: 1000,
          serialStart: 1,
          serialEnd: 1000,
          createdByUserId: adminA,
        },
      });
    batchA = (await mkBatch(schoolA)).id;
    batchB = (await mkBatch(schoolB)).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const ids = [schoolA, schoolB].filter(Boolean);
    await prisma.studentAccessPeriod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.activationCode.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.activationCodeBatch.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolPaymentMethod.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.schoolSubscriptionSettings.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.user.deleteMany({ where: { schoolId: { in: ids } } });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // ─── school_subscription_settings ───────────────────────────

  describe('school_subscription_settings', () => {
    afterEach(() =>
      prisma.schoolSubscriptionSettings.deleteMany({ where: { schoolId: schoolA } }),
    );

    it('accepts a fully configured activated row', async () => {
      await expect(
        prisma.schoolSubscriptionSettings.create({
          data: {
            schoolId: schoolA,
            isActivated: true,
            activatedAt: new Date(),
            isTrialEnabled: true,
            trialDurationDays: 14,
            subscriptionPrice: new Prisma.Decimal('30000'),
            contactNumber: '+967770000000',
          },
        }),
      ).resolves.toBeDefined();
    });

    it('rejects activation without price/contact/activated_at', async () => {
      await expectViolation(
        prisma.schoolSubscriptionSettings.create({
          data: { schoolId: schoolA, isActivated: true, isTrialEnabled: false },
        }),
        'sss_activated_requires_fields_chk',
      );
    });

    it.each([null, 0, 91])('rejects trial enabled with duration=%p', async (days) => {
      await expectViolation(
        prisma.schoolSubscriptionSettings.create({
          data: { schoolId: schoolA, isTrialEnabled: true, trialDurationDays: days },
        }),
        'sss_trial_duration_chk',
      );
    });

    it('rejects non-positive price', async () => {
      await expectViolation(
        prisma.schoolSubscriptionSettings.create({
          data: {
            schoolId: schoolA,
            isTrialEnabled: false,
            subscriptionPrice: new Prisma.Decimal('0'),
          },
        }),
        'sss_price_positive_chk',
      );
    });

    it('rejects a second settings row for the same school', async () => {
      await prisma.schoolSubscriptionSettings.create({
        data: { schoolId: schoolA, isTrialEnabled: false },
      });
      await expect(
        prisma.schoolSubscriptionSettings.create({
          data: { schoolId: schoolA, isTrialEnabled: false },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // ─── activation_code_batches ────────────────────────────────

  describe('activation_code_batches', () => {
    const mk = (codeCount: number, serialStart: number, serialEnd: number) =>
      prisma.activationCodeBatch.create({
        data: {
          uuid: randomUUID(),
          schoolId: schoolA,
          codeCount,
          serialStart,
          serialEnd,
          createdByUserId: adminA,
        },
      });

    it.each([0, 1001])('rejects code_count=%p', async (n) => {
      await expectViolation(mk(n, 1, n), 'acb_count_range_chk');
    });

    it('rejects inconsistent serial range', async () => {
      await expectViolation(mk(10, 1, 11), 'acb_serial_range_chk');
    });
  });

  // ─── activation_codes ───────────────────────────────────────

  describe('activation_codes', () => {
    it('rejects USED without consumer fields', async () => {
      await expectViolation(
        rawInsertCode({ schoolId: schoolA, batchId: batchA, status: 'USED' }),
        'ac_status_consumer_chk',
      );
    });

    it('rejects UNUSED with consumer fields', async () => {
      await expectViolation(
        rawInsertCode({
          schoolId: schoolA,
          batchId: batchA,
          status: 'UNUSED',
          consumedAt: new Date(),
          consumedBy: studentA,
        }),
        'ac_status_consumer_chk',
      );
    });

    it('rejects a code in a batch of another school (composite FK)', async () => {
      await expectViolation(createCode(schoolA, batchB), 'activation_codes_batch_id_school_id_fkey');
    });

    it('rejects duplicate serial within the same school', async () => {
      const c = await createCode(schoolA, batchA);
      await expect(
        prisma.activationCode.create({
          data: {
            uuid: randomUUID(),
            schoolId: schoolA,
            batchId: batchA,
            serialNumber: c.serialNumber,
            codeCiphertext: Buffer.from('x'),
            codeLookupHash: 'h-' + randomUUID(),
            encKeyVersion: 1,
            hmacKeyVersion: 1,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // ─── student_access_periods ─────────────────────────────────

  describe('student_access_periods', () => {
    const now = new Date();
    const later = new Date(now.getTime() + 86_400_000);

    it('rejects TRIAL with a code and PAID without a code', async () => {
      const code = await createCode(schoolA, batchA);
      await expectViolation(
        prisma.studentAccessPeriod.create({
          data: {
            schoolId: schoolA,
            studentUserId: studentA,
            periodType: 'TRIAL',
            startedAt: now,
            expiresAt: later,
            activationCodeId: code.id,
          },
        }),
        'sap_type_code_chk',
      );
      await expectViolation(
        prisma.studentAccessPeriod.create({
          data: {
            schoolId: schoolA,
            studentUserId: studentA,
            periodType: 'PAID',
            startedAt: now,
            expiresAt: later,
          },
        }),
        'sap_type_code_chk',
      );
    });

    it('rejects expires_at <= started_at', async () => {
      await expectViolation(
        prisma.studentAccessPeriod.create({
          data: {
            schoolId: schoolA,
            studentUserId: studentA,
            periodType: 'TRIAL',
            startedAt: now,
            expiresAt: now,
          },
        }),
        'sap_expires_after_start_chk',
      );
    });

    it('rejects a PAID period using a code of another school (composite FK)', async () => {
      const codeB = await createCode(schoolB, batchB);
      await expectViolation(
        prisma.studentAccessPeriod.create({
          data: {
            schoolId: schoolA,
            studentUserId: studentA,
            periodType: 'PAID',
            startedAt: now,
            expiresAt: later,
            activationCodeId: codeB.id,
          },
        }),
        'student_access_periods_activation_code_id_school_id_fkey',
      );
    });

    it('rejects using the same code for two periods', async () => {
      const code = await createCode(schoolB, batchB);
      const data = {
        schoolId: schoolB,
        studentUserId: studentB,
        periodType: 'PAID' as const,
        startedAt: now,
        expiresAt: later,
        activationCodeId: code.id,
      };
      await prisma.studentAccessPeriod.create({ data });
      await expect(prisma.studentAccessPeriod.create({ data })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  // ─── ON DELETE RESTRICT — historical records ────────────────

  describe('ON DELETE RESTRICT protects history', () => {
    it('blocks hard-deleting a student who has an access period', async () => {
      const s = await prisma.user.create({
        data: { schoolId: schoolA, userType: 'STUDENT', name: 'tmp', passwordHash: 'x', isActive: true },
      });
      await prisma.studentAccessPeriod.create({
        data: {
          schoolId: schoolA,
          studentUserId: s.id,
          periodType: 'TRIAL',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
        },
      });
      await expect(prisma.user.delete({ where: { id: s.id } })).rejects.toBeDefined();
    });

    it('blocks deleting a batch that has codes', async () => {
      await createCode(schoolA, batchA);
      await expect(
        prisma.activationCodeBatch.delete({ where: { id: batchA } }),
      ).rejects.toBeDefined();
    });

    it('blocks deleting a code linked to a period', async () => {
      const code = await createCode(schoolA, batchA);
      await prisma.studentAccessPeriod.create({
        data: {
          schoolId: schoolA,
          studentUserId: studentA,
          periodType: 'PAID',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
          activationCodeId: code.id,
        },
      });
      await expect(prisma.activationCode.delete({ where: { id: code.id } })).rejects.toBeDefined();
    });

    it('blocks deleting a school that has subscription data', async () => {
      await expect(prisma.school.delete({ where: { id: schoolA } })).rejects.toBeDefined();
    });
  });
});
