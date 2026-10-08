// src/shared/otp/providers/roidnet-otp.provider.ts
import { Logger } from '@nestjs/common';
import * as https from 'https';
import type { DelegatedOtpProvider, OtpSendResult, OtpVerifyResult } from './otp-provider.interface';

/**
 * 🌐 RoidNet WhatsApp OTP Provider — Delegated
 *
 * يستخدم Node.js https module بدل fetch بسبب
 * مشكلة توافق بين undici (fetch) و Cloudflare.
 *
 * عقد الأخطاء:
 *   send()   → success/failure (لا throw)
 *   verify() → { verified } للنتائج العادية
 *           → THROW للأخطاء الخارجية (timeout, 5xx, network)
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
    this.baseUrl = process.env.ROIDNET_BASE_URL || 'https://otp.roidnet.com';
    this.timeoutMs = parseInt(process.env.ROIDNET_TIMEOUT_MS || '15000', 10);

    if (!this.apiKey) {
      throw new Error(
        '❌ ROIDNET_API_KEY is required. Set it in .env (never in git).',
      );
    }

    this.logger.log(`RoidNet provider initialized → ${this.baseUrl}`);
  }

  // ─── HTTP Helper ───────────────────────────────────────

  private request(path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const jsonBody = JSON.stringify(body);
      const url = new URL(path, this.baseUrl);

      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'Content-Length': Buffer.byteLength(jsonBody),
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(responseBody) as Record<string, unknown>;
            resolve({ status: res.statusCode ?? 0, data });
          } catch {
            reject(new Error(`ROIDNET_INVALID_JSON: ${responseBody.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`ROIDNET_NETWORK_ERROR: ${err.message}`));
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy();
        reject(new Error(`ROIDNET_TIMEOUT: ${this.timeoutMs}ms`));
      });

      req.write(jsonBody);
      req.end();
    });
  }

  // ─── Send OTP ──────────────────────────────────────────

  async send(phone: string): Promise<OtpSendResult> {
    try {
      const { status, data } = await this.request('/api/v1/otp/send', { phone });

      if (status >= 400) {
        this.logger.error(`RoidNet send failed: HTTP ${status} — ${JSON.stringify(data)}`);
        return { success: false, error: `RoidNet HTTP ${status}` };
      }

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
    let status: number;
    let data: Record<string, unknown>;

    try {
      const result = await this.request('/api/v1/otp/verify', { phone, code });
      status = result.status;
      data = result.data;
    } catch (error: unknown) {
      // Network failure / timeout → THROW → no penalty
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`RoidNet verify network error: ${msg}`);
      throw new Error(`ROIDNET_VERIFY_NETWORK_ERROR: ${msg}`);
    }

    // HTTP 5xx → server error → THROW → no penalty
    if (status >= 500) {
      this.logger.error(`RoidNet verify server error: HTTP ${status} — ${JSON.stringify(data)}`);
      throw new Error(`ROIDNET_VERIFY_SERVER_ERROR: HTTP ${status}`);
    }

    // HTTP 2xx/4xx → verified or not
    const verified = data.verified === true;

    if (!verified) {
      this.logger.warn(`RoidNet verify: code rejected for ${phone}`);
    }

    return { verified };
  }
}
