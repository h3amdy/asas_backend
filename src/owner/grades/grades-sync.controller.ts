import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GradesSyncService } from './grades-sync.service';
import {
  GradesSyncPullQueryDto,
  GradesSyncPushDto,
} from './dto/grade-sync.dto';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';

@Controller('grades-sync')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class GradesSyncController {
  constructor(private readonly syncService: GradesSyncService) {}

  // GET /grades/sync?since=...&full=true
  @Get()
  pull(@Query() query: GradesSyncPullQueryDto) {
    return this.syncService.pullSync({
      since: query.since,
      full: query.full === 'true',
    });
  }

  // POST /grades/sync
  @Post()
  push(@Body() body: GradesSyncPushDto) {
    return this.syncService.pushSync(body);
  }
}