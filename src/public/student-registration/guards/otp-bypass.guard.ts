// src/public/student-registration/guards/otp-bypass.guard.ts
import { Injectable, CanActivate, ForbiddenException } from '@nestjs/common';
import { OTP_DEFAULTS } from '../../../shared/otp/otp.constants';
import { REGISTRATION_ERRORS } from '../registration.constants';

/**
 * 🛡️ حارس مسار التسجيل المباشر بدون OTP
 *
 * يمنع استدعاء مسار `complete-without-otp` إذا كان التحقق عبر OTP مفعّلاً في النظام.
 * يتم تنفيذه على مستوى NestJS Guard قبل فحص الـ ValidationPipe وقبل الـ Controller.
 * يرمي خطأ 403 Forbidden مع الرمز الموحّد `OTP_BYPASS_NOT_ALLOWED`.
 */
@Injectable()
export class OtpBypassGuard implements CanActivate {
  canActivate(): boolean {
    if (OTP_DEFAULTS.isStudentRegistrationOtpEnabled) {
      throw new ForbiddenException(REGISTRATION_ERRORS.OTP_BYPASS_NOT_ALLOWED);
    }
    return true;
  }
}
