// src/platform/auth/platform-auth.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
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
   */
  @Post('login')
  async login(@Body() dto: PlatformLoginDto) {
    return this.authService.login(dto);
  }

  /**
   * POST /auth/platform/refresh
   * تجديد التوكن باستخدام refresh token
   */
  @Post('refresh')
  async refresh(@Body() dto: PlatformRefreshDto) {
    return this.authService.refresh(dto);
  }

  /**
   * POST /auth/platform/logout
   * تسجيل الخروج — إبطال الـ refresh token
   */
  @UseGuards(PlatformJwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    const userUuid = req.user?.sub;
    return this.authService.logout(userUuid);
  }
}
