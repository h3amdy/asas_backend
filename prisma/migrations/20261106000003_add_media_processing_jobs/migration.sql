-- VIDEO P4-1 / M3 — طابور معالجة الوسائط الدائم (PostgreSQL Queue)
-- مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §3.1, §5.1)
-- جدول جديد لا يقرؤه الكود الحالي. fencing_token يمنع العامل القديم من الكتابة
-- بعد استعادة المهمة (شروط Worker Fencing الأربعة تُطبق في P4-4).
-- ON DELETE RESTRICT: لا يُحذف صف media_assets ما دامت له مهام (دورة الحذف في P4-6).
CREATE TABLE "media_processing_jobs" (
  "id" SERIAL PRIMARY KEY,
  "uuid" TEXT NOT NULL,
  "media_asset_id" INTEGER NOT NULL,
  "job_type" VARCHAR(32) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(160) NOT NULL,
  "fencing_token" BIGINT NOT NULL DEFAULT 0,
  "payload_json" TEXT,
  "step_state_json" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_retry_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by" VARCHAR(120),
  "lease_until" TIMESTAMPTZ(3),
  "heartbeat_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "media_processing_jobs_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "media_processing_jobs_uuid_key" ON "media_processing_jobs"("uuid");
CREATE UNIQUE INDEX "media_processing_jobs_idempotency_key_key" ON "media_processing_jobs"("idempotency_key");
CREATE INDEX "media_jobs_claim_idx" ON "media_processing_jobs"("status", "next_retry_at");
CREATE INDEX "media_jobs_lease_idx" ON "media_processing_jobs"("status", "lease_until");
CREATE INDEX "media_jobs_asset_idx" ON "media_processing_jobs"("media_asset_id");

