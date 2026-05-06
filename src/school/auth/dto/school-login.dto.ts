// src/school/auth/dto/school-login.dto.ts
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO لتسجيل دخول مستخدمي المدرسة
 *
 * حقل `identifier` موحّد:
 * - إذا كان رقماً → يُبحث عنه كـ code (ADMIN/TEACHER/STUDENT)
 * - إذا لم يُوجد → يُبحث عنه كـ phone (PARENT)
 */
export class SchoolLoginDto {
  @IsUUID()
  schoolUuid!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  @IsString()
  identifier!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  password!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  deviceFingerprint!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(['ANDROID', 'IOS', 'WEB'])
  deviceType!: 'ANDROID' | 'IOS' | 'WEB';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  pushToken?: string;
}
