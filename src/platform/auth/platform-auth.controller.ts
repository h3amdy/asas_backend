// src/platform/auth/platform-auth.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformRefreshDto } from './dto/platform-refresh.dto';
import { PlatformJwtAuthGuard } from './guards/platform-jwt-auth.guard';

@Controller('auth/platform')
export class PlatformAuthController {
  constructor(private authService: PlatformAuthService) {}

  /**
   * POST /auth/platform/login
   * تسجيل دخول منصة المحتوى (PLT-001)
   * يدعم البريد الإلكتروني أو اسم المستخدم
   * 🛡️ SEC-AUTH-01: تقييد محاولات الدخول عبر ThrottlerGuard
   */
  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 10 },
    long: { ttl: 3600000, limit: 60 },
  })
  async login(@Body() dto: PlatformLoginDto) {
    return this.authService.login(dto);
  }

  /**
   * POST /auth/platform/refresh
   * تجديد التوكن باستخدام sessionId + refresh token
   * 🛡️ SEC-AUTH-01: تقييد محاولات التجديد عبر ThrottlerGuard
   */
  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 20 },
    long: { ttl: 3600000, limit: 200 },
  })
  async refresh(@Body() dto: PlatformRefreshDto) {
    return this.authService.refresh(dto);
  }

  /**
   * POST /auth/platform/logout
   * تسجيل الخروج — إبطال الجلسة الحالية
   */
  @UseGuards(PlatformJwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    const userUuid = req.user?.sub;
    const sessionUuid = req.user?.sid;
    return this.authService.logout(sessionUuid, userUuid);
  }
}
