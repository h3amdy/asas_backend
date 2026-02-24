/*
  Warnings:

  - The `stage` column on the `GradeDictionary` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "GradeDictionary" DROP COLUMN "stage",
ADD COLUMN     "stage" "GradeStage";
