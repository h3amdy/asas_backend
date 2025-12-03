import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { GradesService } from './grades.service';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { UpdateGradeStatusDto } from './dto/update-grade-status.dto';

@Controller('grades')
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

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

  // DELETE /grades/:uuid  (Soft delete)
  @Delete(':uuid')
  softDelete(@Param('uuid') uuid: string) {
    return this.gradesService.softDelete(uuid);
  }
}