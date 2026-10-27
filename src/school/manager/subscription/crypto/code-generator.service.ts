// src/school/manager/subscription/crypto/code-generator.service.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * 🎲 خدمة توليد نصوص رموز التفعيل — SRS-SUB-003 §3.1
 *
 * - 12 محرف من أبجدية 31 رمز (A-Z بدون O,I,L + 2-9 بدون 0,1)
 * - `crypto.randomInt()` لا يُسبب انحياز modulo
 * - تنسيق العرض: XXXX-XXXX-XXXX
 */
@Injectable()
export class CodeGeneratorService {
    /**
     * أبجدية 31 رمز — مصممة لتقليل الخلط البصري:
     * - لا O (يُخلط مع 0)
     * - لا I, L (يُخلط مع 1)
     * - لا 0, 1 (يُخلط مع O, I/L)
     */
    private static readonly ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    private static readonly CODE_LENGTH = 12;

    /**
     * توليد رمز عشوائي واحد (12 محرف).
     * يستخدم `crypto.randomInt()` (Node 14.10+) — بلا انحياز modulo.
     */
    generateCode(): string {
        const chars: string[] = [];
        for (let i = 0; i < CodeGeneratorService.CODE_LENGTH; i++) {
            const idx = crypto.randomInt(CodeGeneratorService.ALPHABET.length);
            chars.push(CodeGeneratorService.ALPHABET[idx]);
        }
        return chars.join('');
    }

    /**
     * تنسيق الرمز للعرض: XXXX-XXXX-XXXX
     */
    formatCode(code: string): string {
        if (code.length !== 12) return code;
        return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
    }

    /**
     * تنظيف الرمز المُدخل: إزالة الشرطات والمسافات + تحويل لأحرف كبيرة
     */
    normalizeInput(input: string): string {
        return input.replace(/[-\s]/g, '').toUpperCase();
    }
}
