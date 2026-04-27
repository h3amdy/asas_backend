// src/platform/users/dto/create-platform-user.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsOptional,
  ValidateIf,
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

  @IsOptional()
  @ValidateIf((o) => o.email !== '' && o.email !== undefined)
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  email?: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  password: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
