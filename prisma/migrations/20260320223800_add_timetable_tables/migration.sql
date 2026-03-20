-- ADM-060/061: إنشاء جداول الحصص (Section-level timetable)

-- جدول الجداول — واحد لكل شعبة + سنة + فصل
CREATE TABLE "timetables" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "section_id" INTEGER NOT NULL,
    "year_id" INTEGER NOT NULL,
    "term_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "timetables_pkey" PRIMARY KEY ("id")
);

-- حصص الجدول — يوم + رقم حصة + مادة
CREATE TABLE "timetable_slots" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "timetable_id" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "lesson_number" INTEGER NOT NULL,
    "subject_section_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX "timetables_uuid_key" ON "timetables"("uuid");
CREATE UNIQUE INDEX "timetables_section_year_term_key" ON "timetables"("section_id", "year_id", "term_id");
CREATE INDEX "timetables_year_term_idx" ON "timetables"("year_id", "term_id");

CREATE UNIQUE INDEX "timetable_slots_uuid_key" ON "timetable_slots"("uuid");
CREATE UNIQUE INDEX "timetable_slots_unique_slot_key" ON "timetable_slots"("timetable_id", "weekday", "lesson_number");
CREATE INDEX "timetable_slots_subject_section_idx" ON "timetable_slots"("subject_section_id");

-- Foreign keys
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_timetable_id_fkey" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_subject_section_id_fkey" FOREIGN KEY ("subject_section_id") REFERENCES "subject_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
