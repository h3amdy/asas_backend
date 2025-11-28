// src/schools/schools.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';

@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

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
}
