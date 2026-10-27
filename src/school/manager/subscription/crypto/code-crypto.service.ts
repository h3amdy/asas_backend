// src/school/manager/subscription/crypto/code-crypto.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * 🔒 خدمة تشفير/فك تشفير رموز التفعيل — SRS-SUB-003 §3.3
 *
 * - AES-256-GCM مع IV عشوائي 12 بايت
 * - AAD = "sub-code|v1|{school_id}|{batch_uuid}|{code_uuid}"
 * - التشفير يربط الرمز بمدرسته ودفعته ← فك التشفير يفشل إذا تغيّر أي منها
 * - تخزين: IV (12) + AuthTag (16) + Ciphertext كـ Bytes واحدة
 */
@Injectable()
export class CodeCryptoService {
    private readonly logger = new Logger(CodeCryptoService.name);
    private keys: Map<number, Buffer> = new Map();
    private currentVersion = 1;
    private initialized = false;

    /** ثوابت AES-256-GCM */
    private static readonly IV_LENGTH = 12;
    private static readonly AUTH_TAG_LENGTH = 16;
    private static readonly ALGORITHM = 'aes-256-gcm' as const;

    private ensureInitialized() {
        if (this.initialized) return;
        // ⚠️ لا نضبط initialized إلا بعد نجاح التحميل

        const v1Key = process.env.ACTIVATION_CODE_ENC_KEY_V1;
        if (!v1Key) {
            throw new Error('ACTIVATION_CODE_ENC_KEY_V1 environment variable is required');
        }

        const keyBuffer = Buffer.from(v1Key, 'base64');
        if (keyBuffer.length !== 32) {
            throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
        }
        this.keys.set(1, keyBuffer);

        // إصدارات إضافية
        for (let v = 2; v <= 10; v++) {
            const envKey = process.env[`ACTIVATION_CODE_ENC_KEY_V${v}`];
            if (envKey) {
                const buf = Buffer.from(envKey, 'base64');
                if (buf.length !== 32) {
                    throw new Error(`Encryption key V${v} must be exactly 32 bytes`);
                }
                this.keys.set(v, buf);
                this.currentVersion = v;
            } else {
                break;
            }
        }

        this.initialized = true;
        this.logger.log(`Encryption keys loaded: ${this.keys.size} version(s), current=V${this.currentVersion}`);
    }

    /**
     * بناء سلسلة AAD الموحّدة
     *
     * الترتيب: "sub-code|v1|{schoolId}|{batchUuid}|{codeUuid}"
     * هذا يربط النص المشفّر بسياقه — أي تلاعب بالسياق يُفشل فك التشفير.
     */
    buildAAD(schoolId: number, batchUuid: string, codeUuid: string): Buffer {
        return Buffer.from(`sub-code|v1|${schoolId}|${batchUuid}|${codeUuid}`, 'utf8');
    }

    /**
     * تشفير نص الرمز
     *
     * @returns Buffer واحد = IV(12) + AuthTag(16) + Ciphertext
     */
    encrypt(plaintext: string, aad: Buffer): { ciphertext: Buffer; keyVersion: number } {
        this.ensureInitialized();
        const key = this.keys.get(this.currentVersion);
        if (!key) throw new Error(`Encryption key V${this.currentVersion} not found`);

        const iv = crypto.randomBytes(CodeCryptoService.IV_LENGTH);
        const cipher = crypto.createCipheriv(CodeCryptoService.ALGORITHM, key, iv, {
            authTagLength: CodeCryptoService.AUTH_TAG_LENGTH,
        });
        cipher.setAAD(aad);

        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        // تجميع: IV + AuthTag + Ciphertext
        const result = Buffer.concat([iv, authTag, encrypted]);

        return { ciphertext: result, keyVersion: this.currentVersion };
    }

    /**
     * فك تشفير — يُستخدم فقط لعرض الرموز UNUSED للمدير
     *
     * @param combined Buffer = IV(12) + AuthTag(16) + Ciphertext
     */
    decrypt(combined: Buffer, aad: Buffer, keyVersion: number): string {
        this.ensureInitialized();
        const key = this.keys.get(keyVersion);
        if (!key) throw new Error(`Encryption key V${keyVersion} not found`);

        const iv = combined.subarray(0, CodeCryptoService.IV_LENGTH);
        const authTag = combined.subarray(
            CodeCryptoService.IV_LENGTH,
            CodeCryptoService.IV_LENGTH + CodeCryptoService.AUTH_TAG_LENGTH,
        );
        const ciphertext = combined.subarray(
            CodeCryptoService.IV_LENGTH + CodeCryptoService.AUTH_TAG_LENGTH,
        );

        const decipher = crypto.createDecipheriv(CodeCryptoService.ALGORITHM, key, iv, {
            authTagLength: CodeCryptoService.AUTH_TAG_LENGTH,
        });
        decipher.setAAD(aad);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);

        return decrypted.toString('utf8');
    }

    getCurrentVersion(): number {
        return this.currentVersion;
    }
}
