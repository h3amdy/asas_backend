-- DEC-026: تعديل الدرس المنشور — Revision Fields
-- إضافة contentRevision و questionsRevision على LessonTemplate
-- إضافة questionsRevisionAtSubmit على StudentLessonResult

-- LessonTemplate: نسخة المحتوى التعليمي (content blocks/items)
ALTER TABLE "lesson_templates"
ADD COLUMN "content_revision" INTEGER NOT NULL DEFAULT 1;

-- LessonTemplate: نسخة الأسئلة (questions)
ALTER TABLE "lesson_templates"
ADD COLUMN "questions_revision" INTEGER NOT NULL DEFAULT 1;

-- StudentLessonResult: نسخة الأسئلة التي بُنيت عليها النتيجة (provenance)
-- Nullable لأن النتائج التاريخية لا نعرف الـ revision التي بُنيت عليها
ALTER TABLE "student_lesson_results"
ADD COLUMN "questions_revision_at_submit" INTEGER;
