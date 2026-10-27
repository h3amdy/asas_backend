import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * 🔐 خدمة HMAC-SHA256 لبصمات الرموز — SRS-SUB-003 §3.2
 *
 * - تدعم تعدد إصدارات المفاتيح (key rotation)
 * - `code_lookup_hash` = HMAC-SHA256(key, plaintext) → hex
 * - البحث عبر HMAC فقط — النص لا يُخزّن بوضوح
 */
@Injectable()
export class CodeHmacService {
    private readonly logger = new Logger(CodeHmacService.name);
    private keys: Map<number, Buffer> = new Map();
    private currentVersion = 1;
    private initialized = false;

    private ensureInitialized() {
        if (this.initialized) return;
        // ⚠️ لا نضبط initialized إلا بعد نجاح التحميل — وإلا يبقى الخطأ دائماً حتى إعادة التشغيل
        // تحميل المفاتيح من متغيرات البيئة
        // V1 مطلوب دائماً، إصدارات إضافية اختيارية
        const v1Key = process.env.ACTIVATION_CODE_HMAC_KEY_V1;
        if (!v1Key) {
            throw new Error('ACTIVATION_CODE_HMAC_KEY_V1 environment variable is required');
        }

        const keyBuffer = Buffer.from(v1Key, 'base64');
        if (keyBuffer.length < 32) {
            throw new Error('HMAC key must be at least 32 bytes (256 bits)');
        }
        this.keys.set(1, keyBuffer);

        // البحث عن إصدارات إضافية (V2, V3, ...)
        for (let v = 2; v <= 10; v++) {
            const envKey = process.env[`ACTIVATION_CODE_HMAC_KEY_V${v}`];
            if (envKey) {
                this.keys.set(v, Buffer.from(envKey, 'base64'));
                this.currentVersion = v;
            } else {
                break;
            }
        }

        this.initialized = true;
        this.logger.log(`HMAC keys loaded: ${this.keys.size} version(s), current=V${this.currentVersion}`);
    }

    /**
     * حساب HMAC-SHA256 للرمز بالإصدار الحالي
     */
    computeHash(plaintext: string): { hash: string; keyVersion: number } {
        this.ensureInitialized();
        const key = this.keys.get(this.currentVersion);
        if (!key) throw new Error(`HMAC key V${this.currentVersion} not found`);

        const hash = crypto
            .createHmac('sha256', key)
            .update(plaintext, 'utf8')
            .digest('hex');

        return { hash, keyVersion: this.currentVersion };
    }

    /**
     * حساب HMAC بإصدار محدد (للبحث بإصدارات قديمة)
     */
    computeHashWithVersion(plaintext: string, version: number): string {
        this.ensureInitialized();
        const key = this.keys.get(version);
        if (!key) throw new Error(`HMAC key V${version} not found`);

        return crypto
            .createHmac('sha256', key)
            .update(plaintext, 'utf8')
            .digest('hex');
    }

    /**
     * حساب HMAC بكل الإصدارات المتاحة — يُستخدم للبحث
     */
    computeAllVersionHashes(plaintext: string): Array<{ hash: string; version: number }> {
        this.ensureInitialized();
        const results: Array<{ hash: string; version: number }> = [];
        for (const [version, key] of this.keys) {
            const hash = crypto
                .createHmac('sha256', key)
                .update(plaintext, 'utf8')
                .digest('hex');
            results.push({ hash, version });
        }
        return results;
    }

    getCurrentVersion(): number {
        return this.currentVersion;
    }
}
