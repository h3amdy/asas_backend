/*
  Warnings:

  - You are about to drop the column `logoMediaAssetId` on the `School` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'AUDIO');

-- CreateEnum
CREATE TYPE "MediaUploadStatus" AS ENUM ('INITIATED', 'UPLOADING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'ERROR');

-- AlterTable
ALTER TABLE "School" DROP COLUMN "logoMediaAssetId",
ADD COLUMN     "logo_media_asset_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_media_asset_id" INTEGER;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storage_key" TEXT,
    "original_url" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "etag" TEXT,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_sec" INTEGER,
    "variants_json" TEXT,
    "preferred_variant" TEXT,
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_upload_sessions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "media_asset_id" INTEGER NOT NULL,
    "school_id" INTEGER NOT NULL,
    "uploader_user_id" INTEGER NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "content_type" TEXT NOT NULL,
    "total_size_bytes" BIGINT,
    "chunk_size_bytes" INTEGER NOT NULL,
    "status" "MediaUploadStatus" NOT NULL DEFAULT 'INITIATED',
    "bytes_received" BIGINT NOT NULL DEFAULT 0,
    "last_chunk_at" TIMESTAMP(3),
    "temp_storage_key" TEXT,
    "requested_variants_json" TEXT,
    "processing_status" "ProcessingStatus",
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "canceled_at" TIMESTAMP(3),

    CONSTRAINT "media_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_uuid_key" ON "media_assets"("uuid");

-- CreateIndex
CREATE INDEX "media_assets_school_id_idx" ON "media_assets"("school_id");

-- CreateIndex
CREATE INDEX "media_assets_kind_idx" ON "media_assets"("kind");

-- CreateIndex
CREATE INDEX "media_assets_updated_at_idx" ON "media_assets"("updated_at");

-- CreateIndex
CREATE INDEX "media_assets_school_updated_idx" ON "media_assets"("school_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_upload_sessions_uuid_key" ON "media_upload_sessions"("uuid");

-- CreateIndex
CREATE INDEX "media_upload_sessions_school_id_idx" ON "media_upload_sessions"("school_id");

-- CreateIndex
CREATE INDEX "media_upload_sessions_uploader_idx" ON "media_upload_sessions"("uploader_user_id", "created_at");

-- CreateIndex
CREATE INDEX "media_upload_sessions_status_expires_idx" ON "media_upload_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "media_upload_sessions_asset_id_idx" ON "media_upload_sessions"("media_asset_id");

-- CreateIndex
CREATE INDEX "media_upload_sessions_updated_at_idx" ON "media_upload_sessions"("updated_at");

-- CreateIndex
CREATE INDEX "users_avatar_media_asset_id_idx" ON "users"("avatar_media_asset_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_asset_id_fkey" FOREIGN KEY ("avatar_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_logo_media_asset_id_fkey" FOREIGN KEY ("logo_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_dictionary" ADD CONSTRAINT "subject_dictionary_cover_media_asset_id_fkey" FOREIGN KEY ("cover_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_cover_media_asset_id_fkey" FOREIGN KEY ("cover_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
