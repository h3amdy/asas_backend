// src/school/student/subscription/dto/activate-code.dto.ts
import { IsString, MaxLength, MinLength } from 'class-validator';

// ─── POST /school/student/subscription/activate ──────────

export class ActivateCodeDto {
    /**
     * رمز التفعيل — 12 محرف (بدون شرطات).
     * العميل يُرسل النص بعد إزالة الشرطات والمسافات.
     */
    @IsString()
    @MinLength(12)
    @MaxLength(12)
    code!: string;
}
