/*
  Warnings:

  - A unique constraint covering the columns `[user_id,device_fingerprint]` on the table `user_devices` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "user_devices_device_fingerprint_key";

-- DropIndex
DROP INDEX "user_devices_push_token_key";

-- CreateIndex
CREATE INDEX "user_devices_push_token_idx" ON "user_devices"("push_token");

-- CreateIndex
CREATE INDEX "user_devices_device_fp_idx" ON "user_devices"("device_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_device_fp_key" ON "user_devices"("user_id", "device_fingerprint");
