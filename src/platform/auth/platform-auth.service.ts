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

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private sessions: PlatformSessionsService,
  ) {}

  /**
   * تسجيل دخول منصة المحتوى (PLT-001)
   * يدعم تسجيل الدخول بالبريد الإلكتروني أو اسم المستخدم
   * يرجع accessToken + refreshToken + sessionId
   */
  async login(dto: PlatformLoginDto) {
    const { login, password } = dto;

    // 1) البحث بالبريد أو اسم المستخدم
    const user = await this.prisma.platformUser.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { email: login },
          { username: login },
        ],
      },
    });

    // 2) التحقق من وجود المستخدم
    if (!user) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // 3) التحقق من أن الحساب نشط
    if (!user.isActive) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED);
    }

    // 4) التحقق من كلمة المرور
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // 5) إنشاء جلسة + refresh token
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
   * بحث O(1) بدلاً من O(n)
   */
  async refresh(dto: PlatformRefreshDto) {
    const { sessionId, refreshToken } = dto;

    // 1) تحقق + تدوير الـ refresh token
    const rotated = await this.sessions.validateAndRotateRefresh({
      sessionUuid: sessionId,
      refreshTokenPlain: refreshToken,
    });

    // 2) التأكد من أن المستخدم لا يزال نشطاً
    const user = await this.prisma.platformUser.findFirst({
      where: {
        id: rotated.platformUserId,
        isDeleted: false,
        isActive: true,
      },
      select: { uuid: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED);
    }

    // 3) توليد access token جديد
    const accessToken = this.buildAccessToken(user.uuid, user.role, rotated.sessionUuid);

    // 4) إرجاع التوكنات الجديدة
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
