// src/platform/auth/platform-auth.service.ts
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformSessionsService } from '../sessions/platform-sessions.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformRefreshDto } from './dto/platform-refresh.dto';
import { PLATFORM_AUTH_ERRORS, PLATFORM_AUTH_JWT } from './constants';
import { randomToken } from '../../school/auth/utils/crypto.util';
import { LoginLockoutService } from '../../school/auth/login-lockout.service';

/**
 * hash ثابت (cost=10 مثل حسابات المنصة) لتوحيد زمن bcrypt عند عدم وجود الحساب
 * ومنع كشف وجود البريد/اسم المستخدم أو حالة تعطيل الحساب عبر التوقيت.
 */
const PLATFORM_TIMING_DUMMY_HASH = bcrypt.hashSync(
  'asas-platform-timing-equalizer',
  10,
);

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private sessions: PlatformSessionsService,
    private readonly lockout: LoginLockoutService,
  ) {}

  /**
   * تسجيل دخول منصة المحتوى (PLT-001)
   * يدعم تسجيل الدخول بالبريد الإلكتروني أو اسم المستخدم
   * يرجع accessToken + refreshToken + sessionId
   */
  async login(dto: PlatformLoginDto, context: { clientIp?: string } = {}) {
    const { password } = dto;
    const lookupLogin = dto.login.trim();
    const clientIp = context.clientIp ?? 'unknown';

    // 1) فحص القفل المؤقت من PostgreSQL قبل أي استعلام أو bcrypt
    await this.lockout.assertPlatformNotLocked(lookupLogin, clientIp);

    // 2) البحث بالبريد أو اسم المستخدم (متطابق بدون حساسية حالة الأحرف مع تطبيع القفل)
    const user = await this.prisma.platformUser.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { email: { equals: lookupLogin, mode: 'insensitive' } },
          { username: { equals: lookupLogin, mode: 'insensitive' } },
        ],
      },
    });

    // 2b) فحص القفل الموحّد على مستوى الحساب (يمنع تبديل البريد/اسم المستخدم لتجاوز القفل) قبل bcrypt
    if (user) {
      await this.lockout.assertPlatformAccountNotLocked(user.id, clientIp);
    }

    // 3) التحقق من كلمة المرور دائماً (حتى مع حساب غير موجود) لمنع تسريب التوقيت
    const hashToVerify = user?.passwordHash ?? PLATFORM_TIMING_DUMMY_HASH;
    const isMatch = await bcrypt.compare(password, hashToVerify);

    if (!user || !isMatch) {
      await this.lockout.recordPlatformFailedAttempt(
        lookupLogin,
        clientIp,
        user?.id,
      );
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // 4) التحقق من أن الحساب نشط بعد نجاح كلمة المرور فقط (عدم كشف التعطيل بكلمة مرور خاطئة)
    if (!user.isActive) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED);
    }

    // 5) تصفير عدادات القفل للـ IP الحالي والنطاق العام للمعرّف والحساب عند النجاح
    await this.lockout.clearPlatformOnSuccess(lookupLogin, clientIp, {
      platformUserId: user.id,
      email: user.email,
      username: user.username,
    });

    // 6) إنشاء جلسة + refresh token
    const refreshPlain = randomToken(48);
    const session = await this.sessions.createSession({
      platformUserId: user.id,
      refreshTokenPlain: refreshPlain,
    });

    // 6) توليد access token (مع session ID)
    const accessToken = this.buildAccessToken(user.uuid, user.role, session.uuid);

    // 7) إرجاع التوكنات + بيانات المستخدم
    return {
      accessToken,
      refreshToken: refreshPlain,
      sessionId: session.uuid,
      refreshExpiresAt: session.expiresAt.toISOString(),
      user: {
        uuid: user.uuid,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }

  /**
   * تجديد التوكن باستخدام sessionId + refresh token
   * بحث O(1) ذري مع فحص حالة الحساب قبل التدوير وكشف إعادة الاستخدام (SEC-AUTH-08)
   */
  async refresh(dto: PlatformRefreshDto) {
    const { sessionId, refreshToken } = dto;

    // 1) تحقق ذري + فحص حالة الحساب + تدوير الـ refresh token مع كشف إعادة الاستخدام
    const rotated = await this.sessions.validateAndRotateRefresh({
      sessionUuid: sessionId,
      refreshTokenPlain: refreshToken,
    });

    // 2) توليد access token جديد
    const accessToken = this.buildAccessToken(
      rotated.userUuid,
      rotated.userRole,
      rotated.sessionUuid,
    );

    // 3) إرجاع التوكنات الجديدة
    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      sessionId: rotated.sessionUuid,
      refreshExpiresAt: rotated.refreshExpiresAt.toISOString(),
    };
  }

  /**
   * تسجيل الخروج — إبطال الجلسة
   */
  async logout(sessionUuid: string, userUuid: string) {
    // التحقق من أن الجلسة تخص المستخدم الحالي
    const session = await this.prisma.platformAuthSession.findUnique({
      where: { uuid: sessionUuid },
      select: {
        uuid: true,
        platformUser: { select: { uuid: true } },
      },
    });

    if (session && session.platformUser.uuid !== userUuid) {
      // الجلسة موجودة لكن ليست للمستخدم الحالي — تجاهل بصمت
      return { message: 'تم تسجيل الخروج بنجاح' };
    }

    if (session) {
      await this.sessions.revokeSession({
        sessionUuid: session.uuid,
        reason: 'LOGOUT',
      });
    }

    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  // ══════════════════════════════════════
  //  دوال مساعدة داخلية
  // ══════════════════════════════════════

  /**
   * بناء access token مع session ID
   */
  private buildAccessToken(userUuid: string, role: string, sessionUuid: string): string {
    const payload = {
      sub: userUuid,
      role,
      sid: sessionUuid,
    };
    return this.jwtService.sign(payload);
  }
}
