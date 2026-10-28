// src/school/common/subscription/__tests__/idempotency-canonical-hash.spec.ts
//
// اختبارات وحدة على IdempotencyService الفعلية (Prisma مُحاكى):
//  - Canonical JSON (الإصلاح 1)
//  - آلة الحالات + الإيجار + الإكمال داخل المعاملة (الإصلاح 2 / النقطة 1)
//
// ⚠️ لا تُثبت سلوك PostgreSQL تحت التزامن الفعلي — ذلك يتطلب E2E على قاعدة اختبار.

import { ConflictException, HttpException } from '@nestjs/common';
import { Prisma, IdempotencyStatus } from '@prisma/client';
import { IdempotencyService } from '../idempotency.service';

const P2002 = () =>
    new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

function makePrisma() {
    return {
        idempotencyRecord: {
            create: jest.fn(),
            findUnique: jest.fn(),
            updateMany: jest.fn(),
        },
    };
}

const PARAMS = {
    idempotencyKey: '11111111-1111-1111-1111-111111111111',
    schoolId: 1,
    actorUserId: 10,
    endpoint: 'student-subscription-activate',
    requestHash: 'h',
};

function record(overrides: Partial<Record<string, any>> = {}) {
    return {
        idempotencyKey: PARAMS.idempotencyKey,
        schoolId: 1,
        actorUserId: 10,
        endpoint: PARAMS.endpoint,
        requestHash: 'h',
        status: IdempotencyStatus.PROCESSING,
        responseStatusCode: null,
        responseBody: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════
// 1. Canonical JSON
// ═══════════════════════════════════════════════════════════

describe('IdempotencyService.computeRequestHash — Canonical JSON', () => {
    const svc = new IdempotencyService({} as any);
    const h = (o: any) => svc.computeRequestHash(o);

    it('same hash regardless of top-level key order', () => {
        expect(h({ a: 1, b: 2, c: 3 })).toBe(h({ c: 3, a: 1, b: 2 }));
    });

    it('same hash regardless of nested key order', () => {
        expect(h({ s: { price: 100, trial: true }, n: 'x' }))
            .toBe(h({ n: 'x', s: { trial: true, price: 100 } }));
    });

    it('same hash for deep nesting with different key order', () => {
        expect(h({ l1: { l2: { c: 3, a: 1, b: 2 }, x: 'y' } }))
            .toBe(h({ l1: { x: 'y', l2: { a: 1, b: 2, c: 3 } } }));
    });

    it('different hash when array order changes', () => {
        expect(h({ items: [1, 2, 3] })).not.toBe(h({ items: [3, 2, 1] }));
    });

    it('same hash for array objects with different key order', () => {
        expect(h({ pm: [{ name: 'Cash', d: '1' }, { name: 'Bank', d: '2' }] }))
            .toBe(h({ pm: [{ d: '1', name: 'Cash' }, { d: '2', name: 'Bank' }] }));
    });

    it('different hash when a nested field changes (regression: old impl ignored nested keys)', () => {
        const a = { paymentMethods: [{ name: 'Cash', paymentDetails: 'OLD' }], price: '100' };
        const b = { paymentMethods: [{ name: 'Cash', paymentDetails: 'NEW' }], price: '100' };
        expect(h(a)).not.toBe(h(b));

        // البرهان على الخلل القديم: replacer array يحذف مفاتيح المستوى المتداخل
        const old = (o: any) => JSON.stringify(o, Object.keys(o).sort());
        expect(old(a)).toBe(old(b));
    });

    it('different hash for null vs absent field', () => {
        expect(h({ instructions: null })).not.toBe(h({}));
    });

    it('real ActivateSubscriptionDto: key order irrelevant, content relevant', () => {
        const base = {
            isTrialEnabled: true, trialDurationDays: 7, subscriptionPrice: '5000',
            contactNumber: '+967700000000',
            paymentMethods: [{ name: 'كاش', paymentDetails: 'ادفع كاش', instructions: null }],
        };
        const reordered = {
            paymentMethods: [{ instructions: null, paymentDetails: 'ادفع كاش', name: 'كاش' }],
            contactNumber: '+967700000000', subscriptionPrice: '5000',
            trialDurationDays: 7, isTrialEnabled: true,
        };
        expect(h(base)).toBe(h(reordered));
        expect(h(base)).not.toBe(h({ ...base, trialDurationDays: 14 }));
    });
});

// ═══════════════════════════════════════════════════════════
// 2. آلة الحالات والإيجار
// ═══════════════════════════════════════════════════════════

describe('IdempotencyService — state machine & lease', () => {
    let prisma: ReturnType<typeof makePrisma>;
    let svc: IdempotencyService;

    beforeEach(() => {
        prisma = makePrisma();
        svc = new IdempotencyService(prisma as any);
    });

    it('lease must exceed the longest business transaction timeout (60s batch)', () => {
        expect(IdempotencyService.PROCESSING_LEASE_MS).toBeGreaterThan(60_000 * 2);
    });

    it('new key → creates PROCESSING with short lease, returns null', async () => {
        prisma.idempotencyRecord.create.mockResolvedValue({});
        const before = Date.now();
        await expect(svc.acquireOrReturn(PARAMS)).resolves.toBeNull();
        const data = prisma.idempotencyRecord.create.mock.calls[0][0].data;
        expect(data.status).toBe(IdempotencyStatus.PROCESSING);
        const lease = data.expiresAt.getTime() - before;
        expect(lease).toBeLessThanOrEqual(IdempotencyService.PROCESSING_LEASE_MS + 1000);
    });

    it('PROCESSING within lease → 409 REQUEST_IN_PROGRESS, no reclaim', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(record());
        await expect(svc.acquireOrReturn(PARAMS)).rejects.toThrow('REQUEST_IN_PROGRESS');
        expect(prisma.idempotencyRecord.updateMany).not.toHaveBeenCalled();
    });

    it('PROCESSING with expired lease → atomic conditional reclaim, returns null', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(
            record({ expiresAt: new Date(Date.now() - 1000) }),
        );
        prisma.idempotencyRecord.updateMany.mockResolvedValue({ count: 1 });

        await expect(svc.acquireOrReturn(PARAMS)).resolves.toBeNull();
        const where = prisma.idempotencyRecord.updateMany.mock.calls[0][0].where;
        expect(where.status).toBe(IdempotencyStatus.PROCESSING);
        expect(where.expiresAt).toHaveProperty('lte');
    });

    it('two concurrent reclaims of the same stale record → only one proceeds', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(
            record({ expiresAt: new Date(Date.now() - 1000) }),
        );
        prisma.idempotencyRecord.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        const results = await Promise.allSettled([
            svc.acquireOrReturn(PARAMS),
            svc.acquireOrReturn(PARAMS),
        ]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    });

    it('COMPLETED → returns cached response (success that the client never received)', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(
            record({ status: IdempotencyStatus.COMPLETED, responseStatusCode: 200, responseBody: { ok: 1 } }),
        );
        await expect(svc.acquireOrReturn(PARAMS)).resolves.toEqual({ statusCode: 200, body: { ok: 1 } });
    });

    it('FAILED_BUSINESS → replays the same error', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(
            record({
                status: IdempotencyStatus.FAILED_BUSINESS,
                responseStatusCode: 400,
                responseBody: { message: 'INVALID_OR_USED_CODE' },
            }),
        );
        const err = await svc.acquireOrReturn(PARAMS).catch(e => e);
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(400);
    });

    it('same key with different payload → 409', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(record({ requestHash: 'other' }));
        await expect(svc.acquireOrReturn(PARAMS))
            .rejects.toThrow('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    });

    it('same key from another school → 409 (no cross-tenant replay)', async () => {
        prisma.idempotencyRecord.create.mockRejectedValue(P2002());
        prisma.idempotencyRecord.findUnique.mockResolvedValue(record({ schoolId: 2 }));
        await expect(svc.acquireOrReturn(PARAMS)).rejects.toBeInstanceOf(ConflictException);
    });

    // ─── الإكمال داخل المعاملة ───

    it('markCompletedTx updates via the TX client, only from PROCESSING', async () => {
        const tx = { idempotencyRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        await svc.markCompletedTx(tx as any, PARAMS.idempotencyKey, 200, { ok: 1 });
        const arg = tx.idempotencyRecord.updateMany.mock.calls[0][0];
        expect(arg.where.status).toBe(IdempotencyStatus.PROCESSING);
        expect(arg.data.status).toBe(IdempotencyStatus.COMPLETED);
        // لم يُستخدم عميل prisma العام ← الكتابة ضمن المعاملة فقط
        expect(prisma.idempotencyRecord.updateMany).not.toHaveBeenCalled();
    });

    it('markCompletedTx throws when lease was lost → business TX rolls back', async () => {
        const tx = { idempotencyRecord: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
        await expect(svc.markCompletedTx(tx as any, PARAMS.idempotencyKey, 200, {}))
            .rejects.toThrow('IDEMPOTENCY_LEASE_LOST');
    });

    it('markFailedTransient never masks the original error if DB write fails', async () => {
        prisma.idempotencyRecord.updateMany.mockRejectedValue(new Error('db down'));
        await expect(svc.markFailedTransient(PARAMS.idempotencyKey)).resolves.toBeUndefined();
    });

    it('markFailedBusiness only transitions from PROCESSING (never overwrites COMPLETED)', async () => {
        prisma.idempotencyRecord.updateMany.mockResolvedValue({ count: 0 });
        await svc.markFailedBusiness(PARAMS.idempotencyKey, 400, { message: 'x' });
        expect(prisma.idempotencyRecord.updateMany.mock.calls[0][0].where.status)
            .toBe(IdempotencyStatus.PROCESSING);
    });
});
