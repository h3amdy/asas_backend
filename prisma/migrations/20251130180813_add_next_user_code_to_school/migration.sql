/*
  Warnings:

  - You are about to drop the column `nextStaffCode` on the `School` table. All the data in the column will be lost.
  - You are about to drop the column `nextStudentCode` on the `School` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "School" DROP COLUMN "nextStaffCode",
DROP COLUMN "nextStudentCode",
ADD COLUMN     "nextUserCode" INTEGER NOT NULL DEFAULT 1;
