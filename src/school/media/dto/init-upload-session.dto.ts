// src/school/media/dto/init-upload-session.dto.ts
// VIDEO P4-3 (W-050 / W-058 / §4.1):
//   - إزالة @Max(52_428_800) الصلب من DTO ونقل فحص السقف حسب kind إلى الخدمة المركزية
//     (UploadValidationHelper.validateFileSize) لإعادة FILE_TOO_LARGE مع max_size_bytes.
//   - إضافة subjectUuid و lessonUuid الاختياريين للتحقق المبكر من ملكية المعلم (§4.1).
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MediaKind } from '@prisma/client';

export class InitUploadSessionDto {
  @IsEnum(MediaKind)
  kind!: MediaKind;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  totalSizeBytes!: number;

  @IsInt()
  @IsOptional()
  @Min(65536) // 64KB minimum chunk
  chunkSizeBytes?: number;

  @IsString()
  @IsOptional()
  subjectUuid?: string;

  @IsString()
  @IsOptional()
  lessonUuid?: string;
}
