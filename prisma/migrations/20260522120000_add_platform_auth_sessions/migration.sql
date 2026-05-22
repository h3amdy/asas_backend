-- DropIndex
DROP INDEX "platform_users_refresh_token_hash_key";

-- AlterTable: Remove refresh token fields from platform_users
ALTER TABLE "platform_users" DROP COLUMN "refresh_expires_at",
DROP COLUMN "refresh_token_hash";

-- CreateTable: platform_auth_sessions
CREATE TABLE "platform_auth_sessions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "platform_user_id" INTEGER NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" "RevokeReason",

    CONSTRAINT "platform_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_auth_sessions_uuid_key" ON "platform_auth_sessions"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "platform_auth_sessions_refresh_token_hash_key" ON "platform_auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "platform_auth_sessions_user_id_idx" ON "platform_auth_sessions"("platform_user_id");

-- CreateIndex
CREATE INDEX "platform_auth_sessions_revoked_at_idx" ON "platform_auth_sessions"("revoked_at");

-- AddForeignKey
ALTER TABLE "platform_auth_sessions" ADD CONSTRAINT "platform_auth_sessions_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
