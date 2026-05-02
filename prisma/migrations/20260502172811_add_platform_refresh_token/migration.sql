
-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "refresh_expires_at" TIMESTAMP(3),
ADD COLUMN     "refresh_token_hash" TEXT;


-- CreateIndex
CREATE UNIQUE INDEX "platform_users_refresh_token_hash_key" ON "platform_users"("refresh_token_hash");

