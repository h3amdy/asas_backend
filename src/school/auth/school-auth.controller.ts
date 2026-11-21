// src/school/auth/school-auth.controller.ts

/**
 * 🎮 متحكم مصادقة المدرسة
 * يدير endpoints تسجيل الدخول والخروج وتجديد التوكن
 */

import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SchoolAuthService } from './school-auth.service';
import { SchoolLoginDto } from './dto/school-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { SchoolJwtAuthGuard } from './guards/school-jwt-auth.guard';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoginLockoutException } from './login-lockout.service';

@Controller('school/auth')
export class SchoolAuthController {
  constructor(private readonly auth: SchoolAuthService) { }
  /**
      * تسجيل دخول مستخدمي المدرسة (ADMIN/TEACHER/STUDENT/PARENT) بالرقم المدرسي الموحد
      *
      * 🛡️ SR-NUM-001: ThrottlerGuard إلزامي — ThrottlerModule غير مطبّق عالمياً،
      * و @Throttle وحده لا يحمي شيئاً. المفاتيح short/long تطابق أسماء AppModule
      * (مفتاح باسم غير معرّف يُتجاهل بصمت).
      */
  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 10 },
    long: { ttl: 3600000, limit: 100 },
  })
  async login(
    @Body() dto: SchoolLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = req?.ip ?? req?.socket?.remoteAddress ?? 'unknown';
    try {
      return await this.auth.login(dto, { clientIp });
    } catch (err) {
      if (err instanceof LoginLockoutException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }
  }
  /**
      * تجديد التوكن باستخدام refresh token
      * 🛡️ SEC-AUTH-01: حماية مسار التجديد بـ ThrottlerGuard
      */
  @Post('refresh')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 20 },
    long: { ttl: 3600000, limit: 200 },
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  /**
   * تسجيل الخروج وإلغاء الجلسة
   * ✅ محمي بـ JWT - يجب أن تكون الجلسة تخص المستخدم الحالي
   */
  @UseGuards(SchoolJwtAuthGuard)
  @Post('logout')
  logout(@Body() dto: LogoutDto, @Req() req: any) {
    return this.auth.logout({
      sessionId: dto.sessionId,
      logoutAll: dto.logoutAll,
      currentUserUuid: req.user.sub,
    });
  }
}
