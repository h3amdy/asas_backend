-- حذف الفهرس الخاطئ
DROP INDEX IF EXISTS units_subject_dict_order_idx;

-- إنشاء partial index الصحيح
CREATE UNIQUE INDEX units_subject_dict_order_active_idx
ON units (subject_dictionary_id, order_index)
WHERE is_deleted = false;