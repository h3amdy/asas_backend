-- VIDEO P4-1 / M1 — إضافة نوع الوسائط VIDEO
-- مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §3.1)
-- مهاجرة إضافية فقط: لا تمس أي صف قائم (IMAGE / AUDIO / DOCUMENT).
-- ملاحظة التراجع: لا تُحذف القيمة من enum في PostgreSQL؛ تُترك غير مستخدمة (§11.3).
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'VIDEO';

