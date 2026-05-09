DROP INDEX IF EXISTS questions_template_order_idx;

CREATE UNIQUE INDEX questions_template_order_active_idx
ON questions(template_id, order_index)
WHERE is_deleted = false;