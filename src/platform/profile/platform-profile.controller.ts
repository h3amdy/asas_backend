// src/platform/profile/platform-profile.controller.ts
import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PlatformProfileService } from './platform-profile.service';
import { UpdateProfileDto, ChangePasswordDto } from './dto/update-profile.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';

@Controller('platform/profile')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformProfileController {
  constructor(private profileService: PlatformProfileService) {}

  /**
   * GET /platform/profile
   * جلب الملف الشخصي (PLT-002)
   */
  @Get()
  async getProfile(@Request() req) {
    return this.profileService.getProfile(req.user.sub);
  }

  /**
   * PATCH /platform/profile
   * تعديل الملف الشخصي (PLT-002)
   */
  @Patch()
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.sub, dto);
  }

  /**
   * PATCH /platform/profile/password
   * تغيير كلمة المرور (PLT-002)
   */
  @Patch('password')
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.profileService.changePassword(req.user.sub, dto);
  }
}
