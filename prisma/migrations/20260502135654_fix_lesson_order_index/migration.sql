-- حذف index القديم
DROP INDEX IF EXISTS lesson_templates_unit_order_idx;

-- إنشاء partial unique index
CREATE UNIQUE INDEX lesson_templates_unit_order_active_idx
ON lesson_templates (unit_id, order_index)
WHERE is_deleted = false;