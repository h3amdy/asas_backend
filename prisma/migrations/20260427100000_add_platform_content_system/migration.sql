-- CreateEnum: PlatformRole
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN', 'PLATFORM_TEACHER');

-- CreateTable: platform_users
CREATE TABLE "platform_users" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "phone" TEXT,
    "role" "PlatformRole" NOT NULL DEFAULT 'PLATFORM_TEACHER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: platform_user_subjects
CREATE TABLE "platform_user_subjects" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "platform_user_id" INTEGER NOT NULL,
    "subject_dictionary_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "platform_user_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_logs
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "school_id" INTEGER,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: platform_users
CREATE UNIQUE INDEX "platform_users_uuid_key" ON "platform_users"("uuid");
CREATE UNIQUE INDEX "platform_users_username_key" ON "platform_users"("username");
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users"("email");

-- CreateIndex: platform_user_subjects
CREATE UNIQUE INDEX "platform_user_subjects_uuid_key" ON "platform_user_subjects"("uuid");
CREATE UNIQUE INDEX "platform_user_subjects_user_subject_key" ON "platform_user_subjects"("platform_user_id", "subject_dictionary_id");
CREATE INDEX "platform_user_subjects_user_id_idx" ON "platform_user_subjects"("platform_user_id");
CREATE INDEX "platform_user_subjects_subject_dict_idx" ON "platform_user_subjects"("subject_dictionary_id");

-- CreateIndex: audit_logs
CREATE UNIQUE INDEX "audit_logs_uuid_key" ON "audit_logs"("uuid");
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_school_idx" ON "audit_logs"("school_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey: platform_user_subjects -> platform_users
ALTER TABLE "platform_user_subjects" ADD CONSTRAINT "platform_user_subjects_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: platform_user_subjects -> subject_dictionary
ALTER TABLE "platform_user_subjects" ADD CONSTRAINT "platform_user_subjects_subject_dictionary_id_fkey" FOREIGN KEY ("subject_dictionary_id") REFERENCES "subject_dictionary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
