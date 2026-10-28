// src/school/student/subscription/student-subscription.service.ts
import {
    Injectable, Logger, ForbiddenException, ConflictException,
    BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IdempotencyService } from '../../common/subscription/idempotency.service';
import { CodeHmacService } from '../../manager/subscription/crypto/code-hmac.service';
import { ActivateCodeDto } from './dto/activate-code.dto';

/**
 * 🎫 خدمة اشتراك الطالب — المرحلة 6
 *
 * - GET /my-status — حالة الاشتراك
 * - POST /activate — تفعيل رمز
 * - GET /payment-info — معلومات الدفع
 */
@Injectable()
export class StudentSubscriptionService {
    private readonly logger = new Logger(StudentSubscriptionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly idempotencyService: IdempotencyService,
        private readonly codeHmac: CodeHmacService,
    ) {}

    // ═══════════════════════════════════════════════════════════
    // GET /my-status — حالة اشتراك الطالب (SRS-SUB-004 §5.3)
    // ═══════════════════════════════════════════════════════════

    async getMyStatus(schoolId: number, studentUuid: string) {
        const now = new Date();
        const student = await this.resolveStudent(schoolId, studentUuid);

        // هل الاشتراكات مفعّلة أصلاً؟
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: { isActivated: true },
        });

        // SRS-004 §5.3: accessType = null عندما subscriptionsEnabled=false
        if (!settings?.isActivated) {
            return {
                subscriptionsEnabled: false,
                accessType: null,
                startedAt: null,
                expiresAt: null,
                serverTime: now.toISOString(),
            };
        }

        // كل فترات الطالب (عددها صغير دائماً) — نختار الفترة المرجعية في الذاكرة
        const periods = await this.prisma.studentAccessPeriod.findMany({
            where: { schoolId, studentUserId: student.id },
            select: {
                periodType: true,
                startedAt: true,
                expiresAt: true,
                endedEarlyAt: true,
            },
        });

        // النهاية الفعلية = COALESCE(ended_early_at, expires_at)
        const effectiveEnd = (p: (typeof periods)[number]) => p.endedEarlyAt ?? p.expiresAt;
        const isActive = (p: (typeof periods)[number]) =>
            p.endedEarlyAt === null && p.expiresAt > now;
        const latestFirst = (a: (typeof periods)[number], b: (typeof periods)[number]) =>
            effectiveEnd(b).getTime() - effectiveEnd(a).getTime();

        // الأولوية: PAID فعّالة → TRIAL فعّالة → أحدث فترة منتهية
        const reference =
            periods.filter(p => p.periodType === 'PAID' && isActive(p)).sort(latestFirst)[0] ??
            periods.filter(p => p.periodType === 'TRIAL' && isActive(p)).sort(latestFirst)[0] ??
            [...periods].sort(latestFirst)[0];

        if (!reference) {
            return {
                subscriptionsEnabled: true,
                accessType: 'NONE' as const,
                startedAt: null,
                expiresAt: null,
                serverTime: now.toISOString(),
            };
        }

        return {
            subscriptionsEnabled: true,
            accessType: reference.periodType, // 'TRIAL' | 'PAID'
            startedAt: reference.startedAt.toISOString(),
            expiresAt: effectiveEnd(reference).toISOString(),
            serverTime: now.toISOString(),
        };
    }

    // ═══════════════════════════════════════════════════════════
    // POST /activate — تفعيل رمز (SRS-SUB-004 §3)
    // ═══════════════════════════════════════════════════════════

    async activateCode(
        schoolId: number,
        studentUuid: string,
        dto: ActivateCodeDto,
        idempotencyKey?: string,
    ) {
        const now = new Date();
        const normalizedCode = dto.code.toUpperCase().replace(/[-\s]/g, '');
        const student = await this.resolveStudent(schoolId, studentUuid);

        // ── Idempotency ──
        if (idempotencyKey) {
            const requestHash = this.idempotencyService.computeRequestHash({ code: normalizedCode });
            const cached = await this.idempotencyService.acquireOrReturn({
                idempotencyKey,
                schoolId,
                actorUserId: student.id,
                endpoint: 'student-subscription-activate',
                requestHash,
            });
            if (cached) return cached.body;
        }

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                // 1. قفل advisory ثنائي — SRS-004 §3.5
                await tx.$executeRawUnsafe(
                    `SELECT pg_advisory_xact_lock($1::int4, $2::int4)`,
                    schoolId,
                    student.id,
                );

                // 2. تحقق عدم وجود فترة PAID فعّالة
                const existingPaid = await tx.studentAccessPeriod.findFirst({
                    where: {
                        schoolId,
                        studentUserId: student.id,
                        periodType: 'PAID',
                        endedEarlyAt: null,
                        expiresAt: { gt: now },
                    },
                    select: { id: true },
                });
                if (existingPaid) {
                    throw new ConflictException('ACTIVE_PAID_SUBSCRIPTION_EXISTS');
                }

                // 3. حساب HMAC ومطابقته
                const hashes = this.codeHmac.computeAllVersionHashes(normalizedCode);
                const hashValues = hashes.map(h => h.hash);

                const code = await tx.activationCode.findFirst({
                    where: {
                        codeLookupHash: { in: hashValues },
                        status: 'UNUSED',
                    },
                    select: {
                        id: true,
                        schoolId: true,
                        batchId: true,
                    },
                });

                // لا رمز أو رمز من مدرسة أخرى — نفس الرسالة (لا كشف)
                if (!code || code.schoolId !== schoolId) {
                    throw new BadRequestException('INVALID_OR_USED_CODE');
                }

                // 4. تحديث الرمز → USED
                await tx.activationCode.update({
                    where: { id: code.id },
                    data: {
                        status: 'USED',
                        consumedAt: now,
                        consumedByUserId: student.id,
                    },
                });

                // 5. إنهاء التجربة إن وجدت
                await tx.studentAccessPeriod.updateMany({
                    where: {
                        schoolId,
                        studentUserId: student.id,
                        periodType: 'TRIAL',
                        endedEarlyAt: null,
                        expiresAt: { gt: now },
                    },
                    data: { endedEarlyAt: now },
                });

                // 6. حساب تاريخ انتهاء السنة التقويمية
                const expiresAt = calculateCalendarYearEnd(now);

                // 7. إنشاء فترة PAID
                await tx.studentAccessPeriod.create({
                    data: {
                        schoolId,
                        studentUserId: student.id,
                        periodType: 'PAID',
                        startedAt: now,
                        expiresAt,
                        activationCodeId: code.id,
                    },
                });

                // 8. تسجيل audit
                await tx.subscriptionAuditEvent.create({
                    data: {
                        schoolId,
                        eventType: 'CODE_ACTIVATED',
                        actorUserId: student.id,
                        targetUserId: student.id,
                        metadata: {
                            codeId: code.id,
                            batchId: code.batchId,
                        },
                    },
                });

                const response = {
                    success: true,
                    accessType: 'PAID' as const,
                    startedAt: now.toISOString(),
                    expiresAt: expiresAt.toISOString(),
                    serverTime: now.toISOString(),
                };

                // 9. تسجيل idempotency داخل المعاملة — يُثبَّت مع الأثر ذرياً
                if (idempotencyKey) {
                    await this.idempotencyService.markCompletedTx(tx, idempotencyKey, 200, response);
                }

                return response;
            }, {
                timeout: 15_000,
            });

            return result;

        } catch (err) {
            if (idempotencyKey) {
                if (
                    err instanceof ConflictException ||
                    err instanceof BadRequestException ||
                    err instanceof ForbiddenException
                ) {
                    const statusCode = err instanceof ConflictException ? 409
                        : err instanceof ForbiddenException ? 403 : 400;
                    await this.idempotencyService.markFailedBusiness(
                        idempotencyKey, statusCode, { message: (err as any).message },
                    );
                } else {
                    await this.idempotencyService.markFailedTransient(idempotencyKey);
                }
            }
            throw err;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // GET /payment-info — معلومات الدفع (للعرض فقط)
    // ═══════════════════════════════════════════════════════════

    async getPaymentInfo(schoolId: number) {
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: {
                isActivated: true,
                subscriptionPrice: true,
                contactNumber: true,
            },
        });

        if (!settings?.isActivated) {
            throw new ForbiddenException('SUBSCRIPTION_NOT_ACTIVATED');
        }

        const paymentMethods = await this.prisma.schoolPaymentMethod.findMany({
            where: { schoolId, isDeleted: false },
            orderBy: { sortOrder: 'asc' },
            select: {
                uuid: true,
                name: true,
                paymentDetails: true,
                instructions: true,
            },
        });

        return {
            subscriptionPrice: settings.subscriptionPrice?.toString() ?? null,
            currency: 'ريال',
            contactNumber: settings.contactNumber,
            paymentMethods,
        };
    }

    // ═══════════════════════════════════════════════════════════
    // مساعدات
    // ═══════════════════════════════════════════════════════════

    private async resolveStudent(schoolId: number, studentUuid: string) {
        const student = await this.prisma.user.findFirst({
            where: {
                uuid: studentUuid,
                schoolId,
                userType: 'STUDENT',
                isDeleted: false,
            },
            select: { id: true, uuid: true },
        });
        if (!student) throw new NotFoundException('STUDENT_NOT_FOUND');
        return student;
    }
}

// ═══════════════════════════════════════════════════════════
// حساب انتهاء السنة التقويمية — مع إصلاح 29 فبراير
// ═══════════════════════════════════════════════════════════

/**
 * حساب تاريخ الانتهاء بعد سنة تقويمية واحدة.
 *
 * إصلاح chat212: عند بدء الاشتراك في 29 فبراير (سنة كبيسة):
 * - نضبط اليوم إلى 28 **قبل** إضافة السنة
 * - لأن setUTCFullYear على 29 فبراير في سنة غير كبيسة ينقل التاريخ إلى 1 مارس
 *
 * اختبار: 2028-02-29T12:00Z → 2029-02-28T12:00Z ✅
 */
export function calculateCalendarYearEnd(activationTs: Date): Date {
    const result = new Date(activationTs);

    // حالة 29 فبراير: نضبط اليوم أولاً لتجنب القفز لمارس
    if (result.getUTCMonth() === 1 && result.getUTCDate() === 29) {
        result.setUTCDate(28);
    }

    result.setUTCFullYear(result.getUTCFullYear() + 1);
    return result;
}
