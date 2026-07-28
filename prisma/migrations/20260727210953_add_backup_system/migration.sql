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
-- CreateEnum
CREATE TYPE "BackupScheduleType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "BackupTriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_RESTORE');

-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupInstanceStatus" AS ENUM ('SUCCESS', 'PARTIAL_SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupCategory" AS ENUM ('NORMAL', 'SYSTEM_SAFETY');

-- CreateEnum
CREATE TYPE "RestoreJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'ROLLBACK_COMPLETED', 'CRITICAL_FAILURE');

-- CreateEnum
CREATE TYPE "BackupLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "BackupLogPhase" AS ENUM ('PREFLIGHT', 'DB_DUMP', 'MEDIA_COPY', 'CONFIG_COPY', 'MANIFEST', 'COMPRESS', 'CHECKSUM', 'ACTIVATE', 'CLEANUP', 'RETENTION', 'RESTORE_VALIDATE', 'RESTORE_SAFETY', 'RESTORE_DB', 'RESTORE_MEDIA', 'RESTORE_CONFIG', 'RESTORE_VERIFY', 'RESTORE_ROLLBACK');

-- CreateTable
CREATE TABLE "backup_plans" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_type" "BackupScheduleType" NOT NULL DEFAULT 'DAILY',
    "run_time" TEXT NOT NULL DEFAULT '02:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Aden',
    "storage_type" TEXT NOT NULL DEFAULT 'LOCAL',
    "storage_path" TEXT NOT NULL DEFAULT '/var/backups/mafhooom',
    "max_backups" INTEGER NOT NULL DEFAULT 30,
    "max_age_days" INTEGER NOT NULL DEFAULT 90,
    "auto_cleanup" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "plan_id" INTEGER,
    "backup_instance_id" INTEGER,
    "status" "BackupJobStatus" NOT NULL DEFAULT 'PENDING',
    "triggered_by" "BackupTriggerType" NOT NULL,
    "error_message" TEXT,
    "initiated_by_user_uuid" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_instances" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "plan_id" INTEGER,
    "backup_name" TEXT NOT NULL,
    "backup_type" TEXT NOT NULL DEFAULT 'FULL',
    "category" "BackupCategory" NOT NULL DEFAULT 'NORMAL',
    "status" "BackupInstanceStatus" NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'LOCAL',
    "package_version" TEXT NOT NULL DEFAULT '1.0',
    "system_version" TEXT,
    "database_schema_version" TEXT,
    "contains_database" BOOLEAN NOT NULL DEFAULT true,
    "contains_media" BOOLEAN NOT NULL DEFAULT true,
    "contains_configuration" BOOLEAN NOT NULL DEFAULT true,
    "db_size_bytes" BIGINT,
    "media_files_count" INTEGER,
    "media_files_copied" INTEGER,
    "media_size_bytes" BIGINT,
    "config_size_bytes" BIGINT,
    "missing_media" JSONB,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_restored_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "backup_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_jobs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "backup_instance_id" INTEGER NOT NULL,
    "status" "RestoreJobStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "restore_database" BOOLEAN NOT NULL DEFAULT true,
    "restore_media" BOOLEAN NOT NULL DEFAULT true,
    "restore_configuration" BOOLEAN NOT NULL DEFAULT true,
    "safety_backup_id" INTEGER,
    "initiated_by_user_uuid" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_logs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "backup_job_id" INTEGER,
    "restore_job_id" INTEGER,
    "level" "BackupLogLevel" NOT NULL,
    "phase" "BackupLogPhase" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "backup_plans_uuid_key" ON "backup_plans"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "backup_jobs_uuid_key" ON "backup_jobs"("uuid");

-- CreateIndex
CREATE INDEX "backup_jobs_status_idx" ON "backup_jobs"("status");

-- CreateIndex
CREATE INDEX "backup_jobs_created_at_idx" ON "backup_jobs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_instances_uuid_key" ON "backup_instances"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "backup_instances_backup_name_key" ON "backup_instances"("backup_name");

-- CreateIndex
CREATE INDEX "backup_instances_status_idx" ON "backup_instances"("status");

-- CreateIndex
CREATE INDEX "backup_instances_created_at_idx" ON "backup_instances"("created_at");

-- CreateIndex
CREATE INDEX "backup_instances_category_idx" ON "backup_instances"("category");

-- CreateIndex
CREATE UNIQUE INDEX "restore_jobs_uuid_key" ON "restore_jobs"("uuid");

-- CreateIndex
CREATE INDEX "restore_jobs_status_idx" ON "restore_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "backup_logs_uuid_key" ON "backup_logs"("uuid");

-- CreateIndex
CREATE INDEX "backup_logs_job_idx" ON "backup_logs"("backup_job_id");

-- CreateIndex
CREATE INDEX "backup_logs_restore_idx" ON "backup_logs"("restore_job_id");



-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "backup_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_backup_instance_id_fkey" FOREIGN KEY ("backup_instance_id") REFERENCES "backup_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_instances" ADD CONSTRAINT "backup_instances_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "backup_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_jobs" ADD CONSTRAINT "restore_jobs_backup_instance_id_fkey" FOREIGN KEY ("backup_instance_id") REFERENCES "backup_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_jobs" ADD CONSTRAINT "restore_jobs_safety_backup_id_fkey" FOREIGN KEY ("safety_backup_id") REFERENCES "backup_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_logs" ADD CONSTRAINT "backup_logs_backup_job_id_fkey" FOREIGN KEY ("backup_job_id") REFERENCES "backup_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_logs" ADD CONSTRAINT "backup_logs_restore_job_id_fkey" FOREIGN KEY ("restore_job_id") REFERENCES "restore_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
