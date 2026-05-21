// src/platform/subjects/dto/update-status.dto.ts
import { IsBoolean } from 'class-validator';

/**
 * DTO لتغيير حالة المادة بشكل صريح.
 * بدلاً من toggle (غير idempotent) — يحدد الحالة المطلوبة مباشرة.
 */
export class UpdateStatusDto {
  @IsBoolean({ message: 'الحالة يجب أن تكون true أو false' })
  isActive!: boolean;
}
