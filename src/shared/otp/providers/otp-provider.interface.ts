// src/shared/otp/providers/otp-provider.interface.ts

// ─── نتائج مشتركة ─────────────────────────────────────

export interface OtpSendResult {
  success: boolean;
  error?: string;
}

export interface OtpVerifyResult {
  verified: boolean;
  error?: string;
}

// ─── Self-Managed: نحن نولّد الكود والمزود يوصّله ─────

export interface SelfManagedOtpProvider {
  readonly mode: 'SELF_MANAGED';
  readonly channel: string;
  send(phone: string, code: string): Promise<OtpSendResult>;
}

// ─── Delegated: المزود يولّد الكود ويتحقق منه ─────────

export interface DelegatedOtpProvider {
  readonly mode: 'DELEGATED';
  readonly channel: string;
  send(phone: string): Promise<OtpSendResult>;
  verify(phone: string, code: string): Promise<OtpVerifyResult>;
}

// ─── Union + Type Guard ────────────────────────────────

export type OtpProvider = SelfManagedOtpProvider | DelegatedOtpProvider;

export function isDelegatedProvider(p: OtpProvider): p is DelegatedOtpProvider {
  return p.mode === 'DELEGATED';
}

/** رمز الحقن لـ NestJS */
export const OTP_PROVIDER = 'OTP_PROVIDER';
