-- CreateTable
CREATE TABLE "lesson_templates" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL DEFAULT 'SCHOOL',
    "school_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "cover_media_asset_id" INTEGER,
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "source_template_id" INTEGER,
    "created_by_user_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_contents" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "template_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "media_asset_id" INTEGER,
    "content_text" TEXT,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_templates_uuid_key" ON "lesson_templates"("uuid");

-- CreateIndex
CREATE INDEX "lesson_templates_school_id_idx" ON "lesson_templates"("school_id");

-- CreateIndex
CREATE INDEX "lesson_templates_subject_id_idx" ON "lesson_templates"("subject_id");

-- CreateIndex
CREATE INDEX "lesson_templates_unit_id_idx" ON "lesson_templates"("unit_id");

-- CreateIndex
CREATE INDEX "lesson_templates_cover_idx" ON "lesson_templates"("cover_media_asset_id");

-- CreateIndex
CREATE INDEX "lesson_templates_source_idx" ON "lesson_templates"("source_template_id");

-- CreateIndex
CREATE INDEX "lesson_templates_updated_at_idx" ON "lesson_templates"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_templates_unit_order_idx" ON "lesson_templates"("unit_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_contents_uuid_key" ON "lesson_contents"("uuid");

-- CreateIndex
CREATE INDEX "lesson_contents_template_id_idx" ON "lesson_contents"("template_id");

-- CreateIndex
CREATE INDEX "lesson_contents_media_asset_id_idx" ON "lesson_contents"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_contents_template_order_idx" ON "lesson_contents"("template_id", "order_index");

-- AddForeignKey
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_cover_media_asset_id_fkey" FOREIGN KEY ("cover_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "lesson_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_templates" ADD CONSTRAINT "lesson_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_contents" ADD CONSTRAINT "lesson_contents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "lesson_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_contents" ADD CONSTRAINT "lesson_contents_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
