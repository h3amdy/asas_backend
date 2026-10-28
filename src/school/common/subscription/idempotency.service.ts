// src/school/common/subscription/idempotency.service.ts
import { Injectable, Logger, ConflictException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma, IdempotencyStatus } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * 🔁 خدمة Idempotency — SRS-SUB-004 §2.3
 *
 * تُستخدم لضمان عدم تكرار العمليات الحرجة (تفعيل الاشتراك، إنشاء الدفعات، تفعيل الرمز).
 *
 * ## نموذج الضمان
 * 1. `acquireOrReturn()` يحجز السجل بحالة PROCESSING في معاملة مستقلة مع **مهلة إيجار قصيرة**
 *    (`PROCESSING_LEASE_MS`) أطول من أقصى مهلة لأي معاملة أعمال.
 * 2. `markCompletedTx()` تُستدعى **داخل** معاملة الأعمال نفسها ← الأثر وسجل COMPLETED
 *    يُثبَّتان معاً أو لا يُثبَّت أيٌّ منهما. لا توجد حالة «نجحت العملية ولم تُحفظ الاستجابة».
 * 3. لذلك: سجل PROCESSING انتهى إيجاره = دليل قاطع أن العملية **لم تُثبَّت**
 *    (المعاملة إما فشلت أو أُلغيت بانتهاء مهلتها) ← إعادة الاستحواذ آمنة.
 */
@Injectable()
export class IdempotencyService {
    private readonly logger = new Logger(IdempotencyService.name);

    /** مدة الاحتفاظ بالاستجابة المكتملة/الفاشلة: 24 ساعة */
    private static readonly TTL_HOURS = 24;

    /**
     * مهلة إيجار PROCESSING — يجب أن تتجاوز أقصى `timeout` لمعاملات الأعمال
     * (حالياً 60 ثانية في إنشاء الدفعات) بهامش واسع.
     */
    static readonly PROCESSING_LEASE_MS = 5 * 60_000;

    constructor(private readonly prisma: PrismaService) {}

    /**
     * حساب hash ثابت الترتيب للـ DTO — Canonical JSON
     *
     * يُرتب المفاتيح في **جميع** مستويات الكائن (بما فيها المتداخلة)
     * لضمان أن أي اختلاف في أي حقل مؤثر يُنتج بصمة مختلفة.
     *
     * المصفوفات تحافظ على ترتيبها الأصلي (ترتيب العناصر مهم دلالياً).
     */
    computeRequestHash(dto: Record<string, any>): string {
        const canonical = JSON.stringify(
            dto,
            (_key, value) => {
                // الكائنات العادية (ليست مصفوفات أو null): رتّب مفاتيحها
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    return Object.fromEntries(
                        Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                    );
                }
                return value;
            },
        );
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * محاولة حجز سجل idempotency.
     *
     * @returns `null` إذا نجح الحجز (يجب المتابعة بالعملية)
     * @returns الاستجابة المحفوظة إذا كان السجل مكتملاً (يعيدها مباشرة)
     * @throws ConflictException إذا كان السجل قيد المعالجة (409)
     * @throws HttpException إذا انتهت العملية بخطأ عمل (يعيد نفس الخطأ)
     */
    async acquireOrReturn(params: {
        idempotencyKey: string;
        schoolId: number;
        actorUserId: number;
        endpoint: string;
        requestHash: string;
    }): Promise<{ statusCode: number; body: any } | null> {
        const { idempotencyKey, schoolId, actorUserId, endpoint, requestHash } = params;
        const leaseUntil = this.newLease();

        try {
            await this.prisma.idempotencyRecord.create({
                data: {
                    idempotencyKey,
                    schoolId,
                    actorUserId,
                    endpoint,
                    requestHash,
                    status: IdempotencyStatus.PROCESSING,
                    expiresAt: leaseUntil,
                },
            });
            return null; // حجز ناجح — تابع العملية
        } catch (err: any) {
            // P2002 = unique violation — السجل موجود مسبقاً
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                return this.handleExistingRecord(params, leaseUntil);
            }
            throw err;
        }
    }

    /**
     * تسجيل النجاح **داخل معاملة الأعمال** — يُثبَّت مع الأثر ذرياً.
     *
     * يرمي خطأً (فيُلغي المعاملة كاملة) إذا لم يعد السجل PROCESSING،
     * أي إن طلباً آخر استحوذ عليه — لا يمكن أن يحدث ضمن مهلة الإيجار.
     */
    async markCompletedTx(
        tx: Prisma.TransactionClient,
        idempotencyKey: string,
        responseStatusCode: number,
        responseBody: any,
    ): Promise<void> {
        const updated = await tx.idempotencyRecord.updateMany({
            where: { idempotencyKey, status: IdempotencyStatus.PROCESSING },
            data: {
                status: IdempotencyStatus.COMPLETED,
                responseStatusCode,
                responseBody,
                expiresAt: this.newRetention(),
            },
        });
        if (updated.count !== 1) {
            throw new ConflictException('IDEMPOTENCY_LEASE_LOST');
        }
    }

    /**
     * تحديث حالة السجل بعد فشل عمل (خطأ متوقع — لا إعادة محاولة).
     * المعاملة أُلغيت فعلاً ← لا أثر. إن فشل هذا التحديث يبقى السجل PROCESSING
     * حتى انتهاء الإيجار ثم يُعاد تنفيذه بأمان.
     */
    async markFailedBusiness(
        idempotencyKey: string,
        responseStatusCode: number,
        responseBody: any,
    ): Promise<void> {
        await this.safeUpdateFromProcessing(idempotencyKey, {
            status: IdempotencyStatus.FAILED_BUSINESS,
            responseStatusCode,
            responseBody,
            expiresAt: this.newRetention(),
        });
    }

    /**
     * تحديث حالة السجل بعد فشل عابر (يمكن إعادة المحاولة فوراً).
     */
    async markFailedTransient(idempotencyKey: string): Promise<void> {
        await this.safeUpdateFromProcessing(idempotencyKey, {
            status: IdempotencyStatus.FAILED_TRANSIENT,
            expiresAt: this.newRetention(),
        });
    }

    // ─── المنطق الداخلي ──────────────────────────────────

    private newLease(): Date {
        return new Date(Date.now() + IdempotencyService.PROCESSING_LEASE_MS);
    }

    private newRetention(): Date {
        return new Date(Date.now() + IdempotencyService.TTL_HOURS * 3600_000);
    }

    /**
     * تحديث من PROCESSING فقط، دون رمي خطأ يحجب الخطأ الأصلي للمستدعي.
     */
    private async safeUpdateFromProcessing(
        idempotencyKey: string,
        data: Prisma.IdempotencyRecordUpdateManyMutationInput,
    ): Promise<void> {
        try {
            await this.prisma.idempotencyRecord.updateMany({
                where: { idempotencyKey, status: IdempotencyStatus.PROCESSING },
                data,
            });
        } catch (e) {
            this.logger.warn(
                `Failed to record idempotency failure for key=${idempotencyKey}: ${(e as Error).message} ` +
                `— record stays PROCESSING until lease expiry`,
            );
        }
    }

    private async handleExistingRecord(
        params: {
            idempotencyKey: string;
            schoolId: number;
            actorUserId: number;
            endpoint: string;
            requestHash: string;
        },
        leaseUntil: Date,
    ): Promise<{ statusCode: number; body: any } | null> {
        const { idempotencyKey, schoolId, actorUserId, endpoint, requestHash } = params;
        const existing = await this.prisma.idempotencyRecord.findUnique({
            where: { idempotencyKey },
        });

        if (!existing) {
            // race condition نادر — السجل حُذف بين الفحص والقراءة
            throw new ConflictException('IDEMPOTENCY_RACE_CONDITION');
        }

        // المفتاح مقيّد بالمدرسة + المستخدم + العملية — لا تُعاد استجابة لسياق آخر
        // وتحقق من أن الطلب مطابق
        if (
            existing.schoolId !== schoolId ||
            existing.actorUserId !== actorUserId ||
            existing.endpoint !== endpoint ||
            existing.requestHash !== requestHash
        ) {
            throw new ConflictException(
                'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
            );
        }

        switch (existing.status) {
            case IdempotencyStatus.PROCESSING: {
                if (existing.expiresAt > new Date()) {
                    // الإيجار ساري — العملية الأصلية قد تكون جارية
                    throw new ConflictException('REQUEST_IN_PROGRESS');
                }

                // الإيجار انتهى والسجل ما زال PROCESSING:
                // بما أن COMPLETED يُثبَّت داخل معاملة الأعمال، فلو نجحت العملية الأصلية
                // لكانت الحالة COMPLETED. إذن المعاملة لم تُثبَّت (فشل/انقطاع/انتهاء مهلة)
                // ← إعادة الاستحواذ آمنة. الاستحواذ ذري: طلب واحد فقط ينجح.
                this.logger.warn(
                    `Reclaiming stale PROCESSING idempotency record: key=${idempotencyKey}, ` +
                    `endpoint=${existing.endpoint}, leaseExpired=${existing.expiresAt.toISOString()}`,
                );
                const reclaimed = await this.prisma.idempotencyRecord.updateMany({
                    where: {
                        idempotencyKey,
                        status: IdempotencyStatus.PROCESSING,
                        expiresAt: { lte: new Date() },
                    },
                    data: { expiresAt: leaseUntil },
                });
                if (reclaimed.count === 1) return null;
                throw new ConflictException('REQUEST_IN_PROGRESS');
            }

            case IdempotencyStatus.COMPLETED:
                return {
                    statusCode: existing.responseStatusCode ?? 200,
                    body: existing.responseBody,
                };

            case IdempotencyStatus.FAILED_BUSINESS:
                // أعد نفس الخطأ
                throw new HttpException(
                    (existing.responseBody as Record<string, any>) ?? { message: 'Previous request failed' },
                    existing.responseStatusCode ?? 422,
                );

            case IdempotencyStatus.FAILED_TRANSIENT:
            case IdempotencyStatus.EXPIRED: {
                // استحواذ ذري: فقط طلب واحد ينجح في نقل السجل إلى PROCESSING
                const taken = await this.prisma.idempotencyRecord.updateMany({
                    where: {
                        idempotencyKey,
                        status: {
                            in: [IdempotencyStatus.FAILED_TRANSIENT, IdempotencyStatus.EXPIRED],
                        },
                    },
                    data: {
                        status: IdempotencyStatus.PROCESSING,
                        responseStatusCode: null,
                        responseBody: Prisma.DbNull,
                        expiresAt: leaseUntil,
                    },
                });
                if (taken.count === 1) return null; // تابع العملية
                // طلب متزامن آخر استحوذ عليه أولاً
                throw new ConflictException('REQUEST_IN_PROGRESS');
            }

            default:
                throw new ConflictException('UNKNOWN_IDEMPOTENCY_STATE');
        }
    }
}
