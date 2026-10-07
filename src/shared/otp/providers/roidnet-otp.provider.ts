// src/shared/otp/providers/roidnet-otp.provider.ts
import { Logger } from '@nestjs/common';
import type { DelegatedOtpProvider, OtpSendResult, OtpVerifyResult } from './otp-provider.interface';

/**
 * 🌐 RoidNet WhatsApp OTP Provider — Delegated
 *
 * RoidNet يولّد OTP بنفسه ويرسله عبر WhatsApp،
 * ثم يتحقق منه عبر /verify.
 *
 * عقد الأخطاء:
 *   send()   → success/failure (لا throw)
 *   verify() → { verified } للنتائج العادية
 *           → THROW للأخطاء الخارجية (timeout, 5xx, network)
 *             حتى لا يُعاقب المستخدم على فشل المزود
 */
export class RoidNetOtpProvider implements DelegatedOtpProvider {
  private readonly logger = new Logger('RoidNetOtpProvider');

  readonly mode = 'DELEGATED' as const;
  readonly channel = 'WHATSAPP';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.apiKey = process.env.ROIDNET_API_KEY || '';
    this.baseUrl = process.env.ROIDNET_BASE_URL || 'https://api.roidnet.net';
    this.timeoutMs = parseInt(process.env.ROIDNET_TIMEOUT_MS || '10000', 10);

    if (!this.apiKey) {
      throw new Error(
        '❌ ROIDNET_API_KEY is required. Set it in .env (never in git).',
      );
    }

    this.logger.log(`RoidNet provider initialized → ${this.baseUrl}`);
  }

  // ─── Send OTP ──────────────────────────────────────────

  async send(phone: string): Promise<OtpSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(`RoidNet send failed: HTTP ${response.status} — ${body}`);
        return { success: false, error: `RoidNet HTTP ${response.status}` };
      }

      const data = await response.json() as Record<string, unknown>;
      const success = data.success === true;

      if (!success) {
        this.logger.error(`RoidNet send rejected: ${JSON.stringify(data)}`);
      }

      return { success, error: success ? undefined : String(data.message || 'unknown') };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`RoidNet send error: ${msg}`);
      return { success: false, error: `RoidNet connection error: ${msg}` };
    }
  }

  // ─── Verify OTP ────────────────────────────────────────
  //
  // ⚠️ عقد مهم:
  //   - كود خاطئ   → return { verified: false }   → OtpService يزيد attempts
  //   - timeout/5xx → THROW                       → OtpService لا يزيد attempts
  //

  async verify(phone: string, code: string): Promise<OtpVerifyResult> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/api/v1/otp/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ phone, code }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      // Network failure / timeout → THROW → no penalty
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`RoidNet verify network error: ${msg}`);
      throw new Error(`ROIDNET_VERIFY_NETWORK_ERROR: ${msg}`);
    }

    // HTTP 5xx → server error → THROW → no penalty
    if (response.status >= 500) {
      const body = await response.text().catch(() => '');
      this.logger.error(`RoidNet verify server error: HTTP ${response.status} — ${body}`);
      throw new Error(`ROIDNET_VERIFY_SERVER_ERROR: HTTP ${response.status}`);
    }

    // HTTP 2xx/4xx → parse response → verified or not
    let data: Record<string, unknown>;
    try {
      data = await response.json() as Record<string, unknown>;
    } catch {
      this.logger.error(`RoidNet verify: invalid JSON response`);
      throw new Error('ROIDNET_VERIFY_INVALID_RESPONSE');
    }

    const verified = data.verified === true;

    if (!verified) {
      this.logger.warn(`RoidNet verify: code rejected for ${phone}`);
    }

    return { verified };
  }
}
