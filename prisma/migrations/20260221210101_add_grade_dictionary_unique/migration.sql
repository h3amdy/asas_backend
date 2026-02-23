-- إنشاء Partial Unique Index لمنع تكرار نفس الصف الرسمي في نفس المدرسة
CREATE UNIQUE INDEX "uq_school_dictionary_grade"
ON "school_grades" ("school_id", "dictionary_id")
WHERE "dictionary_id" IS NOT NULL AND "is_deleted" = false;