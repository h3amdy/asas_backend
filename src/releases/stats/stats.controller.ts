import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';

@Controller('releases/stats')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('overview')
  overview() {
    return this.statsService.overview();
  }

  @Get('apps/:appUuid/devices')
  devicesByVersion(@Param('appUuid') appUuid: string) {
    return this.statsService.devicesByVersion(appUuid);
  }
}
