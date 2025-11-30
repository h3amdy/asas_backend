// src/schools/schools.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
} from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';
import { CreateSchoolManagerDto } from './dto/create-school-manager.dto';

@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  // ✅ إحصائيات للمالك (تقدر تستخدمها في الـ Dashboard لاحقاً)
  // GET /schools/stats
  @Get('stats')
  getStats() {
    return this.schoolsService.getStats();
  }

  // GET /schools
  @Get()
  findAll() {
    return this.schoolsService.findAll();
  }

  // GET /schools/:uuid
  @Get(':uuid')
  findOne(@Param('uuid') uuid: string) {
    return this.schoolsService.findByUuid(uuid);
  }

  // POST /schools
  @Post()
  create(@Body() dto: CreateSchoolDto) {
    return this.schoolsService.create(dto);
  }

  // PATCH /schools/:uuid
  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateSchoolDto) {
    return this.schoolsService.update(uuid, dto);
  }

  // PATCH /schools/:uuid/status
  @Patch(':uuid/status')
  updateStatus(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateSchoolStatusDto,
  ) {
    return this.schoolsService.updateStatus(uuid, dto.isActive);
  }
  // DELETE /schools/:uuid
  @Delete(':uuid')
  remove(@Param('uuid') uuid: string) {
    return this.schoolsService.delete(uuid);
  }
  // ✅ إنشاء أو تحديث مدير المدرسة
  // POST /schools/:uuid/manager
  @Post(':uuid/manager')
  createOrUpdateManager(
    @Param('uuid') uuid: string,
    @Body() dto: CreateSchoolManagerDto,
  ) {
    return this.schoolsService.createOrUpdateManagerForSchool(uuid, dto);
  }
  // ✅  POST /schools/:uuid/manager/reset-password
  @Post(':uuid/manager/reset-password')
  resetManagerPassword(@Param('uuid') uuid: string) {
    return this.schoolsService.resetManagerPasswordForSchool(uuid);
  }

}