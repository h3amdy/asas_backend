// src/platform/sessions/platform-sessions.service.ts

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256, randomToken } from '../../school/auth/utils/crypto.util';
import { PLATFORM_AUTH_JWT, PLATFORM_AUTH_ERRORS } from '../auth/constants';

@Injectable()
export class PlatformSessionsService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * إنشاء جلسة جديدة لمستخدم المنصة
     */
    async createSession(params: {
        platformUserId: number;
        refreshTokenPlain: string;
    }) {
        const now = new Date();
        const expiresAt = new Date(
            now.getTime() + PLATFORM_AUTH_JWT.refreshTokenTtlSec * 1000,
        );

        const refreshTokenHash = sha256(params.refreshTokenPlain);

        const session = await this.prisma.platformAuthSession.create({
            data: {
                platformUserId: params.platformUserId,
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
     * تحقق من صلاحية الجلسة + تدوير الـ refresh token
     * بحث O(1) باستخدام session UUID + SHA256 مقارنة
     */
    async validateAndRotateRefresh(params: {
        sessionUuid: string;
        refreshTokenPlain: string;
    }) {
        const session = await this.prisma.platformAuthSession.findUnique({
            where: { uuid: params.sessionUuid },
            select: {
                id: true,
                uuid: true,
                platformUserId: true,
                refreshTokenHash: true,
                expiresAt: true,
                revokedAt: true,
            },
        });

        if (!session) {
            throw new NotFoundException(PLATFORM_AUTH_ERRORS.SESSION_NOT_FOUND);
        }
        if (session.revokedAt) {
            throw new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED);
        }
        if (session.expiresAt.getTime() <= Date.now()) {
            throw new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_EXPIRED);
        }

        // مقارنة SHA256 — سريعة O(1)
        const incomingHash = sha256(params.refreshTokenPlain);
        if (incomingHash !== session.refreshTokenHash) {
            throw new ForbiddenException(PLATFORM_AUTH_ERRORS.INVALID_REFRESH_TOKEN);
        }

        // تدوير الـ refresh token
        const now = new Date();
        const newRefreshPlain = randomToken(48);
        const newRefreshHash = sha256(newRefreshPlain);
        const newExpiresAt = new Date(
            now.getTime() + PLATFORM_AUTH_JWT.refreshTokenTtlSec * 1000,
        );

        await this.prisma.platformAuthSession.update({
            where: { uuid: session.uuid },
            data: {
                refreshTokenHash: newRefreshHash,
                expiresAt: newExpiresAt,
                lastSeenAt: now,
            },
        });

        return {
            sessionUuid: session.uuid,
            platformUserId: session.platformUserId,
            refreshToken: newRefreshPlain,
            refreshExpiresAt: newExpiresAt,
        };
    }

    /**
     * إبطال جلسة واحدة
     */
    async revokeSession(params: {
        sessionUuid: string;
        reason: 'LOGOUT' | 'PASSWORD_CHANGED' | 'ADMIN_REVOKE';
    }) {
        const session = await this.prisma.platformAuthSession.findUnique({
            where: { uuid: params.sessionUuid },
            select: { uuid: true, revokedAt: true },
        });

        if (!session) {
            throw new NotFoundException(PLATFORM_AUTH_ERRORS.SESSION_NOT_FOUND);
        }
        if (session.revokedAt) return { success: true }; // idempotent

        await this.prisma.platformAuthSession.update({
            where: { uuid: params.sessionUuid },
            data: {
                revokedAt: new Date(),
                revokeReason: params.reason as any,
            },
        });

        return { success: true };
    }

    /**
     * إبطال كل جلسات المستخدم (مثلاً عند تغيير كلمة المرور)
     */
    async revokeAllUserSessions(params: {
        platformUserId: number;
        reason: 'LOGOUT' | 'PASSWORD_CHANGED' | 'ADMIN_REVOKE';
    }) {
        await this.prisma.platformAuthSession.updateMany({
            where: {
                platformUserId: params.platformUserId,
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
