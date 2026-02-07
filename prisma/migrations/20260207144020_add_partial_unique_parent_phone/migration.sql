/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
-- SQL الصحيح والمتوافق مع الـ Mapping الخاص بك
CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_phone_per_school 
ON users (school_id, phone) 
WHERE user_type = 'PARENT' AND phone IS NOT NULL AND is_deleted = false;