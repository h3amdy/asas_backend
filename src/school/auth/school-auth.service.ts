// src/school/auth/school-auth.service.ts

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { SCHOOL_AUTH_JWT, SCHOOL_AUTH_ERRORS } from './constants';
import { randomToken } from './utils/crypto.util';

type SafeUserPayload = {
  sub: string; // user uuid
  ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  sc: string; // school uuid
  sid: string; // session uuid
  uc?: number; // code
};

@Injectable()
export class SchoolAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) { }

  private buildAccessToken(payload: SafeUserPayload): string {
    return this.jwt.sign(payload, {
      expiresIn: SCHOOL_AUTH_JWT.accessTokenTtlSec,
      issuer: SCHOOL_AUTH_JWT.issuer,
      audience: SCHOOL_AUTH_JWT.audience,
    });
  }

  async login(input: {
    schoolUuid: string;
    identifier: string;
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

    if (!school) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SCHOOL_NOT_FOUND);
    if (!school.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_INACTIVE);

    // 2) Smart identifier resolution:
    //    أولاً: حاول تحويله إلى رقم → ابحث بالـ code (ADMIN/TEACHER/STUDENT)
    //    ثانياً: إذا لم يوجد → ابحث بالـ phone (PARENT فقط)
    const identifier = input.identifier.trim();
    if (!identifier) {
      throw new BadRequestException('identifier is required');
    }

    const userSelectFields = {
      id: true,
      uuid: true,
      userType: true,
      code: true,
      displayName: true,
      name: true,
      passwordHash: true,
      isActive: true,
    } as const;

    let user: {
      id: number;
      uuid: string;
      userType: string;
      code: number | null;
      displayName: string | null;
      name: string;
      passwordHash: string;
      isActive: boolean;
    } | null = null;

    // محاولة 1: البحث بالرقم المدرسي (code)
    const codeNum = Number(identifier);
    if (Number.isInteger(codeNum) && codeNum > 0) {
      user = await this.prisma.user.findFirst({
        where: {
          schoolId: school.id,
          isDeleted: false,
          code: codeNum,
          userType: { in: ['ADMIN', 'TEACHER', 'STUDENT'] },
        },
        select: userSelectFields,
      });
    }

    // محاولة 2: البحث بالهاتف (ولي أمر فقط)
    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          schoolId: school.id,
          isDeleted: false,
          userType: 'PARENT',
          phone: identifier,
        },
        select: userSelectFields,
      });
    }

    if (!user) throw new UnauthorizedException(SCHOOL_AUTH_ERRORS.INVALID_CREDENTIALS);

    // 3) password
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException(SCHOOL_AUTH_ERRORS.INVALID_CREDENTIALS);

    // ✅ تحقق من أن الحساب نشط (UX أفضل من إخفاء المستخدم)
    if (!user.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.USER_INACTIVE);

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
      sid: session.uuid,
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

    if (!user) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.USER_INACTIVE);
    if (!school) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_NOT_FOUND);
    if (!school.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_INACTIVE);

    // ✅ التحقق من تطابق المدرسة في الجلسة مع المدرسة الفعلية للمستخدم
    if (user.schoolId !== rotated.schoolId) {
      throw new ForbiddenException(SCHOOL_AUTH_ERRORS.INVALID_SESSION);
    }

    const accessToken = this.buildAccessToken({
      sub: user.uuid,
      ut: user.userType as any,
      sc: school.uuid,
      sid: rotated.sessionUuid,
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

  async logout(input: { sessionId: string; logoutAll?: boolean; currentUserUuid: string }) {
    // نحتاج userId/schoolId لو logoutAll
    const session = await this.prisma.authSession.findUnique({
      where: { uuid: input.sessionId },
      select: { uuid: true, userId: true, schoolId: true, revokedAt: true, user: { select: { uuid: true } } },
    });

    if (!session) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);

    // ✅ التحقق من أن الجلسة تخص المستخدم الحالي
    if (session.user.uuid !== input.currentUserUuid) {
      throw new ForbiddenException(SCHOOL_AUTH_ERRORS.NOT_YOUR_SESSION);
    }

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
