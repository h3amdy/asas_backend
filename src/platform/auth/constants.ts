// src/platform/auth/constants.ts

/**
 * إعدادات JWT لمنصة المحتوى
 * منفصلة عن Owner Auth و School Auth لضمان عدم تداخل التوكنات
 */
export const PLATFORM_AUTH_JWT = {
  accessTokenTtlSec: 60 * 15,             // 15 دقيقة (أكثر أماناً مع وجود refresh)
  refreshTokenTtlSec: 60 * 60 * 24 * 7,   // 7 أيام
  issuer: 'asas-backend',
  audience: 'asas-platform',               // ≠ asas-owner-panel ≠ asas-school-app
};

/**
 * أخطاء المصادقة لمنصة المحتوى
 */
export const PLATFORM_AUTH_ERRORS = {
  INVALID_CREDENTIALS: 'اسم المستخدم/البريد أو كلمة المرور غير صحيحة',
  USER_NOT_FOUND: 'المستخدم غير موجود',
  ACCOUNT_DISABLED: 'الحساب موقوف — تواصل مع مدير المنصة',
  UNAUTHORIZED: 'غير مصرح',
  ADMIN_ONLY: 'هذا الإجراء متاح لمدير المنصة فقط',
  WRONG_PASSWORD: 'كلمة المرور الحالية غير صحيحة',
  INVALID_REFRESH_TOKEN: 'رمز التجديد غير صالح أو منتهي الصلاحية',
};
