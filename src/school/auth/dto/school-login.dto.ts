// src/school/auth/dto/school-login.dto.ts

import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * DTO لتسجيل دخول مستخدمي المدرسة
 * يدعم الدخول بـ (schoolCode + userCode) أو (schoolCode + phone)
 */
export class SchoolLoginDto {
  // في التطبيق الخاص: ترسل schoolUuid مباشرة من config
  // في العام: بعد اختيار المدرسة ترسل نفس الشيء
  @IsUUID()
  schoolUuid!: string;

  // ADMIN/TEACHER/STUDENT
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  userCode?: number;

  // PARENT
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  phone?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  password!: string;

  // الجهاز
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  deviceFingerprint!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  pushToken?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  deviceType!: 'ANDROID' | 'IOS' | 'WEB';
}
