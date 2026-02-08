// src/owner/schools/schools.controller.ts
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

  @Get('stats')
  getStats() {
    return this.schoolsService.getStats();
  }

  @Get()
  findAll() {
    return this.schoolsService.findAll();
  }

  @Get(':uuid')
  findOne(@Param('uuid') uuid: string) {
    return this.schoolsService.findByUuid(uuid);
  }

  @Post()
  create(@Body() dto: CreateSchoolDto) {
    return this.schoolsService.create(dto);
  }

  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateSchoolDto) {
    return this.schoolsService.update(uuid, dto);
  }

  @Patch(':uuid/status')
  updateStatus(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateSchoolStatusDto,
  ) {
    return this.schoolsService.updateStatus(uuid, dto.isActive);
  }

  @Delete(':uuid')
  remove(@Param('uuid') uuid: string) {
    return this.schoolsService.delete(uuid);
  }

  @Post(':uuid/manager')
  createOrUpdateManager(
    @Param('uuid') uuid: string,
    @Body() dto: CreateSchoolManagerDto,
  ) {
    return this.schoolsService.createOrUpdateManagerForSchool(uuid, dto);
  }

  @Post(':uuid/manager/reset-password')
  resetManagerPassword(@Param('uuid') uuid: string) {
    return this.schoolsService.resetManagerPasswordForSchool(uuid);
  }

  @Get(':uuid/manager')
  getManager(@Param('uuid') uuid: string) {
    return this.schoolsService.getManagerForSchool(uuid);
  }
}