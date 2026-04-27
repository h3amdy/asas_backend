-- Migration: add_platform_content_support
-- Description: Enable Unit & LessonTemplate to support owner_type='PLATFORM'
-- Date: 2026-04-28

-- DropForeignKey (to recreate as nullable)
ALTER TABLE "lesson_templates" DROP CONSTRAINT "lesson_templates_school_id_fkey";
ALTER TABLE "lesson_templates" DROP CONSTRAINT "lesson_templates_subject_id_fkey";
ALTER TABLE "lesson_templates" DROP CONSTRAINT "lesson_templates_unit_id_fkey";
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_school_id_fkey";
ALTER TABLE "units" DROP CONSTRAINT "units_subject_id_fkey";

-- AlterTable: lesson_templates
ALTER TABLE "lesson_templates" ADD COLUMN "created_by_platform_user_id" INTEGER,
ADD COLUMN "subject_dictionary_id" INTEGER,
ALTER COLUMN "school_id" DROP NOT NULL,
ALTER COLUMN "subject_id" DROP NOT NULL,
ALTER COLUMN "unit_id" DROP NOT NULL;

-- AlterTable: media_assets
ALTER TABLE "media_assets" ALTER COLUMN "school_id" DROP NOT NULL;

-- AlterTable: units
ALTER TABLE "units" ADD COLUMN "subject_dictionary_id" INTEGER,
ALTER COLUMN "subject_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "lesson_templates_subject_dict_id_idx" ON "lesson_templates"("subject_dictionary_id");
CREATE INDEX "lesson_templates_owner_type_idx" ON "lesson_templates"("owner_type");
CREATE INDEX "units_subject_dict_id_idx" ON "units"("subject_dictionary_id");
CREATE INDEX "units_owner_type_idx" ON "units"("owner_type");
CREATE UNIQUE INDEX "units_subject_dict_order_idx" ON "units"("subject_dictionary_id", "order_index");

-- AddForeignKey (nullable)
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "units" ADD CONSTRAINT "units_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "units" ADD CONSTRAINT "units_subject_dictionary_id_fkey" FOREIGN KEY ("subject_dictionary_id") REFERENCES "subject_dictionary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_subject_dictionary_id_fkey" FOREIGN KEY ("subject_dictionary_id") REFERENCES "subject_dictionary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_created_by_platform_user_id_fkey" FOREIGN KEY ("created_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
