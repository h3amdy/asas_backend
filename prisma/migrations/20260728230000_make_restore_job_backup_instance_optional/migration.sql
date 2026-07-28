-- AlterTable: make backup_instance_id optional in restore_jobs
-- بعد استعادة DB، النسخة المستخدمة قد لا تكون موجودة في الـ DB المستعادة
ALTER TABLE "restore_jobs" ALTER COLUMN "backup_instance_id" DROP NOT NULL;
