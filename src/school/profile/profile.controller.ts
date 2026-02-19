// src/school/profile/profile.controller.ts
import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeMyPasswordDto } from './dto/change-password.dto';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { CurrentSchoolUser } from '../common/decorators/current-user.decorator';

/**
 * 👤 متحكم الملف الشخصي لمستخدمي المدرسة
 * جميع الـ endpoints محمية بـ JWT + School Context
 */
@Controller('school/profile')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard)
export class ProfileController {
    constructor(private readonly profileService: ProfileService) { }

    /**
     * GET /school/profile/me
     * جلب بيانات الملف الشخصي
     */
    @Get('me')
    getMe(@CurrentUser() user: CurrentSchoolUser) {
        return this.profileService.getMe(user.sub);
    }

    /**
     * PATCH /school/profile/me
     * تعديل بيانات الملف الشخصي
     */
    @Patch('me')
    updateMe(
        @CurrentUser() user: CurrentSchoolUser,
        @Body() dto: UpdateProfileDto,
    ) {
        return this.profileService.updateMe(user.sub, dto);
    }

    /**
     * POST /school/profile/change-password
     * تغيير كلمة المرور بدون تسجيل خروج
     */
    @Post('change-password')
    changePassword(
        @CurrentUser() user: CurrentSchoolUser,
        @Body() dto: ChangeMyPasswordDto,
    ) {
        return this.profileService.changePassword(user.sub, dto);
    }
}
