-- CreateTable
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "owner_type" TEXT NOT NULL DEFAULT 'SCHOOL',
    "school_id" INTEGER,
    "title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_uuid_key" ON "units"("uuid");

-- CreateIndex
CREATE INDEX "units_subject_id_idx" ON "units"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_subject_order_idx" ON "units"("subject_id", "order_index");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
