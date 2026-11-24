-- Add optional last_login_at column to users
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);

-- Backfill last_login_at from existing auth_sessions
UPDATE "users" u
SET "last_login_at" = s."max_created_at"
FROM (
  SELECT "user_id", MAX("created_at") AS "max_created_at"
  FROM "auth_sessions"
  GROUP BY "user_id"
) s
WHERE u."id" = s."user_id" AND u."last_login_at" IS NULL;

