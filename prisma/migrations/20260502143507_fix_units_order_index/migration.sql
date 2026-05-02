-- حذف الفهرس القديم
DROP INDEX IF EXISTS units_subject_order_idx;

-- إنشاء partial unique index
CREATE UNIQUE INDEX units_subject_order_active_idx
ON units (subject_id, order_index)
WHERE is_deleted = false;