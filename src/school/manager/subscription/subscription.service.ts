// src/school/manager/subscription/subscription.service.ts
import {
    Injectable, Logger, ConflictException, NotFoundException,
    BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IdempotencyService } from '../../common/subscription/idempotency.service';
import { SubscriptionTrialService } from '../../common/subscription/subscription-trial.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import {
    CreatePaymentMethodDto, UpdatePaymentMethodDto, ReorderPaymentMethodsDto,
} from './dto/payment-method.dto';
import {
    SubscriptionSettingsResponse, ActivateSubscriptionResponse,
} from './types/subscription-settings.types';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * 📋 خدمة اشتراكات المدير — المرحلة 2
 *
 * تتضمن: الإعدادات + التفعيل الذري + طرق الدفع CRUD
 */
@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    /** الحد الأقصى لطرق الدفع الفعّالة */
    private static readonly MAX_ACTIVE_PAYMENT_METHODS = 10;

    constructor(
        private readonly prisma: PrismaService,
        private readonly idempotencyService: IdempotencyService,
        private readonly trialService: SubscriptionTrialService,
    ) {}

    /**
     * يحوّل UUID المستخدم (req.user.sub في JWT) إلى المعرّف الرقمي
     * المطلوب لأعمدة actorUserId / createdByUserId (Int FK).
     * مقيّد بالمدرسة الحالية لمنع أي خلط بين المدارس.
     */
    async resolveActorUserId(schoolId: number, userUuid: string): Promise<number> {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId, isDeleted: false },
            select: { id: true },
        });
        if (!user) {
            throw new ForbiddenException('ACTOR_NOT_FOUND');
        }
        return user.id;
    }

    // ═══════════════════════════════════════════════════════════
    // GET /settings — جلب إعدادات الاشتراك + إحصائيات
    // ═══════════════════════════════════════════════════════════

    async getSettings(schoolId: number): Promise<SubscriptionSettingsResponse> {
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
        });

        const now = new Date();

        // عدد الطلاب الكلي
        const studentCount = await this.prisma.user.count({
            where: { schoolId, userType: 'STUDENT', isDeleted: false },
        });

        // عدد الفترات الفعّالة
        const [activeTrialCount, activePaidCount] = settings?.isActivated
            ? await Promise.all([
                this.prisma.studentAccessPeriod.count({
                    where: {
                        schoolId,
                        periodType: 'TRIAL',
                        endedEarlyAt: null,
                        expiresAt: { gt: now },
                    },
                }),
                this.prisma.studentAccessPeriod.count({
                    where: {
                        schoolId,
                        periodType: 'PAID',
                        endedEarlyAt: null,
                        expiresAt: { gt: now },
                    },
                }),
            ])
            : [0, 0];

        // إحصائيات الرموز على مستوى المدرسة (للواجهة الرئيسية — UI-SUB-ADM-001 §3)
        let usedCodes = 0;
        let unusedCodes = 0;
        if (settings?.isActivated) {
            const grouped = await this.prisma.activationCode.groupBy({
                by: ['status'],
                where: { schoolId },
                _count: { _all: true },
            });
            for (const g of grouped) {
                if (g.status === 'USED') usedCodes = g._count._all;
                else if (g.status === 'UNUSED') unusedCodes = g._count._all;
            }
        }

        return {
            isActivated: settings?.isActivated ?? false,
            activatedAt: settings?.activatedAt?.toISOString() ?? null,
            isTrialEnabled: settings?.isTrialEnabled ?? true,
            trialDurationDays: settings?.trialDurationDays ?? null,
            subscriptionPrice: settings?.subscriptionPrice?.toString() ?? null,
            contactNumber: settings?.contactNumber ?? null,
            studentCount,
            activeTrialCount,
            activePaidCount,
            codeStats: {
                total: usedCodes + unusedCodes,
                used: usedCodes,
                unused: unusedCodes,
            },
        };
    }

    // ═══════════════════════════════════════════════════════════
    // POST /activate — تفعيل نظام الاشتراك (ذري + idempotent)
    // ═══════════════════════════════════════════════════════════

    async activateSubscription(
        schoolId: number,
        actorUserId: number,
        dto: ActivateSubscriptionDto,
        idempotencyKey?: string,
    ): Promise<ActivateSubscriptionResponse> {
        const now = new Date();

        // ── Idempotency check (إن وُجد المفتاح) ──
        if (idempotencyKey) {
            const requestHash = this.idempotencyService.computeRequestHash(dto as any);
            const cached = await this.idempotencyService.acquireOrReturn({
                idempotencyKey,
                schoolId,
                actorUserId,
                endpoint: 'subscription-activate',
                requestHash,
            });
            if (cached) return cached.body as ActivateSubscriptionResponse;
        }

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                // 0. قفل صف المدرسة — يسلسل التفعيل مع إنشاء الطلاب
                await tx.$queryRawUnsafe(
                    `SELECT id FROM "School" WHERE id = $1 FOR UPDATE`,
                    schoolId,
                );

                // 1. رفض التفعيل المزدوج
                const existing = await tx.schoolSubscriptionSettings.findUnique({
                    where: { schoolId },
                });
                if (existing?.isActivated) {
                    throw new ConflictException('SUBSCRIPTION_ALREADY_ACTIVATED');
                }

                // 2. إنشاء/تحديث الإعدادات
                const settings = await tx.schoolSubscriptionSettings.upsert({
                    where: { schoolId },
                    update: {
                        isActivated: true,
                        activatedAt: now,
                        isTrialEnabled: dto.isTrialEnabled,
                        trialDurationDays: dto.isTrialEnabled ? dto.trialDurationDays : null,
                        subscriptionPrice: new Decimal(dto.subscriptionPrice),
                        contactNumber: dto.contactNumber,
                    },
                    create: {
                        schoolId,
                        isActivated: true,
                        activatedAt: now,
                        isTrialEnabled: dto.isTrialEnabled,
                        trialDurationDays: dto.isTrialEnabled ? dto.trialDurationDays : null,
                        subscriptionPrice: new Decimal(dto.subscriptionPrice),
                        contactNumber: dto.contactNumber,
                    },
                });

                // 3. إنشاء طرق الدفع بالترتيب
                for (let i = 0; i < dto.paymentMethods.length; i++) {
                    const pm = dto.paymentMethods[i];
                    await tx.schoolPaymentMethod.create({
                        data: {
                            schoolId,
                            name: pm.name,
                            paymentDetails: pm.paymentDetails,
                            instructions: pm.instructions ?? null,
                            sortOrder: i + 1,
                        },
                    });
                }

                // 4. إنشاء فترات التجربة (إذا مفعّلة)
                let trialPeriodsCreated = 0;
                if (dto.isTrialEnabled && dto.trialDurationDays) {
                    trialPeriodsCreated = await this.trialService.createBulkTrialsTx(
                        tx, schoolId, dto.trialDurationDays, now,
                    );
                }

                // 5. تسجيل في audit
                await tx.subscriptionAuditEvent.create({
                    data: {
                        schoolId,
                        eventType: 'SUBSCRIPTION_ACTIVATED',
                        actorUserId,
                        metadata: {
                            isTrialEnabled: dto.isTrialEnabled,
                            trialDurationDays: dto.trialDurationDays ?? null,
                            subscriptionPrice: dto.subscriptionPrice,
                            paymentMethodsCount: dto.paymentMethods.length,
                            trialPeriodsCreated,
                        },
                    },
                });

                return {
                    isActivated: true,
                    activatedAt: now.toISOString(),
                    trialPeriodsCreated,
                    paymentMethodsCreated: dto.paymentMethods.length,
                } satisfies ActivateSubscriptionResponse;
            }, {
                // معاملة طويلة محتملة (bulk trial insert)
                timeout: 30_000,
            });

            // 6. تحديث idempotency بنجاح
            if (idempotencyKey) {
                await this.idempotencyService.markCompleted(idempotencyKey, 201, result);
            }

            return result;

        } catch (err) {
            // تحديث idempotency بفشل
            if (idempotencyKey) {
                if (err instanceof ConflictException) {
                    await this.idempotencyService.markFailedBusiness(
                        idempotencyKey, 409, { message: (err as any).message },
                    );
                } else {
                    await this.idempotencyService.markFailedTransient(idempotencyKey);
                }
            }
            throw err;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PUT /settings — تعديل الإعدادات بعد التفعيل
    // ═══════════════════════════════════════════════════════════

    async updateSettings(
        schoolId: number,
        dto: UpdateSettingsDto,
    ): Promise<SubscriptionSettingsResponse> {
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
        });
        if (!settings?.isActivated) {
            throw new ForbiddenException('SUBSCRIPTION_NOT_ACTIVATED');
        }

        // بناء كائن التحديث بالحقول المُمررة فقط
        const updateData: Record<string, any> = {};

        if (dto.isTrialEnabled !== undefined) {
            updateData.isTrialEnabled = dto.isTrialEnabled;
            if (dto.isTrialEnabled && dto.trialDurationDays) {
                updateData.trialDurationDays = dto.trialDurationDays;
            }
            if (!dto.isTrialEnabled) {
                updateData.trialDurationDays = null;
            }
        } else if (dto.trialDurationDays !== undefined) {
            // تعديل المدة دون تغيير حالة التفعيل
            if (settings.isTrialEnabled) {
                updateData.trialDurationDays = dto.trialDurationDays;
            }
        }

        if (dto.subscriptionPrice !== undefined) {
            updateData.subscriptionPrice = new Decimal(dto.subscriptionPrice);
        }
        if (dto.contactNumber !== undefined) {
            updateData.contactNumber = dto.contactNumber;
        }

        if (Object.keys(updateData).length === 0) {
            return this.getSettings(schoolId); // لا تغييرات
        }

        await this.prisma.schoolSubscriptionSettings.update({
            where: { schoolId },
            data: updateData,
        });

        return this.getSettings(schoolId);
    }

    // ═══════════════════════════════════════════════════════════
    // Payment Methods CRUD
    // ═══════════════════════════════════════════════════════════

    async listPaymentMethods(schoolId: number) {
        await this.ensureActivated(schoolId);

        return this.prisma.schoolPaymentMethod.findMany({
            where: { schoolId, isDeleted: false },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                uuid: true,
                name: true,
                paymentDetails: true,
                instructions: true,
                sortOrder: true,
            },
        });
    }

    async createPaymentMethod(schoolId: number, dto: CreatePaymentMethodDto) {
        return this.prisma.$transaction(async (tx) => {
            // قفل صف الإعدادات — يسلسل إضافة/حذف طرق الدفع ويمنع تجاوز الحد
            const [settings] = await tx.$queryRawUnsafe<Array<{ is_activated: boolean }>>(
                `SELECT is_activated FROM "school_subscription_settings" WHERE school_id = $1 FOR UPDATE`,
                schoolId,
            );
            if (!settings?.is_activated) {
                throw new ForbiddenException('SUBSCRIPTION_NOT_ACTIVATED');
            }

            // حد 10 فعّالة
            const activeCount = await tx.schoolPaymentMethod.count({
                where: { schoolId, isDeleted: false },
            });
            if (activeCount >= SubscriptionService.MAX_ACTIVE_PAYMENT_METHODS) {
                throw new BadRequestException('MAX_PAYMENT_METHODS_REACHED');
            }

            // أعلى sortOrder + 1
            const maxSort = await tx.schoolPaymentMethod.aggregate({
                where: { schoolId, isDeleted: false },
                _max: { sortOrder: true },
            });
            const nextSort = (maxSort._max.sortOrder ?? 0) + 1;

            return tx.schoolPaymentMethod.create({
                data: {
                    schoolId,
                    name: dto.name,
                    paymentDetails: dto.paymentDetails,
                    instructions: dto.instructions ?? null,
                    sortOrder: nextSort,
                },
                select: {
                    id: true,
                    uuid: true,
                    name: true,
                    paymentDetails: true,
                    instructions: true,
                    sortOrder: true,
                },
            });
        });
    }

    async updatePaymentMethod(schoolId: number, id: number, dto: UpdatePaymentMethodDto) {
        const method = await this.prisma.schoolPaymentMethod.findFirst({
            where: { id, schoolId, isDeleted: false },
        });
        if (!method) throw new NotFoundException('PAYMENT_METHOD_NOT_FOUND');

        return this.prisma.schoolPaymentMethod.update({
            where: { id },
            data: {
                name: dto.name ?? method.name,
                paymentDetails: dto.paymentDetails ?? method.paymentDetails,
                instructions: dto.instructions !== undefined ? (dto.instructions ?? null) : method.instructions,
            },
            select: {
                id: true,
                uuid: true,
                name: true,
                paymentDetails: true,
                instructions: true,
                sortOrder: true,
            },
        });
    }

    async deletePaymentMethod(schoolId: number, id: number) {
        return this.prisma.$transaction(async (tx) => {
            // قفل صف الإعدادات — يسلسل إضافة/حذف طرق الدفع ويمنع حذف الأخيرة
            const [settings] = await tx.$queryRawUnsafe<Array<{ is_activated: boolean }>>(
                `SELECT is_activated FROM "school_subscription_settings" WHERE school_id = $1 FOR UPDATE`,
                schoolId,
            );
            if (!settings?.is_activated) {
                throw new ForbiddenException('SUBSCRIPTION_NOT_ACTIVATED');
            }

            const method = await tx.schoolPaymentMethod.findFirst({
                where: { id, schoolId, isDeleted: false },
            });
            if (!method) throw new NotFoundException('PAYMENT_METHOD_NOT_FOUND');

            // منع حذف آخر طريقة دفع
            const activeCount = await tx.schoolPaymentMethod.count({
                where: { schoolId, isDeleted: false },
            });
            if (activeCount <= 1) {
                throw new BadRequestException('CANNOT_DELETE_LAST_PAYMENT_METHOD');
            }

            await tx.schoolPaymentMethod.update({
                where: { id },
                data: { isDeleted: true, deletedAt: new Date() },
            });

            return { deleted: true };
        });
    }

    async reorderPaymentMethods(schoolId: number, dto: ReorderPaymentMethodsDto) {
        await this.ensureActivated(schoolId);

        // تحقق أن كل الـ IDs تخص المدرسة وغير محذوفة
        const activeMethods = await this.prisma.schoolPaymentMethod.findMany({
            where: { schoolId, isDeleted: false },
            select: { id: true },
        });
        const activeIds = new Set(activeMethods.map((m) => m.id));

        for (const id of dto.orderedIds) {
            if (!activeIds.has(id)) {
                throw new BadRequestException(`PAYMENT_METHOD_${id}_NOT_FOUND_OR_DELETED`);
            }
        }

        // تحقق أن كل الطرق الفعّالة مشمولة
        if (dto.orderedIds.length !== activeIds.size) {
            throw new BadRequestException('ORDERED_IDS_MUST_INCLUDE_ALL_ACTIVE_METHODS');
        }

        // تحديث الترتيب في معاملة
        await this.prisma.$transaction(
            dto.orderedIds.map((id, index) =>
                this.prisma.schoolPaymentMethod.update({
                    where: { id },
                    data: { sortOrder: index + 1 },
                }),
            ),
        );

        return this.listPaymentMethods(schoolId);
    }

    // ═══════════════════════════════════════════════════════════
    // مساعدات
    // ═══════════════════════════════════════════════════════════

    private async ensureActivated(schoolId: number): Promise<void> {
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: { isActivated: true },
        });
        if (!settings?.isActivated) {
            throw new ForbiddenException('SUBSCRIPTION_NOT_ACTIVATED');
        }
    }
}
