// src/platform/profile/dto/update-profile.dto.ts
import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';

/**
 * DTO تعديل الملف الشخصي (PLT-002)
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

/**
 * DTO تغيير كلمة المرور (PLT-002)
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'كلمة المرور الحالية مطلوبة' })
  oldPassword: string;

  @IsString()
  @MinLength(6, { message: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' })
  newPassword: string;
}
