// src/school/auth/school-auth.controller.ts

/**
 * 🎮 متحكم مصادقة المدرسة
 * يدير endpoints تسجيل الدخول والخروج وتجديد التوكن
 */

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SchoolAuthService } from './school-auth.service';
import { SchoolLoginDto } from './dto/school-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { SchoolJwtAuthGuard } from './guards/school-jwt-auth.guard';

@Controller('school/auth')
export class SchoolAuthController {
  constructor(private readonly auth: SchoolAuthService) { }
  /**
      * تسجيل دخول مستخدمي المدرسة (ADMIN/TEACHER/STUDENT/PARENT)
      */
  @Post('login')
  login(@Body() dto: SchoolLoginDto) {
    return this.auth.login(dto);
  }
  /**
      * تجديد التوكن باستخدام refresh token
      */
  @Post('refresh')
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
