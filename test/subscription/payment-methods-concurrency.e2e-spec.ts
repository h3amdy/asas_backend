/**
 * اختبارات تزامن طرق الدفع على PostgreSQL فعلي — الإصلاح 3
 *
 * يستدعي SubscriptionService الإنتاجية (createPaymentMethod / deletePaymentMethod)
 * بطلبات متزامنة حقيقية عبر مجمّع اتصالات Prisma.
 *
 *   SUB_TEST_DATABASE_URL=postgresql://.../asas_sub_test npm run test:e2e -- payment-methods-concurrency
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { SubscriptionService } from '../../src/school/manager/subscription/subscription.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const TEST_URL = process.env.SUB_TEST_DATABASE_URL;
const describeIfDb = TEST_URL ? describe : describe.skip;

describeIfDb('Payment methods — real concurrency (FOR UPDATE on settings row)', () => {
  let prisma: PrismaClient;
  let svc: SubscriptionService;
  let schoolId: number;

  const active = () => prisma.schoolPaymentMethod.count({ where: { schoolId, isDeleted: false } });
  const reasons = (rs: PromiseSettledResult<unknown>[]) =>
    rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason?.message));

  beforeAll(async () => {
    // مجمّع اتصالات كافٍ لتنفيذ الطلبات بالتوازي فعلياً
    const url = new URL(TEST_URL!);
    url.searchParams.set('connection_limit', '20');
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await prisma.$connect();
    svc = new SubscriptionService(prisma as unknown as PrismaService, {} as any, {} as any);

    const code = 800000 + Math.floor(Math.random() * 90000);
    const school = await prisma.school.create({
      data: { name: `PM-CONC-${code}`, schoolCode: code, appType: 'PRIVATE' },
    });
    schoolId = school.id;
    await prisma.schoolSubscriptionSettings.create({
      data: {
        schoolId,
        isActivated: true,
        activatedAt: new Date(),
        isTrialEnabled: false,
        trialDurationDays: 7,
        subscriptionPrice: new Prisma.Decimal('1000'),
        contactNumber: '+967770000000',
        nextCodeSerial: 1,
      },
    });
  }, 30000);

  beforeEach(async () => {
    await prisma.schoolPaymentMethod.deleteMany({ where: { schoolId } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.schoolPaymentMethod.deleteMany({ where: { schoolId } });
    await prisma.schoolSubscriptionSettings.deleteMany({ where: { schoolId } });
    await prisma.school.deleteMany({ where: { id: schoolId } });
    await prisma.$disconnect();
  }, 30000);

  it('15 concurrent creates from 0 → exactly 10 active, 5 rejected with MAX_PAYMENT_METHODS_REACHED', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) =>
        svc.createPaymentMethod(schoolId, { name: `m${i}`, paymentDetails: `d${i}` } as any),
      ),
    );
    expect(await active()).toBe(10);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    const errs = reasons(results);
    expect(errs).toHaveLength(5);
    errs.forEach((m) => expect(m).toBe('MAX_PAYMENT_METHODS_REACHED'));
  });

  it('concurrent creates get unique sortOrder values (no duplicates under race)', async () => {
    await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        svc.createPaymentMethod(schoolId, { name: `s${i}`, paymentDetails: 'x' } as any),
      ),
    );
    const rows = await prisma.schoolPaymentMethod.findMany({ where: { schoolId, isDeleted: false } });
    expect(new Set(rows.map((r) => r.sortOrder)).size).toBe(rows.length);
  });

  it('2 methods, delete both concurrently → exactly 1 remains, other gets CANNOT_DELETE_LAST_PAYMENT_METHOD', async () => {
    const a = await svc.createPaymentMethod(schoolId, { name: 'A', paymentDetails: 'a' } as any);
    const b = await svc.createPaymentMethod(schoolId, { name: 'B', paymentDetails: 'b' } as any);

    const results = await Promise.allSettled([
      svc.deletePaymentMethod(schoolId, a.id),
      svc.deletePaymentMethod(schoolId, b.id),
    ]);
    expect(await active()).toBe(1);
    expect(reasons(results)).toEqual(['CANNOT_DELETE_LAST_PAYMENT_METHOD']);
  });

  it('5 methods, delete all 5 concurrently → exactly 1 remains', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await svc.createPaymentMethod(schoolId, { name: `d${i}`, paymentDetails: 'x' } as any)).id);
    }
    const results = await Promise.allSettled(ids.map((id) => svc.deletePaymentMethod(schoolId, id)));
    expect(await active()).toBe(1);
    expect(reasons(results)).toHaveLength(1);
  });

  it('mixed: at 10 methods, concurrent create + delete never exceeds 10 nor drops below 1', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push((await svc.createPaymentMethod(schoolId, { name: `x${i}`, paymentDetails: 'x' } as any)).id);
    }
    await Promise.allSettled([
      ...ids.slice(0, 3).map((id) => svc.deletePaymentMethod(schoolId, id)),
      ...Array.from({ length: 6 }, (_, i) =>
        svc.createPaymentMethod(schoolId, { name: `y${i}`, paymentDetails: 'y' } as any),
      ),
    ]);
    const n = await active();
    expect(n).toBeLessThanOrEqual(10);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('rejects when subscription not activated (lock query sees settings row)', async () => {
    await prisma.schoolSubscriptionSettings.update({ where: { schoolId }, data: { isActivated: false } });
    try {
      await expect(
        svc.createPaymentMethod(schoolId, { name: 'z', paymentDetails: 'z' } as any),
      ).rejects.toThrow('SUBSCRIPTION_NOT_ACTIVATED');
    } finally {
      await prisma.schoolSubscriptionSettings.update({ where: { schoolId }, data: { isActivated: true } });
    }
  });

  it('reorder concurrent with delete: never leaves a deleted id ordered, sortOrders stay unique', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await svc.createPaymentMethod(schoolId, { name: `r${i}`, paymentDetails: 'x' } as any)).id);
    }
    const results = await Promise.allSettled([
      svc.reorderPaymentMethods(schoolId, { orderedIds: [...ids].reverse() } as any),
      svc.deletePaymentMethod(schoolId, ids[0]),
    ]);
    // الحذف ينجح دائماً؛ الترتيب إما يسبقه (ينجح) أو يليه (يُرفض لأن القائمة لم تعد كاملة)
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') {
      expect(String(results[0].reason?.message)).toMatch(/NOT_FOUND_OR_DELETED|MUST_INCLUDE_ALL/);
    }
    const rows = await prisma.schoolPaymentMethod.findMany({ where: { schoolId, isDeleted: false } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.sortOrder)).size).toBe(3);
  });

  it('update concurrent with delete of same method: update either precedes or gets PAYMENT_METHOD_NOT_FOUND', async () => {
    const a = await svc.createPaymentMethod(schoolId, { name: 'A', paymentDetails: 'a' } as any);
    await svc.createPaymentMethod(schoolId, { name: 'B', paymentDetails: 'b' } as any);
    const [upd, del] = await Promise.allSettled([
      svc.updatePaymentMethod(schoolId, a.id, { name: 'A2' } as any),
      svc.deletePaymentMethod(schoolId, a.id),
    ]);
    expect(del.status).toBe('fulfilled');
    if (upd.status === 'rejected') {
      expect(String(upd.reason?.message)).toBe('PAYMENT_METHOD_NOT_FOUND');
    }
    expect(await active()).toBe(1);
  });
});
