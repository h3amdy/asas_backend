-- AlterTable: Add result_id column to student_answers
ALTER TABLE "student_answers" ADD COLUMN "result_id" INTEGER;

-- CreateIndex
CREATE INDEX "student_answers_result_idx" ON "student_answers"("result_id");

-- AddForeignKey
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "student_lesson_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop old index and add unique constraint
DROP INDEX IF EXISTS "student_answers_student_question_idx";
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_student_question_unique" UNIQUE ("student_id", "question_id");
