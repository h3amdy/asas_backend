// src/platform/subjects/dto/update-cover.dto.ts
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/**
 * DTO لتحديث صورة غلاف المادة.
 * إرسال null أو عدم إرسال mediaAssetUuid يعني إزالة الغلاف.
 */
export class UpdateCoverDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'معرّف ملف الوسائط غير صالح' })
  mediaAssetUuid?: string | null;
}
