-- CreateEnum
CREATE TYPE "SchoolBookSemester" AS ENUM ('FIRST', 'SECOND', 'FULL');

-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'DOCUMENT';

-- CreateTable
CREATE TABLE "school_books" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "subject_dictionary_id" INTEGER NOT NULL,
    "grade_dictionary_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "semester" "SchoolBookSemester" NOT NULL,
    "cover_media_asset_id" INTEGER,
    "pdf_media_asset_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "school_books_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_books_uuid_key" ON "school_books"("uuid");

-- CreateIndex
CREATE INDEX "school_books_subject_dict_idx" ON "school_books"("subject_dictionary_id");

-- CreateIndex
CREATE INDEX "school_books_grade_dict_idx" ON "school_books"("grade_dictionary_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_books_subject_grade_semester_title_key" ON "school_books"("subject_dictionary_id", "grade_dictionary_id", "semester", "title");

-- AddForeignKey
ALTER TABLE "school_books" ADD CONSTRAINT "school_books_subject_dictionary_id_fkey" FOREIGN KEY ("subject_dictionary_id") REFERENCES "subject_dictionary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_books" ADD CONSTRAINT "school_books_grade_dictionary_id_fkey" FOREIGN KEY ("grade_dictionary_id") REFERENCES "GradeDictionary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_books" ADD CONSTRAINT "school_books_cover_media_asset_id_fkey" FOREIGN KEY ("cover_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_books" ADD CONSTRAINT "school_books_pdf_media_asset_id_fkey" FOREIGN KEY ("pdf_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
