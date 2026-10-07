// src/shared/otp/otp.constants.ts

/**
 * أخطاء OTP
 */
export const OTP_ERRORS = {
  INVALID_PHONE: 'INVALID_PHONE',
  RATE_LIMITED: 'OTP_RATE_LIMITED',
  COOLDOWN_ACTIVE: 'OTP_COOLDOWN_ACTIVE',
  REQUEST_NOT_FOUND: 'OTP_REQUEST_NOT_FOUND',
  ALREADY_VERIFIED: 'OTP_ALREADY_VERIFIED',
  EXPIRED: 'OTP_EXPIRED',
  MAX_ATTEMPTS: 'OTP_MAX_ATTEMPTS',
  INVALID_CODE: 'OTP_INVALID_CODE',
  PROVIDER_FAILED: 'OTP_PROVIDER_FAILED',
  BLOCKED: 'OTP_BLOCKED',
  FAILED: 'OTP_FAILED',
  TOKEN_EXPIRED: 'OTP_TOKEN_EXPIRED',
  TOKEN_INVALID: 'OTP_TOKEN_INVALID',
};

/**
 * إعدادات OTP الافتراضية — يمكن تجاوزها من environment
 */
export const OTP_DEFAULTS = {
  /** مدة صلاحية OTP بالثواني */
  ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS || '300', 10),

  /** أقصى عدد محاولات خاطئة */
  maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),

  /** طول كود OTP */
  codeLength: parseInt(process.env.OTP_CODE_LENGTH || '6', 10),

  /** أقصى عدد طلبات OTP لكل هاتف في الساعة */
  rateLimitPerHour: parseInt(process.env.OTP_RATE_LIMIT_PER_PHONE || '3', 10),

  /** فترة الانتظار بين طلبات OTP (بالثواني) */
  cooldownSeconds: parseInt(process.env.OTP_COOLDOWN_SECONDS || '60', 10),

  /** مدة صلاحية Registration Token بعد التحقق (بالثواني) */
  registrationTokenTtlSeconds: parseInt(process.env.OTP_REGISTRATION_TOKEN_TTL_SECONDS || '1800', 10),

  /** مزود OTP */
  provider: process.env.OTP_PROVIDER || 'mock',

  /** HMAC pepper secret — يجب أن يكون مختلفًا عن JWT_SECRET */
  pepper: process.env.OTP_PEPPER || '',
};
