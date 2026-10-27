// src/school/common/guards/subscription.guard.ts
//
// SRS-SUB-005 §3.4 — حارس الاشتراك (طبقة الخادم)
//
// يُمرَّر فقط إذا:
//  1. المستخدم ليس طالباً (مدير/معلم) → ✅
//  2. المدرسة لم تفعّل الاشتراكات → ✅
//  3. الطالب لديه فترة وصول سارية (TRIAL أو PAID) → ✅
//
// وإلا → 403 مع error_code يميّز الحالة.

import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** رموز الخطأ المتفق عليها مع Flutter (SRS-SUB-005 §5.2) */
export const SUB_ERROR = {
    SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
    SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
} as const;

@Injectable()
export class SubscriptionGuard implements CanActivate {
    private readonly logger = new Logger(SubscriptionGuard.name);

    constructor(private readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<any>();

        // ── 1. فقط الطلاب يُفحصون ──
        // ut قد يكون STUDENT (مباشر) أو أن ParentStudentContextGuard
        // حوّلته إلى STUDENT (ولي أمر يتصفح كطالب).
        const userType = req.user?.ut ?? req.user?.originalUt;
        if (userType !== 'STUDENT') return true;

        const schoolId: number | undefined = req.schoolContext?.id;
        const studentUuid: string | undefined = req.user?.sub;
        if (!schoolId || !studentUuid) return true; // حراس سابقة ستمنع هذا

        // ── 2. هل الاشتراكات مفعّلة؟ ──
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: { isActivated: true },
        });

        if (!settings?.isActivated) {
            // مدرسة مجانية → كل المحتوى متاح
            return true;
        }

        // ── 3. هل يملك فترة وصول سارية؟ ──
        const now = new Date();
        const student = await this.prisma.user.findFirst({
            where: { uuid: studentUuid, schoolId, userType: 'STUDENT', isDeleted: false },
            select: { id: true },
        });

        if (!student) {
            // طالب محذوف — حراس أخرى ستلحق هذا عادةً
            throw new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED);
        }

        const activePeriod = await this.prisma.studentAccessPeriod.findFirst({
            where: {
                schoolId,
                studentUserId: student.id,
                endedEarlyAt: null,
                expiresAt: { gt: now },
            },
            select: { id: true },
        });

        if (activePeriod) return true;

        // ── 4. لا وصول — نميّز بين «لم يشترك أبداً» و«انتهى» ──
        const anyPeriod = await this.prisma.studentAccessPeriod.findFirst({
            where: { schoolId, studentUserId: student.id },
            select: { id: true },
        });

        const errorCode = anyPeriod
            ? SUB_ERROR.SUBSCRIPTION_EXPIRED
            : SUB_ERROR.SUBSCRIPTION_REQUIRED;

        this.logger.warn(
            `🔒 [${errorCode}] student=${studentUuid} school=${schoolId}`,
        );

        throw new ForbiddenException(errorCode);
    }
}
