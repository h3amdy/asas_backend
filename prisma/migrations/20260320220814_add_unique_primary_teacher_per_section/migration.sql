-- إضافة قيد فريد جزئي: معلم رئيسي واحد فقط لكل (مادة + شعبة)
-- partial unique index: only active (non-deleted) records count

CREATE UNIQUE INDEX "subject_section_teachers_one_primary_idx"
    ON "subject_section_teachers" ("subject_section_id")
    WHERE "is_deleted" = false;
