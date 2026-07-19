-- Release & App Management System (RAMS)
-- Migration: add_release_management
-- CreateEnum
CREATE TYPE "ManagedAppType" AS ENUM ('PUBLIC', 'PRIVATE', 'ADMIN_PANEL');

-- CreateEnum
CREATE TYPE "ManagedAppStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "UpdatePolicy" AS ENUM ('NONE', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('STABLE', 'BETA', 'INTERNAL');

-- CreateEnum
CREATE TYPE "DistributionChannelType" AS ENUM ('APK_DIRECT', 'GOOGLE_PLAY', 'APP_STORE', 'TESTFLIGHT');

-- CreateTable
CREATE TABLE "apps" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "app_type" "ManagedAppType" NOT NULL,
    "package_name" TEXT,
    "bundle_id" TEXT,
    "school_id" INTEGER,
    "platforms" "AppPlatform"[] DEFAULT ARRAY['ANDROID']::"AppPlatform"[],
    "status" "ManagedAppStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "app_id" INTEGER NOT NULL,
    "version_name" TEXT NOT NULL,
    "version_code" INTEGER NOT NULL,
    "build_number" INTEGER NOT NULL,
    "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "update_policy" "UpdatePolicy" NOT NULL DEFAULT 'OPTIONAL',
    "minimum_supported_version_code" INTEGER,
    "release_notes_ar" TEXT,
    "release_notes_en" TEXT,
    "checksum" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_distributions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "release_id" INTEGER NOT NULL,
    "channel_type" "DistributionChannelType" NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "download_url" TEXT NOT NULL,
    "file_size" BIGINT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_release_assignments" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "release_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_release_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_installations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "app_id" INTEGER,
    "app_code" TEXT NOT NULL,
    "package_name" TEXT,
    "current_version" TEXT NOT NULL,
    "current_build" INTEGER NOT NULL,
    "release_id" INTEGER,
    "os_version" TEXT,
    "device_model" TEXT,
    "school_id" INTEGER,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apps_uuid_key" ON "apps"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "apps_code_key" ON "apps"("code");

-- CreateIndex
CREATE INDEX "apps_school_id_idx" ON "apps"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "releases_uuid_key" ON "releases"("uuid");

-- CreateIndex
CREATE INDEX "releases_app_status_idx" ON "releases"("app_id", "status");

-- CreateIndex
CREATE INDEX "releases_published_at_idx" ON "releases"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "releases_app_version_code_key" ON "releases"("app_id", "version_code");

-- CreateIndex
CREATE UNIQUE INDEX "release_distributions_uuid_key" ON "release_distributions"("uuid");

-- CreateIndex
CREATE INDEX "release_distributions_release_idx" ON "release_distributions"("release_id");

-- CreateIndex
CREATE UNIQUE INDEX "release_distributions_unique_key" ON "release_distributions"("release_id", "channel_type", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "school_release_assignments_uuid_key" ON "school_release_assignments"("uuid");

-- CreateIndex
CREATE INDEX "school_release_assignments_school_idx" ON "school_release_assignments"("school_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "school_release_assignments_unique_key" ON "school_release_assignments"("school_id", "release_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_installations_uuid_key" ON "device_installations"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "device_installations_installation_id_key" ON "device_installations"("installation_id");

-- CreateIndex
CREATE INDEX "device_installations_app_id_idx" ON "device_installations"("app_id");

-- CreateIndex
CREATE INDEX "device_installations_app_code_idx" ON "device_installations"("app_code");

-- CreateIndex
CREATE INDEX "device_installations_build_idx" ON "device_installations"("current_build");

-- CreateIndex
CREATE INDEX "device_installations_last_seen_idx" ON "device_installations"("last_seen_at");

-- CreateIndex
CREATE INDEX "device_installations_school_idx" ON "device_installations"("school_id");

-- AddForeignKey
ALTER TABLE "apps" ADD CONSTRAINT "apps_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_distributions" ADD CONSTRAINT "release_distributions_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_release_assignments" ADD CONSTRAINT "school_release_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_release_assignments" ADD CONSTRAINT "school_release_assignments_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
