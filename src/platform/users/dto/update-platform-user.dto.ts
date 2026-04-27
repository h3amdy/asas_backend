// src/platform/users/dto/update-platform-user.dto.ts
import { IsString, IsEmail, IsOptional } from 'class-validator';

/**
 * DTO تعديل بيانات معلم منصة (PLT-012)
 * ملاحظة: اسم المستخدم ثابت بعد الإنشاء — غير قابل للتعديل
 */
export class UpdatePlatformUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
