// src/platform/users/platform-users.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PlatformUsersService } from './platform-users.service';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';

@Controller('platform/users')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class PlatformUsersController {
  constructor(private usersService: PlatformUsersService) {}

  /**
   * GET /platform/users
   * قائمة معلمي المنصة (PLT-010)
   */
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  /**
   * GET /platform/users/:uuid
   * تفاصيل معلم (PLT-013)
   */
  @Get(':uuid')
  async findOne(@Param('uuid') uuid: string) {
    return this.usersService.findOne(uuid);
  }

  /**
   * POST /platform/users
   * إضافة معلم منصة (PLT-011)
   */
  @Post()
  async create(@Body() dto: CreatePlatformUserDto) {
    return this.usersService.create(dto);
  }

  /**
   * PATCH /platform/users/:uuid
   * تعديل بيانات معلم (PLT-012)
   */
  @Patch(':uuid')
  async update(
    @Param('uuid') uuid: string,
    @Body() dto: UpdatePlatformUserDto,
  ) {
    return this.usersService.update(uuid, dto);
  }

  /**
   * PATCH /platform/users/:uuid/status
   * تعطيل/تفعيل حساب (PLT-014)
   */
  @Patch(':uuid/status')
  async toggleStatus(
    @Param('uuid') uuid: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.usersService.toggleStatus(uuid, isActive);
  }

  /**
   * POST /platform/users/:uuid/reset-password
   * إعادة تعيين كلمة المرور (PLT-013)
   */
  @Post(':uuid/reset-password')
  async resetPassword(
    @Param('uuid') uuid: string,
    @Body('newPassword') newPassword?: string,
  ) {
    return this.usersService.resetPassword(uuid, newPassword);
  }
}
