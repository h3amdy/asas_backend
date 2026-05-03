// src/owner/schools/schools-sync.controller.ts
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolsSyncService } from './schools-sync.service';
import {
  SchoolsSyncPullQueryDto,
  SchoolsSyncPushDto,
} from './dto/school-sync.dto';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';

@Controller('schools-sync')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class SchoolsSyncController {
  constructor(private readonly syncService: SchoolsSyncService) {}

  // GET api/v1/schools-sync?since=...&full=true
  @Get()
  pull(@Query() query: SchoolsSyncPullQueryDto) {
    return this.syncService.pullSync({
      since: query.since,
      full: query.full === 'true',
    });
  }

  // POST api/v1/schools-sync
  @Post()
  push(@Body() body: SchoolsSyncPushDto) {
    return this.syncService.pushSync(body);
  }
}