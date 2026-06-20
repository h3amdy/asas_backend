
-- CreateTable
CREATE TABLE "processed_client_changes" (
    "id" SERIAL NOT NULL,
    "client_change_uuid" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_uuid" TEXT NOT NULL,
    "student_id" INTEGER NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_client_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_client_changes_client_change_uuid_key" ON "processed_client_changes"("client_change_uuid");

-- CreateIndex
CREATE INDEX "processed_client_changes_date_idx" ON "processed_client_changes"("processed_at");

-- CreateIndex
CREATE INDEX "processed_client_changes_student_idx" ON "processed_client_changes"("student_id");

-- CreateIndex
CREATE INDEX "lesson_content_blocks_sync_cursor_idx" ON "lesson_content_blocks"("updated_at", "uuid");



-- CreateIndex
CREATE INDEX "lessons_sync_cursor_idx" ON "lessons"("updated_at", "uuid");



-- CreateIndex
CREATE INDEX "questions_sync_cursor_idx" ON "questions"("updated_at", "uuid");



-- CreateIndex
CREATE INDEX "student_answers_sync_cursor_idx" ON "student_answers"("student_id", "updated_at", "uuid");

-- CreateIndex
CREATE INDEX "student_progress_sync_cursor_idx" ON "student_lesson_progress"("student_id", "updated_at", "uuid");

-- CreateIndex
CREATE INDEX "subjects_sync_cursor_idx" ON "subjects"("updated_at", "uuid");


