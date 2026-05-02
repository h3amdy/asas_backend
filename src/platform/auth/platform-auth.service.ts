// src/platform/auth/platform-auth.service.ts
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformRefreshDto } from './dto/platform-refresh.dto';
import { PLATFORM_AUTH_ERRORS, PLATFORM_AUTH_JWT } from './constants';

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * تسجيل دخول منصة المحتوى (PLT-001)
   * يدعم تسجيل الدخول بالبريد الإلكتروني أو اسم المستخدم
   * يرجع accessToken + refreshToken
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

    // 5) توليد التوكنات
    const tokens = await this.generateTokens(user.uuid, user.role);

    // 6) حفظ refresh token hash في قاعدة البيانات
    await this.saveRefreshToken(user.uuid, tokens.refreshToken);

    // 7) إرجاع التوكنات + بيانات المستخدم
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
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
   * تجديد التوكن باستخدام refresh token
   */
  async refresh(dto: PlatformRefreshDto) {
    const { refreshToken } = dto;

    // 1) Hash الـ refresh token للبحث
    const tokenHash = await bcrypt.hash(refreshToken, 10);

    // 2) البحث عن المستخدم بالـ refresh token
    // نجلب كل المستخدمين الذين لديهم refreshTokenHash ونقارن
    const users = await this.prisma.platformUser.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        refreshTokenHash: { not: null },
        refreshExpiresAt: { gt: new Date() }, // لم ينتهِ
      },
    });

    let matchedUser: (typeof users)[number] | null = null;
    for (const user of users) {
      if (user.refreshTokenHash) {
        const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
        if (isValid) {
          matchedUser = user;
          break;
        }
      }
    }

    if (!matchedUser) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_REFRESH_TOKEN);
    }

    // 3) توليد توكنات جديدة
    const tokens = await this.generateTokens(matchedUser.uuid, matchedUser.role);

    // 4) حفظ refresh token الجديد (يُبطل القديم)
    await this.saveRefreshToken(matchedUser.uuid, tokens.refreshToken);

    // 5) إرجاع التوكنات الجديدة
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
  }

  /**
   * تسجيل الخروج — إبطال الـ refresh token
   */
  async logout(userUuid: string) {
    await this.prisma.platformUser.update({
      where: { uuid: userUuid },
      data: {
        refreshTokenHash: null,
        refreshExpiresAt: null,
      },
    });

    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  // ══════════════════════════════════════
  //  دوال مساعدة داخلية
  // ══════════════════════════════════════

  /**
   * توليد access token + refresh token
   */
  private async generateTokens(userUuid: string, role: string) {
    // Access Token (JWT)
    const payload = {
      sub: userUuid,
      role: role,   // PLATFORM_ADMIN | PLATFORM_TEACHER
    };
    const accessToken = await this.jwtService.signAsync(payload);

    // Refresh Token (random opaque string — ليس JWT)
    const refreshToken = randomBytes(48).toString('hex');

    // تاريخ انتهاء الـ refresh token
    const refreshExpiresAt = new Date(
      Date.now() + PLATFORM_AUTH_JWT.refreshTokenTtlSec * 1000,
    );

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  /**
   * حفظ hash الـ refresh token في قاعدة البيانات
   */
  private async saveRefreshToken(userUuid: string, refreshToken: string) {
    const hash = await bcrypt.hash(refreshToken, 10);

    await this.prisma.platformUser.update({
      where: { uuid: userUuid },
      data: {
        refreshTokenHash: hash,
        refreshExpiresAt: new Date(
          Date.now() + PLATFORM_AUTH_JWT.refreshTokenTtlSec * 1000,
        ),
      },
    });
  }
}
