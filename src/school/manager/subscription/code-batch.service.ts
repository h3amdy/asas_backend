// src/school/manager/subscription/code-batch.service.ts
import {
    Injectable, Logger, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IdempotencyService } from '../../common/subscription/idempotency.service';
import { CodeGeneratorService } from './crypto/code-generator.service';
import { CodeCryptoService } from './crypto/code-crypto.service';
import { CodeHmacService } from './crypto/code-hmac.service';
import { CreateCodeBatchDto } from './dto/code-batch.dto';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * 📦 خدمة دفعات الرموز — المرحلة 3 (SRS-SUB-003)
 *
 * إنشاء + استعلام الدفعات والرموز
 */
@Injectable()
export class CodeBatchService {
    private readonly logger = new Logger(CodeBatchService.name);

    /** حد إعادة المحاولة عند تصادم HMAC */
    private static readonly MAX_COLLISION_RETRIES = 3;

    constructor(
        private readonly prisma: PrismaService,
        private readonly idempotencyService: IdempotencyService,
        private readonly codeGenerator: CodeGeneratorService,
        private readonly codeCrypto: CodeCryptoService,
        private readonly codeHmac: CodeHmacService,
    ) {}

    // ═══════════════════════════════════════════════════════════
    // POST /code-batches — إنشاء دفعة رموز
    // ═══════════════════════════════════════════════════════════

    async createBatch(
        schoolId: number,
        actorUserId: number,
        dto: CreateCodeBatchDto,
        idempotencyKey?: string,
    ) {
        // ── Idempotency ──
        if (idempotencyKey) {
            const requestHash = this.idempotencyService.computeRequestHash(dto as any);
            const cached = await this.idempotencyService.acquireOrReturn({
                idempotencyKey,
                schoolId,
                actorUserId,
                endpoint: 'code-batch-create',
                requestHash,
            });
            if (cached) return cached.body;
        }

        try {
            const result = await this.prisma.$transaction(async (tx) => {
                // 1. قفل الإعدادات + التحقق من التفعيل
                const settings = await tx.$queryRaw<Array<{
                    next_code_serial: number;
                    is_activated: boolean;
                }>>`
                    SELECT next_code_serial, is_activated
                    FROM "school_subscription_settings"
                    WHERE school_id = ${schoolId}
                    FOR UPDATE
                `;

                if (!settings.length || !settings[0].is_activated) {
                    throw new ForbiddenException('SUBSCRIPTION_NOT_ACTIVATED');
                }

                const serialStart = settings[0].next_code_serial;
                const serialEnd = serialStart + dto.codeCount - 1;

                // 2. تحديث next_code_serial
                await tx.schoolSubscriptionSettings.update({
                    where: { schoolId },
                    data: { nextCodeSerial: serialStart + dto.codeCount },
                });

                // 3. إنشاء UUIDs
                const batchUuid = crypto.randomUUID();

                // 4. توليد + تشفير + HMAC لكل رمز
                const codesData: Array<{
                    uuid: string;
                    schoolId: number;
                    batchId: number; // يُملأ بعد INSERT الدفعة
                    serialNumber: number;
                    codeCiphertext: Buffer;
                    codeLookupHash: string;
                    encKeyVersion: number;
                    hmacKeyVersion: number;
                }> = [];

                for (let i = 0; i < dto.codeCount; i++) {
                    const codeUuid = crypto.randomUUID();
                    let plaintext: string;
                    let lookupHash: string;
                    let hmacKeyVersion: number;
                    let retries = 0;

                    // محاولة توليد رمز فريد (إعادة محاولة عند تصادم HMAC)
                    while (true) {
                        plaintext = this.codeGenerator.generateCode();
                        const hmacResult = this.codeHmac.computeHash(plaintext);
                        lookupHash = hmacResult.hash;
                        hmacKeyVersion = hmacResult.keyVersion;

                        // تحقق من عدم وجود تصادم
                        const existing = await tx.activationCode.findUnique({
                            where: { codeLookupHash: lookupHash },
                            select: { id: true },
                        });

                        if (!existing) break;

                        retries++;
                        if (retries >= CodeBatchService.MAX_COLLISION_RETRIES) {
                            throw new Error(
                                `HMAC collision after ${retries} retries — this should be astronomically rare`,
                            );
                        }
                        this.logger.warn(`HMAC collision on attempt ${retries}, regenerating code`);
                    }

                    // تشفير بـ AAD
                    const aad = this.codeCrypto.buildAAD(schoolId, batchUuid, codeUuid);
                    const { ciphertext, keyVersion: encKeyVersion } = this.codeCrypto.encrypt(plaintext!, aad);

                    codesData.push({
                        uuid: codeUuid,
                        schoolId,
                        batchId: 0, // placeholder
                        serialNumber: serialStart + i,
                        codeCiphertext: ciphertext,
                        codeLookupHash: lookupHash!,
                        encKeyVersion,
                        hmacKeyVersion: hmacKeyVersion!,
                    });
                }

                // 5. إنشاء الدفعة
                const batch = await tx.activationCodeBatch.create({
                    data: {
                        uuid: batchUuid,
                        schoolId,
                        codeCount: dto.codeCount,
                        serialStart,
                        serialEnd,
                        createdByUserId: actorUserId,
                    },
                });

                // 6. إنشاء الرموز — bulk insert
                await tx.activationCode.createMany({
                    data: codesData.map((c) => ({
                        uuid: c.uuid,
                        schoolId: c.schoolId,
                        batchId: batch.id,
                        serialNumber: c.serialNumber,
                        codeCiphertext: c.codeCiphertext,
                        codeLookupHash: c.codeLookupHash,
                        encKeyVersion: c.encKeyVersion,
                        hmacKeyVersion: c.hmacKeyVersion,
                    })),
                });

                // 7. تسجيل audit
                await tx.subscriptionAuditEvent.create({
                    data: {
                        schoolId,
                        eventType: 'BATCH_CREATED',
                        actorUserId,
                        metadata: {
                            batchId: batch.id,
                            batchUuid,
                            codeCount: dto.codeCount,
                            serialStart,
                            serialEnd,
                        },
                    },
                });

                const response = {
                    id: batch.id,
                    uuid: batch.uuid,
                    codeCount: batch.codeCount,
                    serialStart: batch.serialStart,
                    serialEnd: batch.serialEnd,
                    createdAt: batch.createdAt.toISOString(),
                };

                // 8. تسجيل idempotency داخل المعاملة — يُثبَّت مع الدفعة ذرياً
                if (idempotencyKey) {
                    await this.idempotencyService.markCompletedTx(tx, idempotencyKey, 201, response);
                }

                return response;
            }, {
                timeout: 60_000, // دفعة 1000 رمز قد تستغرق وقتاً
            });

            return result;

        } catch (err) {
            if (idempotencyKey) {
                if (err instanceof ForbiddenException) {
                    await this.idempotencyService.markFailedBusiness(
                        idempotencyKey, 403, { message: (err as any).message },
                    );
                } else {
                    await this.idempotencyService.markFailedTransient(idempotencyKey);
                }
            }
            throw err;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // GET /code-batches — قائمة الدفعات (paginated)
    // ═══════════════════════════════════════════════════════════

    async listBatches(schoolId: number, rawPage?: number, rawLimit?: number) {
        await this.ensureActivated(schoolId);

        const { page, limit, skip } = CodeBatchService.normalizePaging(
            rawPage, rawLimit, 20, CodeBatchService.MAX_BATCHES_PAGE_SIZE,
        );
        const [items, total] = await Promise.all([
            this.prisma.activationCodeBatch.findMany({
                where: { schoolId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    uuid: true,
                    codeCount: true,
                    serialStart: true,
                    serialEnd: true,
                    createdAt: true,
                    createdBy: {
                        select: { uuid: true, name: true },
                    },
                    _count: {
                        select: {
                            codes: { where: { status: 'USED' } },
                        },
                    },
                },
            }),
            this.prisma.activationCodeBatch.count({ where: { schoolId } }),
        ]);

        return {
            items: items.map((b) => ({
                id: b.id,
                uuid: b.uuid,
                codeCount: b.codeCount,
                serialStart: b.serialStart,
                serialEnd: b.serialEnd,
                usedCount: b._count.codes,
                unusedCount: b.codeCount - b._count.codes,
                createdAt: b.createdAt.toISOString(),
                createdBy: b.createdBy,
            })),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    // ═══════════════════════════════════════════════════════════
    // GET /code-batches/:id — تفاصيل الدفعة
    // ═══════════════════════════════════════════════════════════

    async getBatchDetail(schoolId: number, batchId: number) {
        const batch = await this.prisma.activationCodeBatch.findFirst({
            where: { id: batchId, schoolId },
            select: {
                id: true,
                uuid: true,
                codeCount: true,
                serialStart: true,
                serialEnd: true,
                createdAt: true,
                createdBy: { select: { uuid: true, name: true } },
                _count: {
                    select: {
                        codes: { where: { status: 'USED' } },
                    },
                },
            },
        });

        if (!batch) throw new NotFoundException('BATCH_NOT_FOUND');

        return {
            id: batch.id,
            uuid: batch.uuid,
            codeCount: batch.codeCount,
            serialStart: batch.serialStart,
            serialEnd: batch.serialEnd,
            usedCount: batch._count.codes,
            unusedCount: batch.codeCount - batch._count.codes,
            createdAt: batch.createdAt.toISOString(),
            createdBy: batch.createdBy,
        };
    }

    // ═══════════════════════════════════════════════════════════
    // GET /code-batches/:id/unused-codes — رموز غير مستخدمة (مع فك التشفير)
    // ═══════════════════════════════════════════════════════════

    async getUnusedCodes(schoolId: number, batchId: number, rawPage?: number, rawLimit?: number) {
        const batch = await this.prisma.activationCodeBatch.findFirst({
            where: { id: batchId, schoolId },
            select: { id: true, uuid: true },
        });
        if (!batch) throw new NotFoundException('BATCH_NOT_FOUND');

        const { page, limit, skip } = CodeBatchService.normalizePaging(
            rawPage, rawLimit, 50, CodeBatchService.MAX_CODES_PAGE_SIZE,
        );
        const [codes, total] = await Promise.all([
            this.prisma.activationCode.findMany({
                where: { batchId, schoolId, status: 'UNUSED' },
                orderBy: { serialNumber: 'asc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    uuid: true,
                    serialNumber: true,
                    codeCiphertext: true,
                    encKeyVersion: true,
                },
            }),
            this.prisma.activationCode.count({
                where: { batchId, schoolId, status: 'UNUSED' },
            }),
        ]);

        const items = codes.map((code) => {
            const aad = this.codeCrypto.buildAAD(schoolId, batch.uuid, code.uuid);
            const plaintext = this.codeCrypto.decrypt(
                Buffer.from(code.codeCiphertext),
                aad,
                code.encKeyVersion,
            );

            return {
                id: code.id,
                serialNumber: code.serialNumber,
                code: this.codeGenerator.formatCode(plaintext),
                status: 'UNUSED' as const,
            };
        });

        return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    // ═══════════════════════════════════════════════════════════
    // GET /code-batches/:id/used-codes — رموز مستخدمة (metadata فقط)
    // ═══════════════════════════════════════════════════════════

    async getUsedCodes(schoolId: number, batchId: number, rawPage?: number, rawLimit?: number) {
        const batch = await this.prisma.activationCodeBatch.findFirst({
            where: { id: batchId, schoolId },
            select: { id: true },
        });
        if (!batch) throw new NotFoundException('BATCH_NOT_FOUND');

        const { page, limit, skip } = CodeBatchService.normalizePaging(
            rawPage, rawLimit, 50, CodeBatchService.MAX_CODES_PAGE_SIZE,
        );
        const [codes, total] = await Promise.all([
            this.prisma.activationCode.findMany({
                where: { batchId, schoolId, status: 'USED' },
                orderBy: { serialNumber: 'asc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    serialNumber: true,
                    consumedAt: true,
                    consumedBy: {
                        select: { uuid: true, name: true, code: true },
                    },
                    accessPeriod: {
                        select: { expiresAt: true, endedEarlyAt: true },
                    },
                },
            }),
            this.prisma.activationCode.count({
                where: { batchId, schoolId, status: 'USED' },
            }),
        ]);

        return {
            items: codes.map((c) => ({
                id: c.id,
                serialNumber: c.serialNumber,
                status: 'USED' as const,
                consumedAt: c.consumedAt?.toISOString() ?? null,
                consumedBy: c.consumedBy,
                expiresAt: c.accessPeriod?.expiresAt.toISOString() ?? null,
                endedEarlyAt: c.accessPeriod?.endedEarlyAt?.toISOString() ?? null,
            })),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    // ═══════════════════════════════════════════════════════════
    // POST /audit/code-copied — تسجيل نسخ (best-effort)
    // ═══════════════════════════════════════════════════════════

    async logCodeCopied(schoolId: number, actorUserId: number, codeId: number) {
        try {
            await this.prisma.subscriptionAuditEvent.create({
                data: {
                    schoolId,
                    eventType: 'CODE_COPIED',
                    actorUserId,
                    metadata: { codeId },
                },
            });
        } catch {
            // best-effort — الفشل لا يمنع النسخ
            this.logger.warn(`Failed to log code copy: school=${schoolId}, code=${codeId}`);
        }
        return { logged: true };
    }

    /**
     * POST /audit/codes-copied — نسخ «كل غير المستخدمة» دفعة واحدة.
     * حدث تدقيق واحد بدلاً من N طلب (best-effort).
     */
    async logCodesBulkCopied(
        schoolId: number,
        actorUserId: number,
        batchId: number,
        codeIds: number[],
    ) {
        try {
            await this.prisma.subscriptionAuditEvent.create({
                data: {
                    schoolId,
                    eventType: 'CODES_BULK_COPIED',
                    actorUserId,
                    metadata: { batchId, count: codeIds.length, codeIds },
                },
            });
        } catch {
            this.logger.warn(
                `Failed to log bulk copy: school=${schoolId}, batch=${batchId}, count=${codeIds.length}`,
            );
        }
        return { logged: true };
    }

    // ═══════════════════════════════════════════════════════════
    // GET /activation-codes — بحث بالطالب
    // ═══════════════════════════════════════════════════════════

    async searchCodesByStudent(schoolId: number, studentUuid?: string) {
        if (!studentUuid) return { items: [] };

        const student = await this.prisma.user.findFirst({
            where: { uuid: studentUuid, schoolId, userType: 'STUDENT', isDeleted: false },
            select: { id: true },
        });
        if (!student) return { items: [] };

        const codes = await this.prisma.activationCode.findMany({
            where: {
                schoolId,
                consumedByUserId: student.id,
                status: 'USED',
            },
            orderBy: { consumedAt: 'desc' },
            select: {
                id: true,
                serialNumber: true,
                consumedAt: true,
                batch: {
                    select: { id: true, uuid: true, createdAt: true },
                },
                accessPeriod: {
                    select: {
                        periodType: true,
                        startedAt: true,
                        expiresAt: true,
                        endedEarlyAt: true,
                    },
                },
            },
        });

        return {
            items: codes.map((c) => ({
                id: c.id,
                serialNumber: c.serialNumber,
                consumedAt: c.consumedAt?.toISOString() ?? null,
                batch: {
                    id: c.batch.id,
                    uuid: c.batch.uuid,
                    createdAt: c.batch.createdAt.toISOString(),
                },
                accessPeriod: c.accessPeriod ? {
                    periodType: c.accessPeriod.periodType,
                    startedAt: c.accessPeriod.startedAt.toISOString(),
                    expiresAt: c.accessPeriod.expiresAt.toISOString(),
                    endedEarlyAt: c.accessPeriod.endedEarlyAt?.toISOString() ?? null,
                } : null,
            })),
        };
    }

    // ═══════════════════════════════════════════════════════════
    // مساعدات
    // ═══════════════════════════════════════════════════════════

    static readonly MAX_BATCHES_PAGE_SIZE = 50;
    /** كل رمز غير مستخدم يُفك تشفيره → سقف صارم لحجم الصفحة */
    static readonly MAX_CODES_PAGE_SIZE = 200;

    /** page/limit من query: NaN أو ≤0 → الافتراضي، limit يُقص للسقف */
    static normalizePaging(
        rawPage: number | undefined,
        rawLimit: number | undefined,
        defaultLimit: number,
        maxLimit: number,
    ) {
        const page = Number.isInteger(rawPage) && rawPage! >= 1 ? rawPage! : 1;
        const limit = Number.isInteger(rawLimit) && rawLimit! >= 1
            ? Math.min(rawLimit!, maxLimit)
            : defaultLimit;
        return { page, limit, skip: (page - 1) * limit };
    }

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
