-- CreateTable: lesson_content_blocks (فقرات محتوى الدرس)
CREATE TABLE "lesson_content_blocks" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "template_id" INTEGER NOT NULL,
    "title" TEXT,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lesson_block_items (عناصر الفقرة)
CREATE TABLE "lesson_block_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "block_id" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "text_content" TEXT,
    "media_asset_id" INTEGER,
    "caption" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_block_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_content_blocks_uuid_key" ON "lesson_content_blocks"("uuid");

-- CreateIndex
CREATE INDEX "lesson_content_blocks_template_order_idx" ON "lesson_content_blocks"("template_id", "is_deleted", "order_index");

-- CreateIndex
CREATE INDEX "lesson_content_blocks_template_id_idx" ON "lesson_content_blocks"("template_id");

-- CreateIndex
CREATE INDEX "lesson_content_blocks_updated_at_idx" ON "lesson_content_blocks"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_block_items_uuid_key" ON "lesson_block_items"("uuid");

-- CreateIndex
CREATE INDEX "lesson_block_items_block_order_idx" ON "lesson_block_items"("block_id", "is_deleted", "order_index");

-- CreateIndex
CREATE INDEX "lesson_block_items_block_id_idx" ON "lesson_block_items"("block_id");

-- CreateIndex
CREATE INDEX "lesson_block_items_media_asset_id_idx" ON "lesson_block_items"("media_asset_id");

-- CreateIndex
CREATE INDEX "lesson_block_items_updated_at_idx" ON "lesson_block_items"("updated_at");

-- AddForeignKey
ALTER TABLE "lesson_content_blocks" ADD CONSTRAINT "lesson_content_blocks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "lesson_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_block_items" ADD CONSTRAINT "lesson_block_items_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "lesson_content_blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_block_items" ADD CONSTRAINT "lesson_block_items_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
