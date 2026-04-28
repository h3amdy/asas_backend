-- DropForeignKey
ALTER TABLE "media_upload_sessions" DROP CONSTRAINT "media_upload_sessions_school_id_fkey";

-- DropForeignKey
ALTER TABLE "media_upload_sessions" DROP CONSTRAINT "media_upload_sessions_uploader_user_id_fkey";

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "owner_type" TEXT NOT NULL DEFAULT 'SCHOOL';

-- AlterTable
ALTER TABLE "media_upload_sessions" ADD COLUMN     "owner_type" TEXT NOT NULL DEFAULT 'SCHOOL',
ADD COLUMN     "platform_user_id" INTEGER,
ALTER COLUMN "school_id" DROP NOT NULL,
ALTER COLUMN "uploader_user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "media_assets_owner_type_idx" ON "media_assets"("owner_type");

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
