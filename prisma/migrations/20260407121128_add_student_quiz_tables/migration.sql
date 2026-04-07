-- CreateTable
CREATE TABLE "student_lesson_progress" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "student_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "last_position" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_lesson_results" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "student_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "total_questions" INTEGER NOT NULL,
    "correct_questions" INTEGER NOT NULL,
    "total_points" DOUBLE PRECISION NOT NULL,
    "earned_points" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "grade_label" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_lesson_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_answers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "student_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "answer_value" TEXT NOT NULL,
    "correctness" TEXT NOT NULL,
    "is_correct" BOOLEAN,
    "score_awarded" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_lesson_progress_uuid_key" ON "student_lesson_progress"("uuid");

-- CreateIndex
CREATE INDEX "student_lesson_progress_student_idx" ON "student_lesson_progress"("student_id");

-- CreateIndex
CREATE INDEX "student_lesson_progress_lesson_idx" ON "student_lesson_progress"("lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_lesson_progress_unique" ON "student_lesson_progress"("student_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_lesson_results_uuid_key" ON "student_lesson_results"("uuid");

-- CreateIndex
CREATE INDEX "student_lesson_results_student_lesson_idx" ON "student_lesson_results"("student_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_answers_uuid_key" ON "student_answers"("uuid");

-- CreateIndex
CREATE INDEX "student_answers_student_question_idx" ON "student_answers"("student_id", "question_id");

-- CreateIndex
CREATE INDEX "student_answers_updated_idx" ON "student_answers"("updated_at");

-- AddForeignKey
ALTER TABLE "student_lesson_progress" ADD CONSTRAINT "student_lesson_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_lesson_progress" ADD CONSTRAINT "student_lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_lesson_results" ADD CONSTRAINT "student_lesson_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_lesson_results" ADD CONSTRAINT "student_lesson_results_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_answers" ADD CONSTRAINT "student_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
