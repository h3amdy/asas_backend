-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PROMOTED', 'REPEATED', 'TRANSFERRED_OUT', 'DROPPED');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('SUPERVISE');

-- CreateEnum
CREATE TYPE "SubjectSectionRole" AS ENUM ('PRIMARY', 'ASSISTANT');

-- CreateTable
CREATE TABLE "years" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "year_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_grades" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "dictionary_id" INTEGER,
    "display_name" TEXT NOT NULL,
    "short_name" TEXT,
    "sort_order" INTEGER NOT NULL,
    "is_local" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "school_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "grade_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "user_id" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "birth_date" DATE,

    CONSTRAINT "students_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "parents" (
    "user_id" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,

    CONSTRAINT "parents_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "user_id" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "hire_date" DATE,
    "is_supervisor" BOOLEAN NOT NULL DEFAULT false,
    "specialization" TEXT,
    "qualification" TEXT,
    "experience" TEXT,
    "notes" TEXT,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "student_id" INTEGER NOT NULL,
    "year_id" INTEGER NOT NULL,
    "grade_id" INTEGER NOT NULL,
    "section_id" INTEGER NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" DATE,
    "left_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_students" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "parent_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "parent_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_scopes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "grade_id" INTEGER NOT NULL,
    "section_id" INTEGER,
    "scope_type" "ScopeType" NOT NULL DEFAULT 'SUPERVISE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "teacher_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_extra_permissions" (
    "teacher_id" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "can_manage_subjects" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_timetable" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_students" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_parents" BOOLEAN NOT NULL DEFAULT false,
    "can_view_reports" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "teacher_extra_permissions_pkey" PRIMARY KEY ("teacher_id")
);

-- CreateTable
CREATE TABLE "subject_dictionary" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "grade_dictionary_id" INTEGER NOT NULL,
    "code" TEXT,
    "default_name" TEXT NOT NULL,
    "short_name" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "cover_media_asset_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subject_dictionary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "grade_id" INTEGER NOT NULL,
    "dictionary_id" INTEGER,
    "display_name" TEXT NOT NULL,
    "short_name" TEXT,
    "cover_media_asset_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_sections" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "section_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subject_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_section_teachers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "subject_section_id" INTEGER NOT NULL,
    "teacher_id" INTEGER NOT NULL,
    "role" "SubjectSectionRole" DEFAULT 'PRIMARY',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subject_section_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "years_uuid_key" ON "years"("uuid");

-- CreateIndex
CREATE INDEX "years_school_id_idx" ON "years"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_uuid_key" ON "terms"("uuid");

-- CreateIndex
CREATE INDEX "terms_year_id_idx" ON "terms"("year_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_grades_uuid_key" ON "school_grades"("uuid");

-- CreateIndex
CREATE INDEX "school_grades_school_id_idx" ON "school_grades"("school_id");

-- CreateIndex
CREATE INDEX "school_grades_dictionary_id_idx" ON "school_grades"("dictionary_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_uuid_key" ON "sections"("uuid");

-- CreateIndex
CREATE INDEX "sections_grade_id_idx" ON "sections"("grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_uuid_key" ON "students"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "parents_uuid_key" ON "parents"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_uuid_key" ON "teachers"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_uuid_key" ON "student_enrollments"("uuid");

-- CreateIndex
CREATE INDEX "student_enrollments_student_current_idx" ON "student_enrollments"("student_id", "is_current");

-- CreateIndex
CREATE INDEX "student_enrollments_year_section_idx" ON "student_enrollments"("year_id", "section_id");

-- CreateIndex
CREATE INDEX "student_enrollments_updated_at_idx" ON "student_enrollments"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_student_year_key" ON "student_enrollments"("student_id", "year_id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_students_uuid_key" ON "parent_students"("uuid");

-- CreateIndex
CREATE INDEX "parent_students_parent_deleted_idx" ON "parent_students"("parent_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "parent_students_parent_student_key" ON "parent_students"("parent_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_scopes_uuid_key" ON "teacher_scopes"("uuid");

-- CreateIndex
CREATE INDEX "teacher_scopes_teacher_updated_idx" ON "teacher_scopes"("teacher_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_extra_permissions_uuid_key" ON "teacher_extra_permissions"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "subject_dictionary_uuid_key" ON "subject_dictionary"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "subject_dictionary_code_key" ON "subject_dictionary"("code");

-- CreateIndex
CREATE INDEX "subject_dictionary_grade_sort_idx" ON "subject_dictionary"("grade_dictionary_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_uuid_key" ON "subjects"("uuid");

-- CreateIndex
CREATE INDEX "subjects_school_grade_idx" ON "subjects"("school_id", "grade_id");

-- CreateIndex
CREATE INDEX "subjects_dictionary_id_idx" ON "subjects"("dictionary_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_sections_uuid_key" ON "subject_sections"("uuid");

-- CreateIndex
CREATE INDEX "subject_sections_updated_at_idx" ON "subject_sections"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "subject_sections_subject_section_key" ON "subject_sections"("subject_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_section_teachers_uuid_key" ON "subject_section_teachers"("uuid");

-- CreateIndex
CREATE INDEX "subject_section_teachers_teacher_updated_idx" ON "subject_section_teachers"("teacher_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "subject_section_teachers_ss_teacher_key" ON "subject_section_teachers"("subject_section_id", "teacher_id");

-- AddForeignKey
ALTER TABLE "years" ADD CONSTRAINT "years_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_grades" ADD CONSTRAINT "school_grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_grades" ADD CONSTRAINT "school_grades_dictionary_id_fkey" FOREIGN KEY ("dictionary_id") REFERENCES "GradeDictionary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "school_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parents" ADD CONSTRAINT "parents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "school_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_students" ADD CONSTRAINT "parent_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_scopes" ADD CONSTRAINT "teacher_scopes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_scopes" ADD CONSTRAINT "teacher_scopes_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "school_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_scopes" ADD CONSTRAINT "teacher_scopes_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_extra_permissions" ADD CONSTRAINT "teacher_extra_permissions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_dictionary" ADD CONSTRAINT "subject_dictionary_grade_dictionary_id_fkey" FOREIGN KEY ("grade_dictionary_id") REFERENCES "GradeDictionary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "school_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_dictionary_id_fkey" FOREIGN KEY ("dictionary_id") REFERENCES "subject_dictionary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_sections" ADD CONSTRAINT "subject_sections_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_sections" ADD CONSTRAINT "subject_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_section_teachers" ADD CONSTRAINT "subject_section_teachers_subject_section_id_fkey" FOREIGN KEY ("subject_section_id") REFERENCES "subject_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_section_teachers" ADD CONSTRAINT "subject_section_teachers_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Year: سنة حالية واحدة لكل مدرسة
CREATE UNIQUE INDEX IF NOT EXISTS years_one_current_per_school
ON years (school_id)
WHERE is_current = true AND is_deleted = false;

-- Term: فصل حالي واحد لكل سنة
CREATE UNIQUE INDEX IF NOT EXISTS terms_one_current_per_year
ON terms (year_id)
WHERE is_current = true AND is_deleted = false;

-- Term: منع تكرار الترتيب
CREATE UNIQUE INDEX IF NOT EXISTS terms_unique_order_per_year
ON terms (year_id, order_index)
WHERE is_deleted = false;

-- Grade: منع تكرار الاسم
CREATE UNIQUE INDEX IF NOT EXISTS grades_unique_name_per_school
ON school_grades (school_id, display_name)
WHERE is_deleted = false;

-- Section: منع تكرار الاسم داخل الصف
CREATE UNIQUE INDEX IF NOT EXISTS sections_unique_name_per_grade
ON sections (grade_id, name)
WHERE is_deleted = false;

-- Section: منع تكرار الترتيب
CREATE UNIQUE INDEX IF NOT EXISTS sections_unique_order_per_grade
ON sections (grade_id, order_index)
WHERE is_deleted = false;