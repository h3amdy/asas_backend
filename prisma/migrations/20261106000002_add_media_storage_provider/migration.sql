-- VIDEO P4-1 / M2 — مزود التخزين لكل أصل وسائط
-- مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §3.1)
-- مهاجرة إضافية فقط: كل الأصول الحالية تصبح 'LOCAL' تلقائياً عبر القيمة الافتراضية،
-- فلا يتغير سلوك الصور والصوت والمستندات. القيمة 'R2' تُستخدم لاحقاً للفيديو فقط.
ALTER TABLE "media_assets"
  ADD COLUMN "storage_provider" TEXT NOT NULL DEFAULT 'LOCAL';

