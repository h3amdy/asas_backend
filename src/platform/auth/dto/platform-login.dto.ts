// src/platform/auth/dto/platform-login.dto.ts
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class PlatformLoginDto {
  /**
   * اسم المستخدم أو البريد الإلكتروني (PLT-001)
   */
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم أو البريد مطلوب' })
  login: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  password: string;
}
