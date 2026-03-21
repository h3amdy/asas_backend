-- AlterTable
ALTER TABLE "timetables" ADD COLUMN     "publish_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PUBLISHED';
