-- SEC-NUM-01: إنشاء جدول تتبع محاولات الدخول الفاشلة وقفل الحساب الذري
-- ترحيل إضافي بحت (Additive-Only) — لا يمس جداول users أو auth_sessions أو user_code_ranges

BEGIN;

CREATE TABLE "login_attempt_states" (
    "id"                SERIAL         NOT NULL,
    "code_hash"         VARCHAR(64)    NOT NULL,
    "ip_hash"           VARCHAR(64)    NOT NULL DEFAULT '',
    "failed_count"      INTEGER        NOT NULL DEFAULT 0,
    "lock_tier"         INTEGER        NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_failed_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_failed_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until"      TIMESTAMPTZ(3),
    "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_attempt_states_failed_count_chk" CHECK ("failed_count" >= 0),
    CONSTRAINT "login_attempt_states_lock_tier_chk" CHECK ("lock_tier" >= 0 AND "lock_tier" <= 4)
);

CREATE UNIQUE INDEX "login_attempt_states_code_hash_ip_hash_key"
    ON "login_attempt_states"("code_hash", "ip_hash");

CREATE INDEX "login_attempt_states_locked_until_idx"
    ON "login_attempt_states"("locked_until");

CREATE INDEX "login_attempt_states_last_failed_at_idx"
    ON "login_attempt_states"("last_failed_at");

CREATE INDEX "login_attempt_states_updated_at_idx"
    ON "login_attempt_states"("updated_at");

COMMIT;

