/*
  Warnings:

  - A unique constraint covering the columns `[template_id,order_index]` on the table `lesson_contents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[unit_id,order_index]` on the table `lesson_templates` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[question_id,order_index]` on the table `question_fill_blanks` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[question_id,order_index]` on the table `question_ordering_items` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[template_id,order_index]` on the table `questions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[subject_id,order_index]` on the table `units` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[subject_dictionary_id,order_index]` on the table `units` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "lesson_contents_template_order_idx" ON "lesson_contents"("template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_templates_unit_order_idx" ON "lesson_templates"("unit_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "fill_blanks_question_order_idx" ON "question_fill_blanks"("question_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "ordering_items_order_idx" ON "question_ordering_items"("question_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "questions_template_order_idx" ON "questions"("template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "units_subject_order_idx" ON "units"("subject_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "units_subject_dict_order_idx" ON "units"("subject_dictionary_id", "order_index");
