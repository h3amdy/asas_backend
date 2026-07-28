-- ══════════════════════════════════════════════════════════════
-- Migration: إصلاح storage_key للسجلات القديمة
-- المشكلة: processImage() حذفت original.jpg وأنشأت original.webp
--          لكن لم تحدّث storage_key في DB
-- ══════════════════════════════════════════════════════════════

-- 1. عرض السجلات المتأثرة (للتأكد قبل التنفيذ)
SELECT COUNT(*) AS affected_count
FROM media_assets
WHERE (storage_key LIKE '%.jpg' OR storage_key LIKE '%.png' OR storage_key LIKE '%.jpeg')
  AND is_deleted = false;

-- 2. تحديث storage_key: jpg/png/jpeg → webp
UPDATE media_assets
SET
    storage_key = regexp_replace(storage_key, '\.(jpg|jpeg|png)$', '.webp'),
    content_type = 'image/webp',
    preferred_variant = COALESCE(preferred_variant, 'original'),
    updated_at = NOW()
WHERE (storage_key LIKE '%.jpg' OR storage_key LIKE '%.png' OR storage_key LIKE '%.jpeg')
  AND is_deleted = false;

-- 3. التحقق بعد التحديث
SELECT
    CASE
        WHEN storage_key LIKE '%.webp' THEN 'webp'
        WHEN storage_key LIKE '%.jpg' THEN 'jpg'
        WHEN storage_key LIKE '%.png' THEN 'png'
        WHEN storage_key LIKE '%.mp3' THEN 'mp3'
        WHEN storage_key LIKE '%.wav' THEN 'wav'
        ELSE 'other'
    END AS ext,
    COUNT(*)
FROM media_assets
WHERE is_deleted = false
GROUP BY 1
ORDER BY 2 DESC;
