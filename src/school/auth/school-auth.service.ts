// src/school/auth/school-auth.service.ts

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { SCHOOL_AUTH_JWT } from './constants';
import { randomToken } from './utils/crypto.util';

type SafeUserPayload = {
  sub: string; // user uuid
  ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  sc: string; // school uuid
  uc?: number; // code
};

@Injectable()
export class SchoolAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  private buildAccessToken(payload: SafeUserPayload): string {
    return this.jwt.sign(payload, {
      expiresIn: SCHOOL_AUTH_JWT.accessTokenTtlSec,
      issuer: SCHOOL_AUTH_JWT.issuer,
      audience: SCHOOL_AUTH_JWT.audience,
    });
  }

  async login(input: {
    schoolUuid: string;
    userCode?: number;
    phone?: string;
    password: string;
    deviceFingerprint: string;
    deviceType: 'ANDROID' | 'IOS' | 'WEB';
    pushToken?: string;
  }) {
    // 1) school
    const school = await this.prisma.school.findFirst({
      where: { uuid: input.schoolUuid, isDeleted: false },
      select: { id: true, uuid: true, isActive: true, appType: true, displayName: true, name: true },
    });

    if (!school) throw new NotFoundException('School not found');
    if (!school.isActive) throw new ForbiddenException('School is not active');

    // 2) find user by login mode
    const hasPhone = !!(input.phone && input.phone.trim());
    const hasCode = Number.isInteger(input.userCode) && (input.userCode as number) > 0;

    if (!hasPhone && !hasCode) {
      throw new BadRequestException('Either phone or userCode is required');
    }
    if (hasPhone && hasCode) {
      throw new BadRequestException('Provide only one of phone or userCode');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        schoolId: school.id,
        isDeleted: false,
        isActive: true,
        ...(hasPhone
          ? { userType: 'PARENT', phone: input.phone!.trim() }
          : { userType: { in: ['ADMIN', 'TEACHER', 'STUDENT'] }, code: input.userCode! }),
      },
      select: {
        id: true,
        uuid: true,
        userType: true,
        code: true,
        displayName: true,
        name: true,
        passwordHash: true,
      },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    // 3) password
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // 4) device upsert
    const device = await this.sessions.upsertDevice({
      userId: user.id,
      deviceFingerprint: input.deviceFingerprint,
      deviceType: input.deviceType,
      pushToken: input.pushToken,
    });

    // 5) session + refresh token
    const refreshPlain = randomToken(48);
    const session = await this.sessions.createSession({
      userId: user.id,
      schoolId: school.id,
      deviceId: device.id,
      refreshTokenPlain: refreshPlain,
    });

    // 6) access token
    const accessToken = this.buildAccessToken({
      sub: user.uuid,
      ut: user.userType as any,
      sc: school.uuid,
      uc: user.code ?? undefined,
    });

    return {
      accessToken,
      refreshToken: refreshPlain,
      sessionId: session.uuid,
      refreshExpiresAt: session.expiresAt,

      user: {
        uuid: user.uuid,
        userType: user.userType,
        code: user.code ?? null,
        displayName: user.displayName ?? user.name, // ✅ لا نرجّع الاسم الرسمي كحقل مستقل
      },

      school: {
        uuid: school.uuid,
        displayName: school.displayName ?? school.name, // للعرض فقط
        appType: school.appType,
      },
    };
  }

  async refresh(input: {
    sessionId: string;
    refreshToken: string;
    deviceFingerprint: string;
    deviceType: 'ANDROID' | 'IOS' | 'WEB';
    pushToken?: string;
  }) {
    const rotated = await this.sessions.validateAndRotateRefresh({
      sessionUuid: input.sessionId,
      refreshTokenPlain: input.refreshToken,
      deviceFingerprint: input.deviceFingerprint,
      deviceType: input.deviceType,
      pushToken: input.pushToken,
    });

    // تأكيد وجود المستخدم + المدرسة (مع حالة active)
    const [user, school] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: rotated.userId, isDeleted: false, isActive: true },
        select: { uuid: true, userType: true, code: true, displayName: true, name: true, schoolId: true },
      }),
      rotated.schoolId
        ? this.prisma.school.findFirst({
            where: { id: rotated.schoolId, isDeleted: false },
            select: { uuid: true, isActive: true, displayName: true, name: true, appType: true },
          })
        : null,
    ]);

    if (!user) throw new ForbiddenException('User not active');
    if (!school) throw new ForbiddenException('School not found');
    if (!school.isActive) throw new ForbiddenException('School is not active');

    const accessToken = this.buildAccessToken({
      sub: user.uuid,
      ut: user.userType as any,
      sc: school.uuid,
      uc: user.code ?? undefined,
    });

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      sessionId: rotated.sessionUuid,
      refreshExpiresAt: rotated.refreshExpiresAt,
      user: {
        uuid: user.uuid,
        userType: user.userType,
        code: user.code ?? null,
        displayName: user.displayName ?? user.name,
      },
      school: {
        uuid: school.uuid,
        displayName: school.displayName ?? school.name,
        appType: school.appType,
      },
    };
  }

  async logout(input: { sessionId: string; logoutAll?: boolean }) {
    // نحتاج userId/schoolId لو logoutAll
    const session = await this.prisma.authSession.findUnique({
      where: { uuid: input.sessionId },
      select: { uuid: true, userId: true, schoolId: true, revokedAt: true },
    });

    if (!session) throw new NotFoundException('Session not found');

    if (input.logoutAll) {
      await this.sessions.revokeAllUserSessions({
        userId: session.userId,
        schoolId: session.schoolId,
        reason: 'LOGOUT',
      });
      return { success: true, logoutAll: true };
    }

    await this.sessions.revokeSession({ sessionUuid: session.uuid, reason: 'LOGOUT' });
    return { success: true, logoutAll: false };
  }
}
