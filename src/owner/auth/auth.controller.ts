// src/owner/auth/auth.controller.ts
import { Controller, Post, Body, Patch, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OwnerLoginDto } from './dto/owner-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { OwnerJwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('owner/login')
  ownerLogin(@Body() dto: OwnerLoginDto) {
    return this.authService.loginOwner(dto);
  }

  // 🔒 تغيير كلمة المرور – يحتاج توكن
  @UseGuards(OwnerJwtAuthGuard)
  @Patch('owner/change-password')
  changeOwnerPassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    const userUuid = req.user?.sub;  // ✅ uuid
    return this.authService.changePassword(userUuid, dto);


  }
}