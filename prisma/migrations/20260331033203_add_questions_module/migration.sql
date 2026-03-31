-- CreateTable
CREATE TABLE "questions" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "template_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "question_text" TEXT,
    "question_image_asset_id" INTEGER,
    "question_audio_asset_id" INTEGER,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "explanation_text" TEXT,
    "explanation_image_asset_id" INTEGER,
    "explanation_audio_asset_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "question_id" INTEGER NOT NULL,
    "option_text" TEXT,
    "image_asset_id" INTEGER,
    "audio_asset_id" INTEGER,
    "is_correct" BOOLEAN NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_matching_pairs" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "question_id" INTEGER NOT NULL,
    "left_text" TEXT,
    "left_image_asset_id" INTEGER,
    "left_audio_asset_id" INTEGER,
    "right_text" TEXT,
    "right_image_asset_id" INTEGER,
    "right_audio_asset_id" INTEGER,
    "pair_key" TEXT NOT NULL,
    "left_order_index" INTEGER,
    "right_order_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "question_matching_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_ordering_items" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "question_id" INTEGER NOT NULL,
    "item_text" TEXT,
    "image_asset_id" INTEGER,
    "audio_asset_id" INTEGER,
    "correct_index" INTEGER NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "question_ordering_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_fill_blanks" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "question_id" INTEGER NOT NULL,
    "blank_key" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "placeholder" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "question_fill_blanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_fill_answers" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "question_id" INTEGER NOT NULL,
    "blank_key" TEXT NOT NULL,
    "answer_text" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "question_fill_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "questions_uuid_key" ON "questions"("uuid");

-- CreateIndex
CREATE INDEX "questions_template_id_idx" ON "questions"("template_id");

-- CreateIndex
CREATE INDEX "questions_question_image_idx" ON "questions"("question_image_asset_id");

-- CreateIndex
CREATE INDEX "questions_question_audio_idx" ON "questions"("question_audio_asset_id");

-- CreateIndex
CREATE INDEX "questions_explanation_image_idx" ON "questions"("explanation_image_asset_id");

-- CreateIndex
CREATE INDEX "questions_explanation_audio_idx" ON "questions"("explanation_audio_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_template_order_idx" ON "questions"("template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_uuid_key" ON "question_options"("uuid");

-- CreateIndex
CREATE INDEX "question_options_question_id_idx" ON "question_options"("question_id");

-- CreateIndex
CREATE INDEX "question_options_image_idx" ON "question_options"("image_asset_id");

-- CreateIndex
CREATE INDEX "question_options_audio_idx" ON "question_options"("audio_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_matching_pairs_uuid_key" ON "question_matching_pairs"("uuid");

-- CreateIndex
CREATE INDEX "matching_pairs_question_id_idx" ON "question_matching_pairs"("question_id");

-- CreateIndex
CREATE INDEX "matching_pairs_left_image_idx" ON "question_matching_pairs"("left_image_asset_id");

-- CreateIndex
CREATE INDEX "matching_pairs_left_audio_idx" ON "question_matching_pairs"("left_audio_asset_id");

-- CreateIndex
CREATE INDEX "matching_pairs_right_image_idx" ON "question_matching_pairs"("right_image_asset_id");

-- CreateIndex
CREATE INDEX "matching_pairs_right_audio_idx" ON "question_matching_pairs"("right_audio_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "matching_pairs_question_pair_key_idx" ON "question_matching_pairs"("question_id", "pair_key");

-- CreateIndex
CREATE UNIQUE INDEX "question_ordering_items_uuid_key" ON "question_ordering_items"("uuid");

-- CreateIndex
CREATE INDEX "ordering_items_question_id_idx" ON "question_ordering_items"("question_id");

-- CreateIndex
CREATE INDEX "ordering_items_image_idx" ON "question_ordering_items"("image_asset_id");

-- CreateIndex
CREATE INDEX "ordering_items_audio_idx" ON "question_ordering_items"("audio_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordering_items_correct_idx" ON "question_ordering_items"("question_id", "correct_index");

-- CreateIndex
CREATE UNIQUE INDEX "ordering_items_order_idx" ON "question_ordering_items"("question_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "question_fill_blanks_uuid_key" ON "question_fill_blanks"("uuid");

-- CreateIndex
CREATE INDEX "fill_blanks_question_id_idx" ON "question_fill_blanks"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "fill_blanks_question_key_idx" ON "question_fill_blanks"("question_id", "blank_key");

-- CreateIndex
CREATE UNIQUE INDEX "fill_blanks_question_order_idx" ON "question_fill_blanks"("question_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "question_fill_answers_uuid_key" ON "question_fill_answers"("uuid");

-- CreateIndex
CREATE INDEX "fill_answers_question_key_idx" ON "question_fill_answers"("question_id", "blank_key");

-- CreateIndex
CREATE UNIQUE INDEX "fill_answers_unique_idx" ON "question_fill_answers"("question_id", "blank_key", "answer_text");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "lesson_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_question_image_asset_id_fkey" FOREIGN KEY ("question_image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_question_audio_asset_id_fkey" FOREIGN KEY ("question_audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_explanation_image_asset_id_fkey" FOREIGN KEY ("explanation_image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_explanation_audio_asset_id_fkey" FOREIGN KEY ("explanation_audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_matching_pairs" ADD CONSTRAINT "question_matching_pairs_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_matching_pairs" ADD CONSTRAINT "question_matching_pairs_left_image_asset_id_fkey" FOREIGN KEY ("left_image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_matching_pairs" ADD CONSTRAINT "question_matching_pairs_left_audio_asset_id_fkey" FOREIGN KEY ("left_audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_matching_pairs" ADD CONSTRAINT "question_matching_pairs_right_image_asset_id_fkey" FOREIGN KEY ("right_image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_matching_pairs" ADD CONSTRAINT "question_matching_pairs_right_audio_asset_id_fkey" FOREIGN KEY ("right_audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_ordering_items" ADD CONSTRAINT "question_ordering_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_ordering_items" ADD CONSTRAINT "question_ordering_items_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_ordering_items" ADD CONSTRAINT "question_ordering_items_audio_asset_id_fkey" FOREIGN KEY ("audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_fill_blanks" ADD CONSTRAINT "question_fill_blanks_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_fill_answers" ADD CONSTRAINT "question_fill_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
