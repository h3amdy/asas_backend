-- G2: OTP Verification for Student Self-Registration

-- CreateEnum: OtpPurpose
CREATE TYPE "OtpPurpose" AS ENUM ('STUDENT_REGISTRATION');

-- CreateEnum: OtpChannel
CREATE TYPE "OtpChannel" AS ENUM ('WHATSAPP', 'SMS');

-- CreateEnum: OtpStatus
CREATE TYPE "OtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'BLOCKED', 'FAILED');

-- CreateTable: otp_verifications
CREATE TABLE "otp_verifications" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "registration_request_id" TEXT NOT NULL,
    "registration_token_hash" TEXT,
    "registration_token_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "status" "OtpStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "otp_verifications_uuid_key" ON "otp_verifications"("uuid");
CREATE UNIQUE INDEX "otp_verifications_registration_request_id_key" ON "otp_verifications"("registration_request_id");
CREATE INDEX "otp_verifications_phone_purpose_status_idx" ON "otp_verifications"("phone", "purpose", "status");
CREATE INDEX "otp_verifications_expires_at_idx" ON "otp_verifications"("expires_at");
