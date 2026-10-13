// src/public/student-registration/phone-rate-limiter.interface.ts

/**
 * سجل حد المعدل في الذاكرة أو المخزن المشترك
 */
export interface RateLimitRecord {
  /** إجمالي المحاولات في النافذة الحالية */
  totalHits: number;
  /** توقيت انتهاء صلاحية النافذة بالمللي ثانية */
  expiresAt: number;
}

/**
 * واجهة تجريد لمخزن Rate Limiting
 * تتيح التبديل السلس بين In-Memory (المستخدم حالياً) و Redis (عند التوسع مستقبلاً)
 * دون تعديل منطق التطبيق أو كسر الكود.
 */
export interface RateLimitStorage {
  /**
   * زيادة العداد لمفتاح معين داخل نافذة زمنية
   * إذا لم يكن المفتاح موجوداً أو انتهت نافذته، يُنشئ نافذة جديدة بقيمة 1
   *
   * @param key المفتاح الفريد (مثل: `rate-limit:phone:+967...`)
   * @param ttlMs مدة صلاحية النافذة بالمللي ثانية
   * @returns { totalHits: number; timeToExpireMs: number }
   */
  increment(key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpireMs: number }>;

  /**
   * حذف السجل أو إعادة ضبط العداد للمفتاح (للتنظيف والاختبارات)
   */
  reset(key: string): Promise<void>;
}

export const RATE_LIMIT_STORAGE = 'RATE_LIMIT_STORAGE';
