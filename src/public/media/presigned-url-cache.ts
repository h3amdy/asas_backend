// src/public/media/presigned-url-cache.ts
// ═══════════════════════════════════════════════════════════════
// B2 — كاش في الذاكرة للروابط الموقّعة لشعارات المدارس على R2
//  - كل رابط يُعاد استخدامه حتى 10 دقائق (أو نصف مدة صلاحيته إن كانت أقصر)
//  - حجم محدود؛ عند الامتلاء يُحذف الأقدم (ترتيب الإدراج في Map)
//  - المفتاح يتضمن etag النسخة فيُبطَل تلقائياً عند تغيير الشعار
//  ⚠️ لا تُسجَّل الروابط في أي سجل
// ═══════════════════════════════════════════════════════════════

export const PUBLIC_PRESIGNED_CACHE_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_PRESIGNED_CACHE_MAX_ENTRIES = 1000;

interface CachedPresignedUrl {
  url: string;
  /** انتهاء صلاحية الرابط نفسه في R2 */
  expiresAt: Date;
  /** آخر لحظة يُعاد فيها استخدام الرابط من الكاش */
  reuseUntilMs: number;
}

export class PresignedUrlCache {
  private readonly entries = new Map<string, CachedPresignedUrl>();

  constructor(
    private readonly windowMs = PUBLIC_PRESIGNED_CACHE_WINDOW_MS,
    private readonly maxEntries = PUBLIC_PRESIGNED_CACHE_MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): { url: string; expiresAt: Date } | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (this.now() >= hit.reuseUntilMs) {
      this.entries.delete(key);
      return null;
    }
    return { url: hit.url, expiresAt: hit.expiresAt };
  }

  set(key: string, value: { url: string; expiresAt: Date }): void {
    const nowMs = this.now();
    const lifetimeMs = value.expiresAt.getTime() - nowMs;
    if (lifetimeMs <= 0) return;
    // لا نعيد استخدام رابط لأكثر من نصف عمره، فيبقى أمام العميل نصف المدة على الأقل
    const reuseUntilMs = nowMs + Math.min(this.windowMs, lifetimeMs / 2);

    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest: string | undefined = this.entries.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { ...value, reuseUntilMs });
  }

  get size(): number {
    return this.entries.size;
  }
}
