// src/schools/schools-sync.controller.ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SchoolsSyncService } from './schools-sync.service';
import {
  SchoolsSyncPullQueryDto,
  SchoolsSyncPushDto,
} from './dto/school-sync.dto';

@Controller('schools/sync')
export class SchoolsSyncController {
  constructor(private readonly syncService: SchoolsSyncService) {}

  // GET /schools/sync?since=...&full=true
  @Get()
  pull(@Query() query: SchoolsSyncPullQueryDto) {
    return this.syncService.pullSync({
      since: query.since,
      full: query.full === 'true',
    });
  }

  // POST /schools/sync
  @Post()
  push(@Body() body: SchoolsSyncPushDto) {
    return this.syncService.pushSync(body);
  }
}