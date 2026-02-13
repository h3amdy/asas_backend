// src/school/sessions/sessions.service.ts



import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256, randomToken } from '../auth/utils/crypto.util';
import { SCHOOL_AUTH_JWT, SCHOOL_AUTH_ERRORS } from '../auth/constants';

type DeviceUpsertInput = {
    userId: number;
    deviceFingerprint: string;
    deviceType: 'ANDROID' | 'IOS' | 'WEB';
    pushToken?: string;
};

@Injectable()
export class SessionsService {
    constructor(private readonly prisma: PrismaService) { }

    async upsertDevice(input: DeviceUpsertInput) {
        const now = new Date();

        const device = await this.prisma.userDevice.upsert({
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
                isActive: true,
            },
            select: { id: true, uuid: true, userId: true, deviceFingerprint: true },
        });


        return device;
    }

    async createSession(params: {
        userId: number;
        schoolId: number | null;
        deviceId: number | null;
        refreshTokenPlain: string;
    }) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + SCHOOL_AUTH_JWT.refreshTokenTtlSec * 1000);

        const refreshTokenHash = sha256(params.refreshTokenPlain);

        const session = await this.prisma.authSession.create({
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

    async validateAndRotateRefresh(params: {
        sessionUuid: string;
        refreshTokenPlain: string;
        deviceFingerprint: string;
        deviceType: 'ANDROID' | 'IOS' | 'WEB';
        pushToken?: string;
    }) {
        const session = await this.prisma.authSession.findUnique({
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

        if (!session) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);
        if (session.revokedAt) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_REVOKED);
        if (session.expiresAt.getTime() <= Date.now()) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_EXPIRED);

        const incomingHash = sha256(params.refreshTokenPlain);
        if (incomingHash !== session.refreshTokenHash) {
            throw new ForbiddenException(SCHOOL_AUTH_ERRORS.REFRESH_TOKEN_INVALID);
        }

        let deviceId = session.deviceId;

        // إذا ما في جهاز مربوط (حالة قديمة/مهاجرة) نعمل upsert ونربط
        if (!deviceId) {
            const device = await this.upsertDevice({
                userId: session.userId,
                deviceFingerprint: params.deviceFingerprint,
                deviceType: params.deviceType,
                pushToken: params.pushToken,
            });
            deviceId = device.id;

            await this.prisma.authSession.update({
                where: { uuid: session.uuid },
                data: { deviceId },
            });
        } else {
            // ✅ التحقق من تطابق الجهاز قبل السماح بالـ refresh
            const existingDevice = await this.prisma.userDevice.findUnique({
                where: { id: deviceId },
                select: { deviceFingerprint: true, isActive: true },
            });

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
            await this.prisma.userDevice.update({
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

        await this.prisma.authSession.update({
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
