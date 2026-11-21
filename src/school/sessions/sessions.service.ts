// src/school/sessions/sessions.service.ts



import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256, randomToken } from '../auth/utils/crypto.util';
import { SCHOOL_AUTH_JWT, SCHOOL_AUTH_ERRORS } from '../auth/constants';

type DeviceUpsertInput = {
    userId: number;
    deviceFingerprint: string;
    deviceType: 'ANDROID' | 'IOS' | 'WEB';
    pushToken?: string;
};

type LockedDeviceRow = {
    id: number;
    uuid: string;
    userId: number;
    deviceFingerprint: string;
    isActive: boolean;
};

@Injectable()
export class SessionsService {
    constructor(private readonly prisma: PrismaService) { }

    async upsertDevice(
        input: DeviceUpsertInput,
        tx?: Prisma.TransactionClient,
    ) {
        const now = new Date();
        const runner = async (db: Prisma.TransactionClient | PrismaService) => {
            // المسار الحقيقي على PostgreSQL: إدراج آمن عند الغياب + قفل FOR UPDATE قبل أي فحص أو تحديث
            if (typeof db.$queryRaw === 'function') {
                const insertedUuid = randomUUID();
                await db.$queryRaw`
                    INSERT INTO user_devices (
                        uuid,
                        user_id,
                        device_fingerprint,
                        device_type,
                        push_token,
                        last_seen_at,
                        is_active
                    )
                    VALUES (
                        ${insertedUuid},
                        ${input.userId},
                        ${input.deviceFingerprint},
                        ${input.deviceType}::"DeviceType",
                        ${input.pushToken ?? null},
                        ${now},
                        true
                    )
                    ON CONFLICT (user_id, device_fingerprint) DO NOTHING
                `;

                const rows = await db.$queryRaw<LockedDeviceRow[]>`
                    SELECT
                        id,
                        uuid,
                        user_id AS "userId",
                        device_fingerprint AS "deviceFingerprint",
                        is_active AS "isActive"
                    FROM user_devices
                    WHERE user_id = ${input.userId}
                      AND device_fingerprint = ${input.deviceFingerprint}
                    FOR UPDATE
                `;

                const locked = rows[0];
                // SEC-AUTH-06: لا تلمس lastSeenAt أو pushToken ولا تُعد تفعيل جهاز معطّل إدارياً
                if (!locked || !locked.isActive) {
                    throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE);
                }

                await db.userDevice.update({
                    where: { id: locked.id },
                    data: {
                        deviceType: input.deviceType as any,
                        ...(input.pushToken !== undefined
                            ? { pushToken: input.pushToken }
                            : {}),
                        lastSeenAt: now,
                    },
                });

                return {
                    id: locked.id,
                    uuid: locked.uuid,
                    userId: locked.userId,
                    deviceFingerprint: locked.deviceFingerprint,
                };
            }

            // مسار اختبارات الوحدة البسيطة بدون $queryRaw: فحص ثم تحديث مشروط بـ isActive: true
            const existing = await db.userDevice.findUnique({
                where: {
                    userId_deviceFingerprint: {
                        userId: input.userId,
                        deviceFingerprint: input.deviceFingerprint,
                    },
                },
                select: {
                    id: true,
                    uuid: true,
                    userId: true,
                    deviceFingerprint: true,
                    isActive: true,
                },
            });

            if (existing) {
                if (!existing.isActive) {
                    throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE);
                }
                if (typeof db.userDevice.updateMany === 'function') {
                    const updated = await db.userDevice.updateMany({
                        where: { id: existing.id, isActive: true },
                        data: {
                            deviceType: input.deviceType as any,
                            ...(input.pushToken !== undefined
                                ? { pushToken: input.pushToken }
                                : {}),
                            lastSeenAt: now,
                        },
                    });
                    if (updated.count !== 1) {
                        throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE);
                    }
                    return {
                        id: existing.id,
                        uuid: existing.uuid,
                        userId: existing.userId,
                        deviceFingerprint: existing.deviceFingerprint,
                    };
                }
            }

            const device = await db.userDevice.upsert({
                where: {
                    userId_deviceFingerprint: {
                        userId: input.userId,
                        deviceFingerprint: input.deviceFingerprint,
                    },
                },
                create: {
                    userId: input.userId,
                    deviceFingerprint: input.deviceFingerprint,
                    deviceType: input.deviceType as any,
                    pushToken: input.pushToken ?? null,
                    lastSeenAt: now,
                    isActive: true,
                },
                update: {
                    deviceType: input.deviceType as any,
                    pushToken: input.pushToken ?? undefined,
                    lastSeenAt: now,
                },
                select: {
                    id: true,
                    uuid: true,
                    userId: true,
                    deviceFingerprint: true,
                    isActive: true,
                },
            });

            if (!device.isActive) {
                throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE);
            }

            return {
                id: device.id,
                uuid: device.uuid,
                userId: device.userId,
                deviceFingerprint: device.deviceFingerprint,
            };
        };

        if (tx) {
            return runner(tx);
        }
        if (
            typeof this.prisma.$transaction === 'function' &&
            typeof this.prisma.$queryRaw === 'function'
        ) {
            return this.prisma.$transaction((innerTx) => runner(innerTx));
        }
        return runner(this.prisma);
    }

    async createSession(
        params: {
            userId: number;
            schoolId: number | null;
            deviceId: number | null;
            refreshTokenPlain: string;
        },
        tx?: Prisma.TransactionClient,
    ) {
        const db = tx ?? this.prisma;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SCHOOL_AUTH_JWT.refreshTokenTtlSec * 1000);

        const refreshTokenHash = sha256(params.refreshTokenPlain);

        const session = await db.authSession.create({
            data: {
                userId: params.userId,
                schoolId: params.schoolId,
                deviceId: params.deviceId,
                refreshTokenHash,
                createdAt: now,
                lastSeenAt: now,
                expiresAt,
                revokedAt: null,
                revokeReason: null,
            },
            select: {
                uuid: true,
                expiresAt: true,
            },
        });

        return session;
    }

    /**
     * SEC-AUTH-06: تنفيذ التحقق وقفل الجهاز (FOR UPDATE) وإصدار الجلسة داخل معاملة ذرية واحدة
     * لمنع إصدار جلسة لجهاز عُطّل إدارياً أثناء تسجيل الدخول.
     */
    async upsertDeviceAndCreateSession(params: {
        userId: number;
        schoolId: number | null;
        deviceFingerprint: string;
        deviceType: 'ANDROID' | 'IOS' | 'WEB';
        pushToken?: string;
        refreshTokenPlain: string;
    }) {
        const runInTx = async (tx?: Prisma.TransactionClient) => {
            const device = await this.upsertDevice(
                {
                    userId: params.userId,
                    deviceFingerprint: params.deviceFingerprint,
                    deviceType: params.deviceType,
                    pushToken: params.pushToken,
                },
                tx,
            );
            const session = await this.createSession(
                {
                    userId: params.userId,
                    schoolId: params.schoolId,
                    deviceId: device.id,
                    refreshTokenPlain: params.refreshTokenPlain,
                },
                tx,
            );
            return { device, session };
        };

        if (typeof this.prisma.$transaction === 'function') {
            return this.prisma.$transaction((tx) => runInTx(tx));
        }
        return runInTx(undefined);
    }

    async validateAndRotateRefresh(params: {
        sessionUuid: string;
        refreshTokenPlain: string;
        deviceFingerprint: string;
        deviceType: 'ANDROID' | 'IOS' | 'WEB';
        pushToken?: string;
    }) {
        const runInTx = async (db: Prisma.TransactionClient | PrismaService) => {
            type LockedSessionRow = {
                id: number;
                uuid: string;
                userId: number;
                schoolId: number | null;
                deviceId: number | null;
                refreshTokenHash: string;
                expiresAt: Date;
                revokedAt: Date | null;
            };
            type LockedDeviceState = {
                id?: number;
                deviceFingerprint: string;
                isActive: boolean;
            };

            let session: LockedSessionRow | null = null;
            let preLockedDevice: LockedDeviceState | null = null;

            if (typeof db.$queryRaw === 'function') {
                // ترتيب قفل صارم خالٍ من الجمود (Deadlock-Free): user_devices أولاً ثم auth_sessions
                const initialSession = await db.authSession.findUnique({
                    where: { uuid: params.sessionUuid },
                    select: { deviceId: true },
                });
                if (!initialSession) {
                    throw new NotFoundException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);
                }

                if (initialSession.deviceId != null) {
                    const preDeviceRows = await db.$queryRaw<
                        Array<{ id: number; deviceFingerprint: string; isActive: boolean }>
                    >`
                        SELECT
                            id,
                            device_fingerprint AS "deviceFingerprint",
                            is_active AS "isActive"
                        FROM user_devices
                        WHERE id = ${initialSession.deviceId}
                        FOR UPDATE
                    `;
                    preLockedDevice = preDeviceRows[0] ?? null;
                }

                const lockedSessions = await db.$queryRaw<LockedSessionRow[]>`
                    SELECT
                        id,
                        uuid,
                        user_id AS "userId",
                        school_id AS "schoolId",
                        device_id AS "deviceId",
                        refresh_token_hash AS "refreshTokenHash",
                        expires_at AS "expiresAt",
                        revoked_at AS "revokedAt"
                    FROM auth_sessions
                    WHERE uuid = ${params.sessionUuid}
                    FOR UPDATE
                `;
                session = lockedSessions[0] ?? null;
            } else {
                session = await db.authSession.findUnique({
                    where: { uuid: params.sessionUuid },
                    select: {
                        id: true,
                        uuid: true,
                        userId: true,
                        schoolId: true,
                        deviceId: true,
                        refreshTokenHash: true,
                        expiresAt: true,
                        revokedAt: true,
                    },
                });
            }

            if (!session) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);
            if (session.revokedAt) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_REVOKED);
            if (new Date(session.expiresAt).getTime() <= Date.now()) {
                throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_EXPIRED);
            }

            const incomingHash = sha256(params.refreshTokenPlain);
            if (incomingHash !== session.refreshTokenHash) {
                throw new ForbiddenException(SCHOOL_AUTH_ERRORS.REFRESH_TOKEN_INVALID);
            }

            let deviceId = session.deviceId;

            // إذا ما في جهاز مربوط (حالة قديمة/مهاجرة) نعمل upsert ونربط
            if (!deviceId) {
                const device = await this.upsertDevice(
                    {
                        userId: session.userId,
                        deviceFingerprint: params.deviceFingerprint,
                        deviceType: params.deviceType,
                        pushToken: params.pushToken,
                    },
                    db === this.prisma ? undefined : (db as Prisma.TransactionClient),
                );
                deviceId = device.id;

                await db.authSession.update({
                    where: { uuid: session.uuid },
                    data: { deviceId },
                });
            } else {
                // ✅ التحقق من تطابق الجهاز وحالته تحت قفل FOR UPDATE لمنع سباق تعطيل الجهاز
                let existingDevice: LockedDeviceState | null = null;
                if (typeof db.$queryRaw === 'function') {
                    if (preLockedDevice && preLockedDevice.id === deviceId) {
                        existingDevice = preLockedDevice;
                    } else {
                        const lockedRows = await db.$queryRaw<
                            Array<{ id: number; deviceFingerprint: string; isActive: boolean }>
                        >`
                            SELECT
                                id,
                                device_fingerprint AS "deviceFingerprint",
                                is_active AS "isActive"
                            FROM user_devices
                            WHERE id = ${deviceId}
                            FOR UPDATE
                        `;
                        existingDevice = lockedRows[0] ?? null;
                    }
                } else {
                    existingDevice = await db.userDevice.findUnique({
                        where: { id: deviceId },
                        select: { deviceFingerprint: true, isActive: true },
                    });
                }

                if (!existingDevice) {
                    throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_NOT_FOUND);
                }
                if (!existingDevice.isActive) {
                    throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE);
                }
                if (existingDevice.deviceFingerprint !== params.deviceFingerprint) {
                    throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_MISMATCH);
                }

                // تحديث معلومات الجهاز الحالي فقط
                await db.userDevice.update({
                    where: { id: deviceId },
                    data: {
                        lastSeenAt: new Date(),
                        pushToken: params.pushToken ?? undefined,
                        deviceType: params.deviceType as any,
                    },
                });
            }

            const now = new Date();
            const newRefreshPlain = randomToken(48);
            const newRefreshHash = sha256(newRefreshPlain);
            const newExpiresAt = new Date(now.getTime() + SCHOOL_AUTH_JWT.refreshTokenTtlSec * 1000);

            await db.authSession.update({
                where: { uuid: session.uuid },
                data: {
                    refreshTokenHash: newRefreshHash,
                    expiresAt: newExpiresAt,
                    lastSeenAt: now,
                },
            });

            return {
                sessionUuid: session.uuid,
                userId: session.userId,
                schoolId: session.schoolId,
                refreshToken: newRefreshPlain,
                refreshExpiresAt: newExpiresAt,
            };
        };

        if (
            typeof this.prisma.$transaction === 'function' &&
            typeof this.prisma.$queryRaw === 'function'
        ) {
            return this.prisma.$transaction((tx) => runInTx(tx));
        }
        return runInTx(this.prisma);
    }

    async revokeSession(params: { sessionUuid: string; reason: 'LOGOUT' | 'PASSWORD_CHANGED' | 'ADMIN_REVOKE' }) {
        const session = await this.prisma.authSession.findUnique({
            where: { uuid: params.sessionUuid },
            select: { uuid: true, revokedAt: true },
        });

        if (!session) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);
        if (session.revokedAt) return { success: true }; // idempotent

        await this.prisma.authSession.update({
            where: { uuid: params.sessionUuid },
            data: {
                revokedAt: new Date(),
                revokeReason: params.reason as any,
            },
        });

        return { success: true };
    }

    async revokeAllUserSessions(params: { userId: number; schoolId: number | null; reason: 'LOGOUT' | 'PASSWORD_CHANGED' | 'ADMIN_REVOKE' }) {
        await this.prisma.authSession.updateMany({
            where: {
                userId: params.userId,
                schoolId: params.schoolId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
                revokeReason: params.reason as any,
            },
        });

        return { success: true };
    }
}
