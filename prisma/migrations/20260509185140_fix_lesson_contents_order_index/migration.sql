DROP INDEX IF EXISTS lesson_contents_template_order_idx;

CREATE UNIQUE INDEX lesson_contents_template_order_active_idx
ON lesson_contents(template_id, order_index)
WHERE is_deleted = false;