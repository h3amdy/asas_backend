// src/platform/subjects/dto/update-subject.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO لتعديل مادة رسمية.
 * ملاحظة: الكود (code) والصف (gradeDictionaryId) لا يُعدّلان
 * بعد الإنشاء — هما مفاتيح ربط أساسية.
 */
export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  defaultName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  shortName?: string;
}
