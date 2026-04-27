// src/platform/auth/platform-auth.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/platform-login.dto';

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
}
