// src/grades/grades.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GradesService } from './grades.service';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { UpdateGradeStatusDto } from './dto/update-grade-status.dto';
import {
  PullGradesQueryDto,
  PushGradesDto,
} from './dto/grade-sync.dto'; // 👈 جديد

@Controller('grades')
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  // ============================
  // 🔄 Endpoints المزامنة
  // ============================

  // GET /grades/sync?since=2025-01-01T00:00:00Z
  @Get('sync')
  syncPull(@Query() query: PullGradesQueryDto) {
    const sinceDate = query.since ? new Date(query.since) : undefined;
    return this.gradesService.pullSync(sinceDate);
  }

  // POST /grades/sync
  @Post('sync')
  syncPush(@Body() dto: PushGradesDto) {
    return this.gradesService.pushSync(dto.changes);
  }

  // ============================
  // CRUD العادي (لوحة الويب أو الأدوات الأخرى)
  // ============================

  // GET /grades
  @Get()
  findAll() {
    return this.gradesService.findAll();
  }

  // GET /grades/:uuid
  @Get(':uuid')
  findOne(@Param('uuid') uuid: string) {
    return this.gradesService.findByUuid(uuid);
  }

  // POST /grades
  @Post()
  create(@Body() dto: CreateGradeDto) {
    return this.gradesService.create(dto);
  }

  // PATCH /grades/:uuid
  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateGradeDto) {
    return this.gradesService.update(uuid, dto);
  }

  // PATCH /grades/:uuid/status
  @Patch(':uuid/status')
  updateStatus(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateGradeStatusDto,
  ) {
    return this.gradesService.updateStatus(uuid, dto.isActive);
  }
}