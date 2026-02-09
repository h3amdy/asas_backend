// src/school/auth/dto/school-login.dto.ts
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO لتسجيل دخول مستخدمي المدرسة
 * يدعم تسجيل الدخول بالكود (ADMIN/TEACHER/STUDENT) أو بالهاتف (PARENT)
 */
export class SchoolLoginDto {
  @IsUUID()
  schoolUuid!: string;

  @IsOptional()
  @IsInt()
  userCode?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  phone?: string;

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
