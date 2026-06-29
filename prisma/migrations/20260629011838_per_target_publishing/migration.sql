/*
  Warnings:

  - You are about to drop the column `delivered_at` on the `lessons` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "lessons_scheduled_lookup_idx";

-- AlterTable
ALTER TABLE "lesson_delivery_logs" ADD COLUMN     "target_id" INTEGER;

-- AlterTable
ALTER TABLE "lesson_targets" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "lesson_timetable_slots" ADD COLUMN     "target_id" INTEGER;

-- AlterTable
ALTER TABLE "lessons" DROP COLUMN "delivered_at";

-- CreateIndex (our new indexes only)
CREATE INDEX "lesson_delivery_logs_target_idx" ON "lesson_delivery_logs"("target_id");

-- CreateIndex
CREATE INDEX "lesson_targets_schedule_lookup_idx" ON "lesson_targets"("scheduled_at", "published_at");

-- CreateIndex
CREATE INDEX "lesson_timetable_slots_target_idx" ON "lesson_timetable_slots"("target_id");

-- AddForeignKey
ALTER TABLE "lesson_timetable_slots" ADD CONSTRAINT "lesson_timetable_slots_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "lesson_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_delivery_logs" ADD CONSTRAINT "lesson_delivery_logs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "lesson_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

