// src/shared/otp/providers/mock-otp.provider.ts
import { Logger } from '@nestjs/common';
import type { SelfManagedOtpProvider, OtpSendResult } from './otp-provider.interface';

/**
 * 🧪 Mock OTP Provider — للتطوير والاختبارات فقط
 * ممنوع في production (يُمنع عبر environment-safety)
 */
export class MockOtpProvider implements SelfManagedOtpProvider {
  private readonly logger = new Logger('MockOtpProvider');

  readonly mode = 'SELF_MANAGED' as const;
  readonly channel = 'MOCK';

  async send(phone: string, code: string): Promise<OtpSendResult> {
    this.logger.warn(`🧪 [MOCK] OTP for ${phone}: ${code}`);
    return { success: true };
  }
}
