-- CreateEnum
CREATE TYPE "AccessPeriodType" AS ENUM ('TRIAL', 'PAID');

-- CreateEnum
CREATE TYPE "ActivationCodeStatus" AS ENUM ('UNUSED', 'USED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED_BUSINESS', 'FAILED_TRANSIENT', 'EXPIRED');


-- CreateTable
CREATE TABLE "school_subscription_settings" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "is_activated" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMP(3),
    "is_trial_enabled" BOOLEAN NOT NULL DEFAULT true,
    "trial_duration_days" INTEGER,
    "subscription_price" DECIMAL(12,2),
    "contact_number" TEXT,
    "next_code_serial" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_subscription_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_payment_methods" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "payment_details" TEXT NOT NULL,
    "instructions" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_access_periods" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "student_user_id" INTEGER NOT NULL,
    "period_type" "AccessPeriodType" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_early_at" TIMESTAMP(3),
    "activation_code_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_access_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_code_batches" (
    "id" SERIAL NOT NULL,
    "uuid" UUID NOT NULL,
    "school_id" INTEGER NOT NULL,
    "code_count" INTEGER NOT NULL,
    "serial_start" INTEGER NOT NULL,
    "serial_end" INTEGER NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_code_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_codes" (
    "id" SERIAL NOT NULL,
    "uuid" UUID NOT NULL,
    "school_id" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "serial_number" INTEGER NOT NULL,
    "code_ciphertext" BYTEA NOT NULL,
    "code_lookup_hash" TEXT NOT NULL,
    "enc_key_version" INTEGER NOT NULL,
    "hmac_key_version" INTEGER NOT NULL,
    "status" "ActivationCodeStatus" NOT NULL DEFAULT 'UNUSED',
    "consumed_at" TIMESTAMP(3),
    "consumed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_audit_events" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" INTEGER,
    "target_user_id" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "idempotency_key" UUID NOT NULL,
    "school_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL,
    "response_status_code" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("idempotency_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_subscription_settings_school_id_key" ON "school_subscription_settings"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_payment_methods_uuid_key" ON "school_payment_methods"("uuid");

-- CreateIndex
CREATE INDEX "school_payment_methods_school_active_idx" ON "school_payment_methods"("school_id", "is_deleted", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "student_access_periods_activation_code_id_key" ON "student_access_periods"("activation_code_id");

-- CreateIndex
CREATE INDEX "student_access_periods_school_student_type_idx" ON "student_access_periods"("school_id", "student_user_id", "period_type");

-- CreateIndex
CREATE INDEX "student_access_periods_student_idx" ON "student_access_periods"("student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_access_periods_code_school_key" ON "student_access_periods"("activation_code_id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "activation_code_batches_uuid_key" ON "activation_code_batches"("uuid");

-- CreateIndex
CREATE INDEX "activation_code_batches_school_created_idx" ON "activation_code_batches"("school_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activation_code_batches_id_school_key" ON "activation_code_batches"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "activation_codes_uuid_key" ON "activation_codes"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "activation_codes_code_lookup_hash_key" ON "activation_codes"("code_lookup_hash");

-- CreateIndex
CREATE INDEX "activation_codes_batch_status_serial_idx" ON "activation_codes"("batch_id", "status", "serial_number");

-- CreateIndex
CREATE INDEX "activation_codes_consumer_idx" ON "activation_codes"("consumed_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "activation_codes_school_serial_key" ON "activation_codes"("school_id", "serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "activation_codes_id_school_key" ON "activation_codes"("id", "school_id");

-- CreateIndex
CREATE INDEX "subscription_audit_events_school_created_idx" ON "subscription_audit_events"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_audit_events_type_idx" ON "subscription_audit_events"("event_type");

-- CreateIndex
CREATE INDEX "idempotency_records_status_created_idx" ON "idempotency_records"("status", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_status_idx" ON "idempotency_records"("expires_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_contents_template_order_idx" ON "lesson_contents"("template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_templates_unit_order_idx" ON "lesson_templates"("unit_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "fill_blanks_question_order_idx" ON "question_fill_blanks"("question_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "ordering_items_order_idx" ON "question_ordering_items"("question_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "questions_template_order_idx" ON "questions"("template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "units_subject_order_idx" ON "units"("subject_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "units_subject_dict_order_idx" ON "units"("subject_dictionary_id", "order_index");


-- AddForeignKey
ALTER TABLE "school_subscription_settings" ADD CONSTRAINT "school_subscription_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_payment_methods" ADD CONSTRAINT "school_payment_methods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_access_periods" ADD CONSTRAINT "student_access_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_access_periods" ADD CONSTRAINT "student_access_periods_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_access_periods" ADD CONSTRAINT "student_access_periods_activation_code_id_school_id_fkey" FOREIGN KEY ("activation_code_id", "school_id") REFERENCES "activation_codes"("id", "school_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "activation_code_batches" ADD CONSTRAINT "activation_code_batches_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_code_batches" ADD CONSTRAINT "activation_code_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_batch_id_school_id_fkey" FOREIGN KEY ("batch_id", "school_id") REFERENCES "activation_code_batches"("id", "school_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_consumed_by_user_id_fkey" FOREIGN KEY ("consumed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════
-- CHECK constraints — مضافة يدوياً (Prisma لا يدعمها في المخطط)
-- المرجع: SRS-SUB-002 §3، SUB-IMPLEMENTATION-PLAN v1.1 §1.1
-- ═══════════════════════════════════════════════════════════════

-- school_subscription_settings
ALTER TABLE "school_subscription_settings"
  ADD CONSTRAINT "sss_activated_requires_fields_chk"
  CHECK (is_activated = false
         OR (subscription_price IS NOT NULL AND contact_number IS NOT NULL AND activated_at IS NOT NULL));

ALTER TABLE "school_subscription_settings"
  ADD CONSTRAINT "sss_trial_duration_chk"
  CHECK (is_trial_enabled = false
         OR (trial_duration_days IS NOT NULL AND trial_duration_days BETWEEN 1 AND 90));

ALTER TABLE "school_subscription_settings"
  ADD CONSTRAINT "sss_price_positive_chk"
  CHECK (subscription_price IS NULL OR subscription_price > 0);

ALTER TABLE "school_subscription_settings"
  ADD CONSTRAINT "sss_next_serial_chk"
  CHECK (next_code_serial >= 1);

-- student_access_periods
ALTER TABLE "student_access_periods"
  ADD CONSTRAINT "sap_type_code_chk"
  CHECK ((period_type = 'TRIAL' AND activation_code_id IS NULL)
         OR (period_type = 'PAID' AND activation_code_id IS NOT NULL));

ALTER TABLE "student_access_periods"
  ADD CONSTRAINT "sap_expires_after_start_chk"
  CHECK (expires_at > started_at);

ALTER TABLE "student_access_periods"
  ADD CONSTRAINT "sap_ended_early_range_chk"
  CHECK (ended_early_at IS NULL OR ended_early_at >= started_at);

-- activation_code_batches
ALTER TABLE "activation_code_batches"
  ADD CONSTRAINT "acb_count_range_chk"
  CHECK (code_count BETWEEN 1 AND 1000);

ALTER TABLE "activation_code_batches"
  ADD CONSTRAINT "acb_serial_range_chk"
  CHECK (serial_start >= 1 AND serial_end = serial_start + code_count - 1);

-- activation_codes
ALTER TABLE "activation_codes"
  ADD CONSTRAINT "ac_status_consumer_chk"
  CHECK ((status = 'UNUSED' AND consumed_at IS NULL AND consumed_by_user_id IS NULL)
         OR (status = 'USED' AND consumed_at IS NOT NULL AND consumed_by_user_id IS NOT NULL));

ALTER TABLE "activation_codes"
  ADD CONSTRAINT "ac_serial_positive_chk"
  CHECK (serial_number >= 1);

-- school_payment_methods
ALTER TABLE "school_payment_methods"
  ADD CONSTRAINT "spm_deleted_consistency_chk"
  CHECK ((is_deleted = false AND deleted_at IS NULL) OR (is_deleted = true AND deleted_at IS NOT NULL));
