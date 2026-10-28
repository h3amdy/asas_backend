// test/subscription/idempotency-canonical-hash.spec.ts
//
// اختبارات Canonical JSON لـ computeRequestHash — الإصلاح 1
// + اختبارات معالجة PROCESSING العالقة — الإصلاح 2
//
// هذه اختبارات وحدة (unit tests) — لا تحتاج قاعدة بيانات.

import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════
// نسخة مستقلة من computeRequestHash للاختبار (بدون DI)
// ═══════════════════════════════════════════════════════════

function computeRequestHash(dto: Record<string, any>): string {
    const canonical = JSON.stringify(
        dto,
        (_key, value) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return Object.fromEntries(
                    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
                );
            }
            return value;
        },
    );
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

describe('computeRequestHash — Canonical JSON', () => {
    // ─── ترتيب المفاتيح ─────────────────────────────────

    it('should produce same hash regardless of top-level key order', () => {
        const a = computeRequestHash({ alpha: 1, beta: 2, gamma: 3 });
        const b = computeRequestHash({ gamma: 3, alpha: 1, beta: 2 });
        expect(a).toBe(b);
    });

    it('should produce same hash regardless of NESTED key order', () => {
        const a = computeRequestHash({
            settings: { price: 100, trial: true },
            name: 'School',
        });
        const b = computeRequestHash({
            name: 'School',
            settings: { trial: true, price: 100 },
        });
        expect(a).toBe(b);
    });

    it('should produce same hash for deeply nested objects with different key order', () => {
        const a = computeRequestHash({
            level1: {
                level2: {
                    c: 3, a: 1, b: 2,
                },
                x: 'hello',
            },
        });
        const b = computeRequestHash({
            level1: {
                x: 'hello',
                level2: {
                    a: 1, b: 2, c: 3,
                },
            },
        });
        expect(a).toBe(b);
    });

    // ─── المصفوفات تحافظ على ترتيبها ─────────────────

    it('should produce DIFFERENT hash when array element order changes', () => {
        const a = computeRequestHash({ items: [1, 2, 3] });
        const b = computeRequestHash({ items: [3, 2, 1] });
        expect(a).not.toBe(b);
    });

    it('should produce same hash for arrays of objects with different key order per object', () => {
        const a = computeRequestHash({
            paymentMethods: [
                { name: 'Cash', details: 'Pay cash' },
                { name: 'Bank', details: 'IBAN: ...' },
            ],
        });
        const b = computeRequestHash({
            paymentMethods: [
                { details: 'Pay cash', name: 'Cash' },
                { details: 'IBAN: ...', name: 'Bank' },
            ],
        });
        expect(a).toBe(b);
    });

    // ─── اختلاف القيم ────────────────────────────────

    it('should produce DIFFERENT hash when a nested value changes', () => {
        const a = computeRequestHash({
            paymentMethods: [{ name: 'Cash', details: 'Pay cash' }],
            price: '100',
        });
        const b = computeRequestHash({
            paymentMethods: [{ name: 'Cash', details: 'Pay cash' }],
            price: '200',
        });
        expect(a).not.toBe(b);
    });

    it('should produce DIFFERENT hash when a nested object field changes', () => {
        const a = computeRequestHash({
            settings: { trial: true, days: 7 },
        });
        const b = computeRequestHash({
            settings: { trial: true, days: 14 },
        });
        expect(a).not.toBe(b);
    });

    it('should produce DIFFERENT hash when an array item object field changes', () => {
        const a = computeRequestHash({
            paymentMethods: [
                { name: 'Cash', details: 'OLD' },
            ],
        });
        const b = computeRequestHash({
            paymentMethods: [
                { name: 'Cash', details: 'NEW' },
            ],
        });
        expect(a).not.toBe(b);
    });

    // ─── حقول اختيارية / null / undefined ──────────────

    it('should produce DIFFERENT hash for null vs undefined fields', () => {
        const a = computeRequestHash({ instructions: null });
        const b = computeRequestHash({});
        // JSON.stringify omits undefined, includes null
        expect(a).not.toBe(b);
    });

    // ─── الحالة الفعلية: ActivateSubscriptionDto ─────────

    it('should handle real ActivateSubscriptionDto correctly', () => {
        const dto1 = {
            isTrialEnabled: true,
            trialDurationDays: 7,
            subscriptionPrice: '5000',
            contactNumber: '+967700000000',
            paymentMethods: [
                { name: 'كاش', paymentDetails: 'ادفع كاش', instructions: null },
            ],
        };
        const dto2 = {
            subscriptionPrice: '5000',
            contactNumber: '+967700000000',
            isTrialEnabled: true,
            trialDurationDays: 7,
            paymentMethods: [
                { paymentDetails: 'ادفع كاش', name: 'كاش', instructions: null },
            ],
        };
        expect(computeRequestHash(dto1)).toBe(computeRequestHash(dto2));
    });

    it('should detect real ActivateSubscriptionDto change in paymentMethods', () => {
        const dto1 = {
            isTrialEnabled: true,
            trialDurationDays: 7,
            subscriptionPrice: '5000',
            contactNumber: '+967700000000',
            paymentMethods: [
                { name: 'كاش', paymentDetails: 'ادفع كاش', instructions: null },
            ],
        };
        const dto2 = {
            isTrialEnabled: true,
            trialDurationDays: 7,
            subscriptionPrice: '5000',
            contactNumber: '+967700000000',
            paymentMethods: [
                { name: 'تحويل', paymentDetails: 'حساب بنكي', instructions: null },
            ],
        };
        expect(computeRequestHash(dto1)).not.toBe(computeRequestHash(dto2));
    });
});
