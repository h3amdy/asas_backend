/**
 * Phase 3 — Verification Script
 * 
 * DEC-026: التحقق من أن Content mutations تعمل بشكل صحيح
 * 
 * يجب تشغيله بعد deploy على بيئة بها بيانات.
 * 
 * التحققات:
 * 1. contentRevision يزيد +1 عند content mutation
 * 2. questionsRevision لا يتغير عند content mutation
 * 3. Lesson.updatedAt يتغير للـ Lessons غير ARCHIVED وغير المحذوفة
 * 4. Lesson.updatedAt لا يتغير لـ ARCHIVED
 * 5. Lesson.updatedAt لا يتغير لـ isDeleted=true
 * 6. الذرية: mutation + revision + updatedAt في transaction واحدة
 */

-- ═══════════════════════════════════════════════════════
-- 1. إعداد البيانات الأولية — اختبار على template موجود
-- ═══════════════════════════════════════════════════════

-- جلب template مع أسئلة ودروس للتحقق
-- (استبدل UUID بـ UUID حقيقي من النظام)

-- التحقق من القيم الحالية قبل أي تعديل:
SELECT 
    lt.id,
    lt.uuid,
    lt.title,
    lt.content_revision,
    lt.questions_revision,
    lt.template_version
FROM lesson_templates lt
WHERE lt.is_deleted = false
ORDER BY lt.updated_at DESC
LIMIT 5;

-- ═══════════════════════════════════════════════════════
-- 2. تحقق: Lessons المرتبطة وحالاتها
-- ═══════════════════════════════════════════════════════

-- للـ template الذي سنختبر عليه (استبدل TEMPLATE_ID):
-- SELECT 
--     l.id,
--     l.status,
--     l.is_deleted,
--     l.updated_at
-- FROM lessons l
-- WHERE l.template_id = TEMPLATE_ID
-- ORDER BY l.id;

-- ═══════════════════════════════════════════════════════
-- 3. بعد تنفيذ updateBlock (عبر API):
-- ═══════════════════════════════════════════════════════

-- التوقع:
-- content_revision = القيمة السابقة + 1
-- questions_revision = القيمة السابقة (بدون تغيير)
-- template_version = القيمة السابقة (بدون تغيير)

-- SELECT 
--     lt.content_revision,
--     lt.questions_revision,
--     lt.template_version
-- FROM lesson_templates lt
-- WHERE lt.id = TEMPLATE_ID;

-- ═══════════════════════════════════════════════════════
-- 4. تحقق: Lesson.updatedAt
-- ═══════════════════════════════════════════════════════

-- التوقع:
-- Non-ARCHIVED + Non-deleted → updatedAt تغيّر
-- ARCHIVED → updatedAt لم يتغيّر
-- isDeleted=true → updatedAt لم يتغيّر

-- SELECT 
--     l.id,
--     l.status,
--     l.is_deleted,
--     l.updated_at,
--     CASE 
--         WHEN l.status = 'ARCHIVED' THEN 'SHOULD NOT CHANGE'
--         WHEN l.is_deleted = true THEN 'SHOULD NOT CHANGE'
--         ELSE 'SHOULD CHANGE'
--     END as expectation
-- FROM lessons l
-- WHERE l.template_id = TEMPLATE_ID
-- ORDER BY l.id;

-- ═══════════════════════════════════════════════════════
-- 5. تحقق سريع: لا يوجد template بـ revision < 1
-- ═══════════════════════════════════════════════════════

SELECT 
    COUNT(*) as invalid_content_revision
FROM lesson_templates
WHERE content_revision < 1;
-- Expected: 0

SELECT 
    COUNT(*) as invalid_questions_revision
FROM lesson_templates
WHERE questions_revision < 1;
-- Expected: 0

-- ═══════════════════════════════════════════════════════
-- 6. تحقق: أن questionsRevision لم يتغير بعد content mutation
-- ═══════════════════════════════════════════════════════

-- قبل أي content mutation:
-- SELECT questions_revision FROM lesson_templates WHERE id = TEMPLATE_ID;
-- → مثلاً: 1

-- بعد عدة content mutations (createBlock, updateBlockItem, etc):
-- SELECT questions_revision FROM lesson_templates WHERE id = TEMPLATE_ID;
-- → يجب أن يبقى: 1
