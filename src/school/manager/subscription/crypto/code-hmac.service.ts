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
        // V1 مطلوب دائماً، إصدارات إضافية اختيارية ومتتالية (V2, V3, ...)
        const v1Key = process.env.ACTIVATION_CODE_HMAC_KEY_V1;
        if (!v1Key) {
            throw new Error('ACTIVATION_CODE_HMAC_KEY_V1 environment variable is required');
        }

        const loaded = new Map<number, Buffer>();
        loaded.set(1, CodeHmacService.decodeKey(1, v1Key));

        let current = 1;
        let gapAt: number | null = null;
        for (let v = 2; v <= CodeHmacService.MAX_VERSION; v++) {
            const envKey = process.env[`ACTIVATION_CODE_HMAC_KEY_V${v}`];
            if (!envKey) {
                gapAt ??= v;
                continue;
            }
            if (gapAt !== null) {
                // V3 موجود بلا V2 مثلاً — كان يُتجاهل بصمت فيُكتب بإصدار قديم
                throw new Error(
                    `ACTIVATION_CODE_HMAC_KEY_V${v} is set but ACTIVATION_CODE_HMAC_KEY_V${gapAt} is missing — versions must be consecutive`,
                );
            }
            loaded.set(v, CodeHmacService.decodeKey(v, envKey));
            current = v;
        }

        // إسناد ذري بعد نجاح التحميل الكامل
        this.keys = loaded;
        this.currentVersion = current;
        this.initialized = true;
        this.logger.log(`HMAC keys loaded: ${this.keys.size} version(s), current=V${this.currentVersion}`);
    }

    private static readonly MAX_VERSION = 10;

    /** فك وتحقق صارم لمفتاح base64: محارف صالحة + طول ≥ 32 بايت */
    private static decodeKey(version: number, raw: string): Buffer {
        const value = raw.trim();
        // Buffer.from(..., 'base64') يتجاهل المحارف غير الصالحة بصمت — نرفضها صراحة
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
            throw new Error(`ACTIVATION_CODE_HMAC_KEY_V${version} is not valid base64`);
        }
        const buf = Buffer.from(value, 'base64');
        if (buf.length < 32) {
            throw new Error(
                `ACTIVATION_CODE_HMAC_KEY_V${version} must be at least 32 bytes (256 bits), got ${buf.length}`,
            );
        }
        return buf;
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
        this.ensureInitialized();
        return this.currentVersion;
    }
}
