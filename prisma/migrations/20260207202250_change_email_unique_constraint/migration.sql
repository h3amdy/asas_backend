-- DropIndex
DROP INDEX "users_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "users_email_idx" ON "users"("email") WHERE "email" IS NOT NULL AND "is_deleted" = false;
