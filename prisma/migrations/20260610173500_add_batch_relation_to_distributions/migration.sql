-- AlterTable: Add batch_id to content_distributions
ALTER TABLE "content_distributions" ADD COLUMN "batch_id" INTEGER;

-- AddForeignKey
ALTER TABLE "content_distributions" ADD CONSTRAINT "content_distributions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "distribution_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "content_distributions_batch_idx" ON "content_distributions"("batch_id");
