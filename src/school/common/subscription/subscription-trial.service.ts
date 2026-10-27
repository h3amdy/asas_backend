// src/school/common/subscription/subscription-trial.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 🎫 خدمة إنشاء فترات التجربة — SRS-SUB-002 §3.3 + خطة التنفيذ §2.3.1
 *
 * تُستدعى داخل معاملة إنشاء الطالب (بعد tx.school.update وبعد إنشاء User).
 * الخدمة لا تُنشئ معاملتها الخاصة — تعمل ضمن معاملة المستدعي.
 */
@Injectable()
export class SubscriptionTrialService {
    private readonly logger = new Logger(SubscriptionTrialService.name);

    /**
     * إنشاء فترة تجربة لطالب جديد ضمن المعاملة.
     *
     * المتطلبات:
     * - صف المدرسة يجب أن يكون مقفلاً (tx.school.update سبق)
     * - المستخدم (userId) أُنشئ فعلاً في نفس المعاملة
     *
     * @returns true إذا أُنشئت فترة تجربة، false إذا لم تنطبق الشروط
     */
    async createTrialForNewStudentTx(
        tx: Prisma.TransactionClient,
        schoolId: number,
        userId: number,
        now: Date,
    ): Promise<boolean> {
        // 1. جلب إعدادات الاشتراك (بعد قفل صف المدرسة ← ترى آخر حالة مثبّتة)
        const settings = await tx.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: {
                isActivated: true,
                isTrialEnabled: true,
                trialDurationDays: true,
            },
        });

        // لا إعدادات أو غير مفعّل أو التجربة معطّلة → لا شيء
        if (!settings || !settings.isActivated || !settings.isTrialEnabled) {
            return false;
        }

        if (!settings.trialDurationDays || settings.trialDurationDays < 1) {
            this.logger.warn(
                `School ${schoolId}: trial enabled but trialDurationDays=${settings.trialDurationDays} — skipping`,
            );
            return false;
        }

        // 2. قفل advisory ثنائي — التزام SRS-004 §3.5
        await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock($1::int4, $2::int4)`,
            schoolId,
            userId,
        );

        // 3. إنشاء فترة TRIAL
        const expiresAt = new Date(now);
        expiresAt.setUTCDate(expiresAt.getUTCDate() + settings.trialDurationDays);

        await tx.studentAccessPeriod.create({
            data: {
                schoolId,
                studentUserId: userId,
                periodType: 'TRIAL',
                startedAt: now,
                expiresAt,
                // activationCodeId = null — CHECK constraint: TRIAL → no code
            },
        });

        return true;
    }

    /**
     * إنشاء فترات تجربة جماعية لكل طلاب المدرسة (عند تفعيل الاشتراك).
     *
     * تُستخدم فقط من معاملة التفعيل الأولى (POST /activate).
     * لا أقفال advisory فردية هنا — لا مسار PAID منافس قبل COMMIT.
     */
    async createBulkTrialsTx(
        tx: Prisma.TransactionClient,
        schoolId: number,
        trialDurationDays: number,
        now: Date,
    ): Promise<number> {
        // INSERT … SELECT لكل طالب غير محذوف في المدرسة
        // ⚠️ SQL خام: أسماء الأعمدة الفعلية (@map) لا أسماء حقول Prisma
        const result = await tx.$executeRaw`
            INSERT INTO "student_access_periods"
                ("school_id", "student_user_id", "period_type", "started_at", "expires_at", "created_at")
            SELECT
                ${schoolId},
                u.id,
                'TRIAL'::"AccessPeriodType",
                ${now}::timestamptz,
                ${now}::timestamptz + make_interval(days => ${trialDurationDays}::int),
                NOW()
            FROM "users" u
            WHERE u."school_id" = ${schoolId}
              AND u."user_type" = 'STUDENT'
              AND u."is_deleted" = false
        `;

        return result;
    }
}
