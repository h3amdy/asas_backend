// src/owner/auth/constants.ts

/**
 * إعدادات JWT للمالك
 * منفصلة عن School Auth لضمان عدم تداخل التوكنات
 */
export const OWNER_AUTH_JWT = {
    accessTokenTtlSec: 60 * 60 * 24,        // 1 يوم
    refreshTokenTtlSec: 60 * 60 * 24 * 7,   // 7 أيام
    issuer: 'asas-backend',
    audience: 'asas-owner-panel',           // ≠ asas-school-app
};

/**
 * أخطاء المصادقة للمالك
 */
export const OWNER_AUTH_ERRORS = {
    INVALID_CREDENTIALS: 'البريد أو كلمة السر غير صحيحة',
    USER_NOT_FOUND: 'المستخدم غير موجود',
    SESSION_NOT_FOUND: 'الجلسة غير موجودة',
    SESSION_EXPIRED: 'الجلسة منتهية',
    SESSION_REVOKED: 'الجلسة ملغية',
    INVALID_REFRESH_TOKEN: 'Refresh token غير صالح',
    WRONG_PASSWORD: 'كلمة المرور الحالية غير صحيحة',
    UNAUTHORIZED: 'غير مصرح',
};
