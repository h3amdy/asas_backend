-- CreateTable
CREATE TABLE "lessons" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "template_id" INTEGER NOT NULL,
    "school_id" INTEGER NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "year_id" INTEGER NOT NULL,
    "term_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "delivery_method" TEXT,
    "link_type" TEXT NOT NULL DEFAULT 'ADDITIONAL',
    "published_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_targets" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "section_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_timetable_slots" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "timetable_slot_id" INTEGER NOT NULL,
    "week_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_delivery_logs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "policy_at_time" TEXT,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lessons_uuid_key" ON "lessons"("uuid");

-- CreateIndex
CREATE INDEX "lessons_template_id_idx" ON "lessons"("template_id");

-- CreateIndex
CREATE INDEX "lessons_school_id_idx" ON "lessons"("school_id");

-- CreateIndex
CREATE INDEX "lessons_teacher_id_idx" ON "lessons"("teacher_id");

-- CreateIndex
CREATE INDEX "lessons_subject_id_idx" ON "lessons"("subject_id");

-- CreateIndex
CREATE INDEX "lessons_year_term_idx" ON "lessons"("year_id", "term_id");

-- CreateIndex
CREATE INDEX "lessons_status_idx" ON "lessons"("status");

-- CreateIndex
CREATE INDEX "lessons_updated_at_idx" ON "lessons"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_targets_uuid_key" ON "lesson_targets"("uuid");

-- CreateIndex
CREATE INDEX "lesson_targets_section_id_idx" ON "lesson_targets"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_targets_lesson_section_key" ON "lesson_targets"("lesson_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_timetable_slots_uuid_key" ON "lesson_timetable_slots"("uuid");

-- CreateIndex
CREATE INDEX "lesson_timetable_slots_slot_idx" ON "lesson_timetable_slots"("timetable_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_timetable_slots_unique_key" ON "lesson_timetable_slots"("lesson_id", "timetable_slot_id", "week_date");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_delivery_logs_uuid_key" ON "lesson_delivery_logs"("uuid");

-- CreateIndex
CREATE INDEX "lesson_delivery_logs_lesson_idx" ON "lesson_delivery_logs"("lesson_id");

-- CreateIndex
CREATE INDEX "lesson_delivery_logs_actor_idx" ON "lesson_delivery_logs"("actor_user_id");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "lesson_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_targets" ADD CONSTRAINT "lesson_targets_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_targets" ADD CONSTRAINT "lesson_targets_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_timetable_slots" ADD CONSTRAINT "lesson_timetable_slots_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_timetable_slots" ADD CONSTRAINT "lesson_timetable_slots_timetable_slot_id_fkey" FOREIGN KEY ("timetable_slot_id") REFERENCES "timetable_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_delivery_logs" ADD CONSTRAINT "lesson_delivery_logs_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_delivery_logs" ADD CONSTRAINT "lesson_delivery_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
