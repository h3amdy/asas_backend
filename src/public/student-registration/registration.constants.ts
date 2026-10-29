// src/public/student-registration/registration.constants.ts

/**
 * أخطاء التسجيل الذاتي
 */
export const REGISTRATION_ERRORS = {
  TOKEN_INVALID: 'REGISTRATION_TOKEN_INVALID',
  TOKEN_EXPIRED: 'REGISTRATION_TOKEN_EXPIRED',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  /** تطابق كامل: نفس الهاتف + الاسم + الصف — يُحتمل أنه نفس الطالب أو إعادة طلب */
  DUPLICATE_STUDENT_DETECTED: 'DUPLICATE_STUDENT_DETECTED',
  /** بلوغ الحد الأقصى لعدد حسابات الطلاب المرتبطة برقم هاتف واحد */
  PHONE_ACCOUNTS_LIMIT_REACHED: 'PHONE_ACCOUNTS_LIMIT_REACHED',
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

// ─── Safe parsing for maxAccountsPerPhone ───────────────────────────────
// القيم المقبولة: 0 (بلا حد)، أو عدد صحيح موجب.
// القيم السالبة أو غير الصالحة تُستبدل بالافتراضي الآمن (5).
const _rawMaxAccounts = parseInt(process.env.REGISTRATION_MAX_ACCOUNTS_PER_PHONE || '5', 10);
const _safeMaxAccounts = Number.isNaN(_rawMaxAccounts) || _rawMaxAccounts < 0 ? 5 : _rawMaxAccounts;

export const REGISTRATION_CONFIG = {
  /** رمز مدرسة مفهوم */
  mafhoomSchoolCode: parseInt(process.env.MAFHOOM_SCHOOL_CODE || '0', 10),
  /**
   * الحد الأقصى لعدد حسابات الطلاب لكل رقم هاتف في التسجيل الذاتي.
   * - القيمة 0 تُلغي الحد نهائيًا.
   * - القيمة الافتراضية: 5.
   * - القيم السالبة أو غير الصالحة تُستبدل بـ 5.
   */
  maxAccountsPerPhone: _safeMaxAccounts,
  /** أقصى عدد محاولات إكمال تسجيل بدون OTP لكل هاتف في الساعة (الافتراضي: 5) */
  phoneRateLimitPerHour: parseInt(process.env.REGISTRATION_PHONE_RATE_LIMIT || '5', 10),
  /** نافذة تحديد المعدل بالثواني (الافتراضي: 3600 = 1 ساعة) */
  phoneRateLimitTtlSeconds: parseInt(process.env.REGISTRATION_PHONE_RATE_TTL_SECONDS || '3600', 10),
};
