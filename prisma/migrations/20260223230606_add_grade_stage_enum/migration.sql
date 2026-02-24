-- CreateEnum
CREATE TYPE "GradeStage" AS ENUM ('KG', 'BASIC', 'SECONDARY', 'OTHER');

-- AlterTable
ALTER TABLE "school_grades" ADD COLUMN     "stage" "GradeStage";
