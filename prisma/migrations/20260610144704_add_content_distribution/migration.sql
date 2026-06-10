
-- CreateEnum
CREATE TYPE "DistributionStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "lesson_templates" ADD COLUMN     "source_version" INTEGER;

-- CreateTable
CREATE TABLE "content_distributions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "source_lesson_template_id" INTEGER NOT NULL,
    "school_lesson_template_id" INTEGER,
    "status" "DistributionStatus" NOT NULL DEFAULT 'ACTIVE',
    "distributed_by_platform_user_id" INTEGER NOT NULL,
    "distributed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_batches" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "platform_user_id" INTEGER NOT NULL,
    "total_schools" INTEGER NOT NULL,
    "total_lessons" INTEGER NOT NULL,
    "distributed" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_distributions_uuid_key" ON "content_distributions"("uuid");

-- CreateIndex
CREATE INDEX "content_distributions_school_status_idx" ON "content_distributions"("school_id", "status");

-- CreateIndex
CREATE INDEX "content_distributions_source_idx" ON "content_distributions"("source_lesson_template_id");

-- CreateIndex
CREATE INDEX "content_distributions_target_idx" ON "content_distributions"("school_lesson_template_id");

-- CreateIndex
CREATE INDEX "content_distributions_updated_at_idx" ON "content_distributions"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_distributions_school_source_key" ON "content_distributions"("school_id", "source_lesson_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_batches_uuid_key" ON "distribution_batches"("uuid");

-- CreateIndex
CREATE INDEX "distribution_batches_user_idx" ON "distribution_batches"("platform_user_id");

-- CreateIndex
CREATE INDEX "distribution_batches_created_idx" ON "distribution_batches"("created_at");

-- AddForeignKey
ALTER TABLE "content_distributions" ADD CONSTRAINT "content_distributions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_distributions" ADD CONSTRAINT "content_distributions_source_lesson_template_id_fkey" FOREIGN KEY ("source_lesson_template_id") REFERENCES "lesson_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_distributions" ADD CONSTRAINT "content_distributions_school_lesson_template_id_fkey" FOREIGN KEY ("school_lesson_template_id") REFERENCES "lesson_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_distributions" ADD CONSTRAINT "content_distributions_distributed_by_platform_user_id_fkey" FOREIGN KEY ("distributed_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_batches" ADD CONSTRAINT "distribution_batches_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
