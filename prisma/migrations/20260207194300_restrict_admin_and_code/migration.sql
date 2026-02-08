-- Create unique index for user code per school
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_code_per_school
ON "users" ("school_id","code")
WHERE "school_id" IS NOT NULL AND "is_deleted" = false;

-- Create unique index for single admin per school
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_admin_per_school
ON "users" ("school_id")
WHERE "user_type"='ADMIN' AND "is_deleted"=false;