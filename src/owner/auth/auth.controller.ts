// src/auth/auth.controller.ts
import { Controller, Post, Body, Patch, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OwnerLoginDto } from './dto/owner-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('owner/login')
  ownerLogin(@Body() dto: OwnerLoginDto) {
    return this.authService.loginOwner(dto);
  }

  // 🔒 تغيير كلمة المرور – يحتاج توكن
  @UseGuards(JwtAuthGuard)
  @Patch('owner/change-password')
  changeOwnerPassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    const userId = req.user?.sub; // جاي من payload اللي في التوكن
    return this.authService.changePassword(userId, dto);
  }
}