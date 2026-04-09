-- Step 1: Add result_id column
ALTER TABLE "student_answers" ADD COLUMN IF NOT EXISTS "result_id" INTEGER;

-- Step 2: Add index on result_id
CREATE INDEX IF NOT EXISTS "student_answers_result_idx" ON "student_answers"("result_id");

-- Step 3: Add FK for result_id
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "student_lesson_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Remove duplicate answers — keep only the LATEST answer per (student_id, question_id)
DELETE FROM "student_answers" a
USING "student_answers" b
WHERE a."student_id" = b."student_id"
  AND a."question_id" = b."question_id"
  AND a."id" < b."id";

-- Step 5: Drop old index if exists
DROP INDEX IF EXISTS "student_answers_student_question_idx";

-- Step 6: Add unique constraint
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_student_question_unique" UNIQUE ("student_id", "question_id");
