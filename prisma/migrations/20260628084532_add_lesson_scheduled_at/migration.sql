
-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "lessons_scheduled_lookup_idx" ON "lessons"("status", "scheduled_at");
