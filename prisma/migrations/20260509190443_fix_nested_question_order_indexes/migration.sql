DROP INDEX IF EXISTS ordering_items_order_idx;

CREATE UNIQUE INDEX ordering_items_order_active_idx
ON question_ordering_items(question_id, order_index)
WHERE is_deleted = false;


DROP INDEX IF EXISTS fill_blanks_question_order_idx;

CREATE UNIQUE INDEX fill_blanks_question_order_active_idx
ON question_fill_blanks(question_id, order_index)
WHERE is_deleted = false;