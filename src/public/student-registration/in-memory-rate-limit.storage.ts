// src/public/student-registration/in-memory-rate-limit.storage.ts
import { Injectable } from '@nestjs/common';
import { RateLimitStorage, RateLimitRecord } from './phone-rate-limiter.interface';

/**
 * 📦 مخزن Rate Limiting داخل ذاكرة العملية الواحدة (In-Memory Map)
 *
 * الخصائص:
 * 1. سرعة فائقة ولا يتطلب خادماً خارجياً أو جداول جديدة في قاعدة البيانات.
 * 2. يعمل لكل Node.js process على حدة.
 * 3. يحتوي على آلية تنظيف دورية (cleanup) لمنع تسرب الذاكرة.
 *
 * 🚀 للترقية إلى بيئة متعددة العمليات (Cluster / Multi-instance) مستقبلاً:
 * - يتم استبدال هذا المزود بـ RedisRateLimitStorage الذي يطبق نفس واجهة RateLimitStorage.
 * - التبديل يتم عبر NestJS Module DI دون المساس بأي من الـ Services أو الـ Controllers.
 */
@Injectable()
export class InMemoryRateLimitStorage implements RateLimitStorage {
  private readonly storage = new Map<string, RateLimitRecord>();

  async increment(
    key: string,
    ttlMs: number,
  ): Promise<{ totalHits: number; timeToExpireMs: number }> {
    const now = Date.now();
    const existing = this.storage.get(key);

    if (!existing || existing.expiresAt <= now) {
      const record: RateLimitRecord = {
        totalHits: 1,
        expiresAt: now + ttlMs,
      };
      this.storage.set(key, record);
      return { totalHits: 1, timeToExpireMs: ttlMs };
    }

    existing.totalHits += 1;
    return {
      totalHits: existing.totalHits,
      timeToExpireMs: Math.max(0, existing.expiresAt - now),
    };
  }

  async reset(key: string): Promise<void> {
    this.storage.delete(key);
  }

  /**
   * تنظيف السجلات منتهية الصلاحية
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.storage.entries()) {
      if (record.expiresAt <= now) {
        this.storage.delete(key);
      }
    }
  }

  /**
   * إفراغ المخزن بالكامل (للاختبارات)
   */
  clear(): void {
    this.storage.clear();
  }
}
