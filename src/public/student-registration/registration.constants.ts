// src/public/student-registration/registration.constants.ts

/**
 * أخطاء التسجيل الذاتي
 */
export const REGISTRATION_ERRORS = {
  TOKEN_INVALID: 'REGISTRATION_TOKEN_INVALID',
  TOKEN_EXPIRED: 'REGISTRATION_TOKEN_EXPIRED',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  MAFHOOM_SCHOOL_NOT_FOUND: 'MAFHOOM_SCHOOL_NOT_FOUND',
  NO_CURRENT_YEAR: 'NO_CURRENT_YEAR',
  GRADE_NOT_FOUND: 'GRADE_NOT_FOUND',
  SECTION_NOT_FOUND: 'SECTION_NOT_FOUND',
  PROVINCE_NOT_FOUND: 'PROVINCE_NOT_FOUND',
  DISTRICT_NOT_FOUND: 'DISTRICT_NOT_FOUND',
  ROUTING_NOT_FOUND: 'ROUTING_NOT_FOUND',
  REGISTRATION_FAILED: 'REGISTRATION_FAILED',
  SESSION_CREATION_FAILED: 'SESSION_CREATION_FAILED',
  /** يُرجَع عند محاولة تجاوز OTP والنظام مضبوط بحيث OTP مفعّل */
  OTP_BYPASS_NOT_ALLOWED: 'OTP_BYPASS_NOT_ALLOWED',
  /** يُرجَع عند تجاوز الحد الأقصى لمحاولات التسجيل لكل رقم هاتف */
  PHONE_RATE_LIMITED: 'PHONE_RATE_LIMITED',
};

/**
 * إعدادات التسجيل — مدرسة مفهوم
 */
export const REGISTRATION_CONFIG = {
  /** رمز مدرسة مفهوم */
  mafhoomSchoolCode: parseInt(process.env.MAFHOOM_SCHOOL_CODE || '0', 10),
  /** أقصى عدد محاولات إكمال تسجيل بدون OTP لكل هاتف في الساعة (الافتراضي: 5) */
  phoneRateLimitPerHour: parseInt(process.env.REGISTRATION_PHONE_RATE_LIMIT || '5', 10),
  /** نافذة تحديد المعدل بالثواني (الافتراضي: 3600 = 1 ساعة) */
  phoneRateLimitTtlSeconds: parseInt(process.env.REGISTRATION_PHONE_RATE_TTL_SECONDS || '3600', 10),
};
