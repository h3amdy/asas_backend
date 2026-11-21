// src/platform/sessions/platform-sessions.service.ts

import {
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256, randomToken } from '../../school/auth/utils/crypto.util';
import { PLATFORM_AUTH_JWT, PLATFORM_AUTH_ERRORS } from '../auth/constants';

function timingSafeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

@Injectable()
export class PlatformSessionsService {
    private readonly logger = new Logger(PlatformSessionsService.name);

    constructor(private readonly prisma: PrismaService) { }

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
     * تحقق ذري من صلاحية الجلسة وحالة المستخدم + تدوير الـ refresh token
     * 🛡️ SEC-AUTH-08:
     * - قفل صف الجلسة (`FOR UPDATE OF s`) يمنع TOCTOU عند الطلبات المتزامنة.
     * - مقارنة constant-time للبصمة + إبطال الجلسة فوراً (COMMITTED) عند إعادة الاستخدام أو عدم التطابق.
     * - فحص `is_active` و`is_deleted` قبل التدوير أو تمديد `expires_at`.
     */
    async validateAndRotateRefresh(params: {
        sessionUuid: string;
        refreshTokenPlain: string;
    }) {
        const now = new Date();
        const incomingHash = sha256(params.refreshTokenPlain);
        const newRefreshPlain = randomToken(48);
        const newRefreshHash = sha256(newRefreshPlain);
        const newExpiresAt = new Date(
            now.getTime() + PLATFORM_AUTH_JWT.refreshTokenTtlSec * 1000,
        );

        const outcome = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
                Array<{
                    id: number;
                    uuid: string;
                    platform_user_id: number;
                    refresh_token_hash: string;
                    expires_at: Date;
                    revoked_at: Date | null;
                    user_uuid: string | null;
                    user_role: string | null;
                    user_is_active: boolean | null;
                    user_is_deleted: boolean | null;
                }>
            >`
                SELECT
                    s."id",
                    s."uuid",
                    s."platform_user_id",
                    s."refresh_token_hash",
                    s."expires_at",
                    s."revoked_at",
                    u."uuid" AS "user_uuid",
                    u."role"::text AS "user_role",
                    u."is_active" AS "user_is_active",
                    u."is_deleted" AS "user_is_deleted"
                FROM "platform_auth_sessions" s
                LEFT JOIN "platform_users" u ON u."id" = s."platform_user_id"
                WHERE s."uuid" = ${params.sessionUuid}
                FOR UPDATE OF s
            `;

            const row = rows[0];
            if (!row) {
                return { status: 'NOT_FOUND' as const };
            }

            if (row.revoked_at) {
                return {
                    status: 'REVOKED' as const,
                    sessionUuid: row.uuid,
                    platformUserId: row.platform_user_id,
                };
            }

            if (new Date(row.expires_at).getTime() <= now.getTime()) {
                return { status: 'EXPIRED' as const };
            }

            if (!timingSafeEqualHex(incomingHash, row.refresh_token_hash)) {
                await tx.$executeRaw`
                    UPDATE "platform_auth_sessions"
                    SET "revoked_at" = ${now},
                        "revoke_reason" = 'ADMIN_REVOKE'::"RevokeReason"
                    WHERE "id" = ${row.id}
                      AND "revoked_at" IS NULL
                `;
                return {
                    status: 'REUSE_REVOKED' as const,
                    sessionUuid: row.uuid,
                    platformUserId: row.platform_user_id,
                };
            }

            if (
                !row.user_uuid ||
                !row.user_role ||
                row.user_is_deleted !== false ||
                row.user_is_active !== true
            ) {
                await tx.$executeRaw`
                    UPDATE "platform_auth_sessions"
                    SET "revoked_at" = ${now},
                        "revoke_reason" = 'ADMIN_REVOKE'::"RevokeReason"
                    WHERE "id" = ${row.id}
                      AND "revoked_at" IS NULL
                `;
                return {
                    status: 'ACCOUNT_DISABLED' as const,
                    sessionUuid: row.uuid,
                    platformUserId: row.platform_user_id,
                };
            }

            const updatedCount = await tx.$executeRaw`
                UPDATE "platform_auth_sessions"
                SET "refresh_token_hash" = ${newRefreshHash},
                    "expires_at" = ${newExpiresAt},
                    "last_seen_at" = ${now}
                WHERE "id" = ${row.id}
                  AND "refresh_token_hash" = ${incomingHash}
                  AND "revoked_at" IS NULL
            `;

            if (updatedCount !== 1) {
                return {
                    status: 'REVOKED' as const,
                    sessionUuid: row.uuid,
                    platformUserId: row.platform_user_id,
                };
            }

            return {
                status: 'OK' as const,
                sessionUuid: row.uuid,
                platformUserId: row.platform_user_id,
                userUuid: row.user_uuid,
                userRole: row.user_role,
            };
        });

        switch (outcome.status) {
            case 'NOT_FOUND':
                throw new NotFoundException(PLATFORM_AUTH_ERRORS.SESSION_NOT_FOUND);
            case 'REVOKED':
                throw new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED);
            case 'EXPIRED':
                throw new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_EXPIRED);
            case 'REUSE_REVOKED':
                this.logger.warn(
                    `SEC-AUTH-08: Refresh token reuse or mismatch detected; revoked platform session ${outcome.sessionUuid} (userId=${outcome.platformUserId}).`,
                );
                throw new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED);
            case 'ACCOUNT_DISABLED':
                throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED);
            case 'OK':
                return {
                    sessionUuid: outcome.sessionUuid,
                    platformUserId: outcome.platformUserId,
                    userUuid: outcome.userUuid,
                    userRole: outcome.userRole,
                    refreshToken: newRefreshPlain,
                    refreshExpiresAt: newExpiresAt,
                };
        }
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
    async revokeAllUserSessions(
        params: {
            platformUserId: number;
            reason: 'LOGOUT' | 'PASSWORD_CHANGED' | 'ADMIN_REVOKE';
        },
        tx?: Prisma.TransactionClient,
    ) {
        const db = tx ?? this.prisma;
        await db.platformAuthSession.updateMany({
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
