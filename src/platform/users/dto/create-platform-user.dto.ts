// src/platform/users/dto/create-platform-user.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsOptional,
} from 'class-validator';

/**
 * DTO إنشاء معلم منصة (PLT-011)
 */
export class CreatePlatformUserDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم مطلوب' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username: string;

  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  password: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
