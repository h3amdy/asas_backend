// src/platform/profile/dto/update-profile.dto.ts
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

/**
 * DTO تعديل الملف الشخصي (PLT-002)
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'الاسم يجب ألا يتجاوز 150 حرفاً' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'رقم الهاتف يجب ألا يتجاوز 30 حرفاً' })
  phone?: string;
}

/**
 * DTO تغيير كلمة المرور (PLT-002)
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'كلمة المرور الحالية مطلوبة' })
  @MaxLength(72, { message: 'كلمة المرور يجب ألا تتجاوز 72 حرفاً' })
  oldPassword: string;

  @IsString()
  @MinLength(6, { message: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف' })
  @MaxLength(72, { message: 'كلمة المرور يجب ألا تتجاوز 72 حرفاً' })
  newPassword: string;
}
