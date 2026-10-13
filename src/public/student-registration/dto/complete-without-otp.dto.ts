// src/public/student-registration/dto/complete-without-otp.dto.ts
import { IsString, IsNotEmpty, IsInt, IsIn, MinLength, Matches } from 'class-validator';

/**
 * DTO لإكمال التسجيل بدون OTP — يُستخدم فقط عند تعطيل OTP مؤقتاً
 *
 * الفرق الوحيد عن CompleteRegistrationDto:
 * - يستقبل `phone` مباشرةً بدلاً من `registrationToken`
 * - المتحقق من phone: يجب أن يبدأ بـ + ويتبعه أرقام فقط (E.164 بسيط)
 */
export class CompleteWithoutOtpDto {
  /**
   * رقم الهاتف بصيغة دولية (+967XXXXXXXXX)
   * يُطبَّق عليه نفس normalizePhone المستخدم في OtpService
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+\d{7,15}$/, {
    message: 'phone must be in international format starting with + (e.g. +967712345678)',
  })
  phone: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['MALE', 'FEMALE'])
  gender: string;

  @IsInt()
  provinceId: number;

  @IsInt()
  districtId: number;

  @IsInt()
  gradeId: number;

  @IsString()
  @MinLength(4)
  password: string;
}
