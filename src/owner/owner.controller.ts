import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { OwnerService } from './owner.service';
import { UpdateOwnerDto } from './dto/update-owner.dto';
import { PlatformJwtAuthGuard } from '../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../platform/auth/guards/platform-admin.guard';

@Controller('owner')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class OwnerController {
  constructor(private ownerService: OwnerService) {}

  @Get('profile')
  getOwner() {
    return this.ownerService.getOwner();
  }

  @Patch('profile')
  updateOwner(@Body() dto: UpdateOwnerDto) {
    return this.ownerService.updateOwnerProfile(dto);
  }
}