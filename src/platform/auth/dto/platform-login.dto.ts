// src/platform/auth/dto/platform-login.dto.ts
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { MaxUtf8Bytes } from '../../../common/validation/max-utf8-bytes.decorator';

export class PlatformLoginDto {
  /**
   * اسم المستخدم أو البريد الإلكتروني (PLT-001)
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم أو البريد مطلوب' })
  @MaxLength(200)
  login: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  @MaxLength(72)
  @MaxUtf8Bytes(72)
  password: string;
}
