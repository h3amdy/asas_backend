// src/public/student-registration/phone-rate-limiter.service.ts
import {
  Injectable,
  Inject,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RATE_LIMIT_STORAGE } from './phone-rate-limiter.interface';
import type { RateLimitStorage } from './phone-rate-limiter.interface';
import { REGISTRATION_ERRORS, REGISTRATION_CONFIG } from './registration.constants';

/**
 * خدمة تحديد معدل الطلبات برقم الهاتف لمسار complete-without-otp
 *
 * الخصائص الأمنية:
 * 1. تعمل مستقلاً تماماً عن مسار OTP الأصلي ولا تُنشئ سجلات في جدول otp_verifications.
 * 2. تُسجّل وتفحص المحاولة قبل الوصول إلى معاملة قاعدة البيانات وقبل الفحوصات الأخرى.
 * 3. تستمر في العمل حتى عند تفعيل OTP أو إلغائه دون أثر جانبي.
 * 4. ترمي 429 Too Many Requests مع الرمز الموحّد PHONE_RATE_LIMITED.
 */
@Injectable()
export class PhoneRateLimiterService {
  private readonly logger = new Logger('PhoneRateLimiterService');

  constructor(
    @Inject(RATE_LIMIT_STORAGE)
    private readonly storage: RateLimitStorage,
  ) {}

  /**
   * يتحقق من استهلاك حد المحاولات لرقم الهاتف ويزيد العداد
   * يرمي خطأ 429 Too Many Requests إذا تجاوز الحد
   *
   * @param normalizedPhone رقم الهاتف المُعيَّر بصيغة دولية (+967...)
   * @param limit الحد الأقصى للمحاولات (افتراضياً من REGISTRATION_CONFIG)
   * @param ttlSeconds مدة نافذة الحساب بالثواني (افتراضياً من REGISTRATION_CONFIG)
   */
  async checkRateLimit(
    normalizedPhone: string,
    limit = REGISTRATION_CONFIG.phoneRateLimitPerHour,
    ttlSeconds = REGISTRATION_CONFIG.phoneRateLimitTtlSeconds,
  ): Promise<void> {
    const key = `rate-limit:reg-phone:${normalizedPhone}`;
    const ttlMs = ttlSeconds * 1000;
    const { totalHits, timeToExpireMs } = await this.storage.increment(key, ttlMs);

    if (totalHits > limit) {
      const waitSeconds = Math.ceil(timeToExpireMs / 1000);
      this.logger.warn(
        `Rate limit exceeded for phone ${normalizedPhone}: ${totalHits}/${limit} hits. Window resets in ${waitSeconds}s`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: REGISTRATION_ERRORS.PHONE_RATE_LIMITED,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * إعادة تعيين العداد لرقم الهاتف (للاختبارات والتنظيف)
   */
  async reset(normalizedPhone: string): Promise<void> {
    const key = `rate-limit:reg-phone:${normalizedPhone}`;
    await this.storage.reset(key);
  }
}
