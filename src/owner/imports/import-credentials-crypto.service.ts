// src/owner/imports/import-credentials-crypto.service.ts
//
// 🛡️ SEC-IMP-01 — تشفير بيانات دخول الاستيراد الجماعي بـ AES-256-GCM
// - يشتق مفتاح 256-bit عبر HKDF-SHA256 من IMPORT_CREDENTIALS_ENC_KEY المستقل (إلزامي في الإنتاج Fail-Closed،
//   مع السماح باحتياط JWT_SECRET/local في بيئات التطوير والاختبار غير الإنتاجية فقط).
// - يربط النص المشفّر بـ AAD يحتوي (schoolId + importUuid) لمنع نقل الظرف المشفّر بين الجلسات أو المدارس.

import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

export const IMPORT_CREDENTIALS_ENVELOPE_PREFIX = 'enc:v1:';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const HKDF_SALT = Buffer.from(
  'asas:sec-imp-01:import-credentials:salt:v1',
  'utf8',
);
const HKDF_INFO_DEDICATED = Buffer.from(
  'asas:sec-imp-01:import-credentials:aes256gcm:dedicated:v1',
  'utf8',
);
const HKDF_INFO_JWT_FALLBACK = Buffer.from(
  'asas:sec-imp-01:import-credentials:aes256gcm:jwt-fallback:v1',
  'utf8',
);
const LOCAL_DEV_FALLBACK_IKM =
  'asas-local-dev-import-creds-fallback-not-for-production';

@Injectable()
export class ImportCredentialsCryptoService {
  private cachedKey: { cacheId: string; key: Buffer } | null = null;

  private resolveKey(): Buffer {
    const dedicated = (process.env.IMPORT_CREDENTIALS_ENC_KEY || '').trim();
    const jwtSecret = (process.env.JWT_SECRET || '').trim();
    const appEnv = (process.env.APP_ENV || '').trim();
    const cacheId = `${appEnv}|${dedicated ? 'ded' : jwtSecret ? 'jwt' : 'dev'}:${dedicated || jwtSecret}`;

    if (this.cachedKey?.cacheId === cacheId) {
      return this.cachedKey.key;
    }

    if (appEnv === 'production') {
      if (!dedicated) {
        throw new Error(
          'IMPORT_CREDENTIALS_ENC_KEY is required in production (JWT_SECRET fallback is disabled in production)',
        );
      }
      if (
        Buffer.byteLength(dedicated, 'utf8') < 32 ||
        new Set(dedicated).size < 8
      ) {
        throw new Error(
          'IMPORT_CREDENTIALS_ENC_KEY is too weak in production (minimum 32 bytes and 8 distinct characters)',
        );
      }
    }

    let derived: Buffer;
    if (dedicated) {
      derived = Buffer.from(
        hkdfSync(
          'sha256',
          Buffer.from(dedicated, 'utf8'),
          HKDF_SALT,
          HKDF_INFO_DEDICATED,
          32,
        ),
      );
    } else if (jwtSecret) {
      derived = Buffer.from(
        hkdfSync(
          'sha256',
          Buffer.from(jwtSecret, 'utf8'),
          HKDF_SALT,
          HKDF_INFO_JWT_FALLBACK,
          32,
        ),
      );
    } else if (appEnv === 'staging') {
      throw new Error(
        'IMPORT_CREDENTIALS_ENC_KEY or JWT_SECRET is required in staging',
      );
    } else {
      derived = Buffer.from(
        hkdfSync(
          'sha256',
          Buffer.from(LOCAL_DEV_FALLBACK_IKM, 'utf8'),
          HKDF_SALT,
          HKDF_INFO_JWT_FALLBACK,
          32,
        ),
      );
    }

    this.cachedKey = { cacheId, key: derived };
    return derived;
  }

  private buildAad(schoolId: number, importUuid: string): Buffer {
    return Buffer.from(
      `asas:sec-imp-01:import-credentials:v1|${schoolId}|${importUuid}`,
      'utf8',
    );
  }

  isEncryptedEnvelope(value: string | null | undefined): boolean {
    return (
      typeof value === 'string' &&
      value.startsWith(IMPORT_CREDENTIALS_ENVELOPE_PREFIX)
    );
  }

  encrypt<T>(payload: T, schoolId: number, importUuid: string): string {
    const key = this.resolveKey();
    const iv = randomBytes(IV_LENGTH);
    const aad = this.buildAad(schoolId, importUuid);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(aad);

    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return `${IMPORT_CREDENTIALS_ENVELOPE_PREFIX}${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
  }

  decrypt<T>(envelope: string, schoolId: number, importUuid: string): T {
    if (!this.isEncryptedEnvelope(envelope)) {
      throw new Error('INVALID_IMPORT_CREDENTIALS_ENVELOPE');
    }

    const encodedBody = envelope.slice(
      IMPORT_CREDENTIALS_ENVELOPE_PREFIX.length,
    );
    const parts = encodedBody.split('.');
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
      throw new Error('INVALID_IMPORT_CREDENTIALS_ENVELOPE');
    }

    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(dataB64, 'base64');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('INVALID_IMPORT_CREDENTIALS_ENVELOPE');
    }

    const key = this.resolveKey();
    const aad = this.buildAad(schoolId, importUuid);
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as T;
  }
}
