import { randomInt } from 'node:crypto';

const READABLE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * توليد كلمة مرور عشوائية واضحة وسهلة القراءة (بدون أحرف ملتبسة مثل 0/O/1/I/L).
 */
export function generateReadablePassword(length = 8): string {
    return Array.from({ length }, () =>
        READABLE_CHARS.charAt(randomInt(0, READABLE_CHARS.length)),
    ).join('');
}

