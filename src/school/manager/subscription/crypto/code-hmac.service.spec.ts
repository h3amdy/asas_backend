// src/school/manager/subscription/crypto/code-hmac.service.spec.ts
// اختبارات تحميل مفاتيح HMAC متعددة الإصدارات (الإصلاح 4) — مفاتيح عشوائية، لا أسرار.

import * as crypto from 'crypto';
import { CodeHmacService } from './code-hmac.service';

const key = (bytes: number) => crypto.randomBytes(bytes).toString('base64');

describe('CodeHmacService — multi-version keys', () => {
    const saved = { ...process.env };

    beforeEach(() => {
        for (let v = 1; v <= 10; v++) delete process.env[`ACTIVATION_CODE_HMAC_KEY_V${v}`];
    });
    afterAll(() => { process.env = saved; });

    it('throws when V1 is missing', () => {
        expect(() => new CodeHmacService().computeHash('X')).toThrow('ACTIVATION_CODE_HMAC_KEY_V1');
    });

    it('throws when V1 is shorter than 32 bytes', () => {
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(16);
        expect(() => new CodeHmacService().computeHash('X')).toThrow('at least 32 bytes');
    });

    it('throws when V2 is shorter than 32 bytes (previously accepted silently)', () => {
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(32);
        process.env.ACTIVATION_CODE_HMAC_KEY_V2 = key(8);
        expect(() => new CodeHmacService().computeHash('X')).toThrow('ACTIVATION_CODE_HMAC_KEY_V2');
    });

    it('throws on invalid base64 (previously decoded silently to garbage)', () => {
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(32);
        process.env.ACTIVATION_CODE_HMAC_KEY_V2 = 'not base64 at all!!'.padEnd(48, '#');
        expect(() => new CodeHmacService().computeHash('X')).toThrow('not valid base64');
    });

    it('throws on version gap: V3 set without V2 (previously V3 was ignored)', () => {
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(32);
        process.env.ACTIVATION_CODE_HMAC_KEY_V3 = key(32);
        expect(() => new CodeHmacService().computeHash('X')).toThrow('versions must be consecutive');
    });

    it('accepts output of `openssl rand -base64 32` format', () => {
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(32); // 44 chars, '=' padded
        expect(new CodeHmacService().computeHash('X').keyVersion).toBe(1);
    });

    it('rotation: new codes use V2, codes hashed with V1 remain findable', () => {
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(32);
        const v1Only = new CodeHmacService();
        const oldHash = v1Only.computeHash('ABCD1234').hash;

        process.env.ACTIVATION_CODE_HMAC_KEY_V2 = key(32);
        const rotated = new CodeHmacService();

        expect(rotated.getCurrentVersion()).toBe(2);
        expect(rotated.computeHash('ABCD1234').keyVersion).toBe(2);
        const lookup = rotated.computeAllVersionHashes('ABCD1234').map(h => h.hash);
        expect(lookup).toHaveLength(2);
        expect(lookup).toContain(oldHash);
    });

    it('after a failed load, a fixed env loads successfully (no sticky init)', () => {
        const svc = new CodeHmacService();
        expect(() => svc.computeHash('X')).toThrow();
        process.env.ACTIVATION_CODE_HMAC_KEY_V1 = key(32);
        expect(svc.computeHash('X').keyVersion).toBe(1);
    });
});
