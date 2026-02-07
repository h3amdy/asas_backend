// src/school/auth/utils/crypto.util.ts
import { createHash, randomBytes } from 'crypto';

/**
 * إنشاء توكن عشوائي
 */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * حساب SHA256
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
