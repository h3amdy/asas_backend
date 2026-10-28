// src/school/common/subscription/idempotency.service.ts
import { Injectable, Logger, ConflictException, HttpException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma, IdempotencyStatus } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * 🔁 خدمة Idempotency — SRS-SUB-004 §2.3
 *
 * تُستخدم لضمان عدم تكرار العمليات الحرجة (تفعيل الاشتراك، إنشاء الدفعات، تفعيل الرمز).
 * تعمل في معاملة منفصلة عن العملية الأصلية لتجنب deadlocks.
 */
@Injectable()
export class IdempotencyService {
    private readonly logger = new Logger(IdempotencyService.name);

    /** مدة صلاحية سجل idempotency: 24 ساعة */
    private static readonly TTL_HOURS = 24;

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
                        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
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
        const expiresAt = new Date(Date.now() + IdempotencyService.TTL_HOURS * 3600_000);

        try {
            await this.prisma.idempotencyRecord.create({
                data: {
                    idempotencyKey,
                    schoolId,
                    actorUserId,
                    endpoint,
                    requestHash,
                    status: IdempotencyStatus.PROCESSING,
                    expiresAt,
                },
            });
            return null; // حجز ناجح — تابع العملية
        } catch (err: any) {
            // P2002 = unique violation — السجل موجود مسبقاً
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                return this.handleExistingRecord(params, expiresAt);
            }
            throw err;
        }
    }

    /**
     * تحديث حالة السجل بعد نجاح العملية
     */
    async markCompleted(
        idempotencyKey: string,
        responseStatusCode: number,
        responseBody: any,
    ): Promise<void> {
        await this.prisma.idempotencyRecord.update({
            where: { idempotencyKey },
            data: {
                status: IdempotencyStatus.COMPLETED,
                responseStatusCode,
                responseBody,
            },
        });
    }

    /**
     * تحديث حالة السجل بعد فشل عمل (خطأ متوقع — لا إعادة محاولة)
     */
    async markFailedBusiness(
        idempotencyKey: string,
        responseStatusCode: number,
        responseBody: any,
    ): Promise<void> {
        await this.prisma.idempotencyRecord.update({
            where: { idempotencyKey },
            data: {
                status: IdempotencyStatus.FAILED_BUSINESS,
                responseStatusCode,
                responseBody,
            },
        });
    }

    /**
     * تحديث حالة السجل بعد فشل عابر (يمكن إعادة المحاولة)
     */
    async markFailedTransient(idempotencyKey: string): Promise<void> {
        await this.prisma.idempotencyRecord.update({
            where: { idempotencyKey },
            data: {
                status: IdempotencyStatus.FAILED_TRANSIENT,
            },
        });
    }

    // ─── المنطق الداخلي ──────────────────────────────────

    private async handleExistingRecord(
        params: {
            idempotencyKey: string;
            schoolId: number;
            actorUserId: number;
            endpoint: string;
            requestHash: string;
        },
        newExpiresAt: Date,
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
                const now = new Date();
                if (existing.expiresAt > now) {
                    // السجل لا يزال ضمن مدة الصلاحية — العملية قد تكون جارية فعلاً
                    throw new ConflictException('REQUEST_IN_PROGRESS');
                }

                // السجل منتهي الصلاحية وما زال PROCESSING:
                // العملية الأصلية إما نجحت ولم تُحفظ استجابتها، أو فشلت بشكل غير معروف.
                //
                // ⚠️ لا نستحوذ على السجل تلقائياً — لأن TX الأصلية ربما نجحت.
                // بدلاً من ذلك: نُبلغ العميل بفحص حالته الفعلية ثم إعادة الطلب بمفتاح جديد.
                //
                // ننقل السجل إلى EXPIRED حتى لا يبقى عالقاً للأبد،
                // مع تسجيل تحذير للتحقيق.
                this.logger.warn(
                    `Stale PROCESSING idempotency record detected: key=${idempotencyKey}, ` +
                    `endpoint=${existing.endpoint}, expired=${existing.expiresAt.toISOString()}`,
                );

                // نقل ذري إلى EXPIRED (فقط إذا كان لا يزال PROCESSING)
                await this.prisma.idempotencyRecord.updateMany({
                    where: {
                        idempotencyKey,
                        status: IdempotencyStatus.PROCESSING,
                    },
                    data: {
                        status: IdempotencyStatus.EXPIRED,
                    },
                });

                throw new ConflictException(
                    'STALE_PROCESSING_UNKNOWN — The previous request\'s outcome is uncertain. ' +
                    'Check your current state, then retry with a new idempotency key if needed.',
                );
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
                        expiresAt: newExpiresAt,
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
