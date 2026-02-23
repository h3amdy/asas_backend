// src/school/manager/grades/grades.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { GradesService } from './grades.service';
import { CreateGradeDto, UpdateGradeDto, CreateSectionDto, UpdateSectionDto } from './dto/grades.dto';
import { CreateGradeBulkDto } from './dto/create-grade-bulk.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/grades')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class GradesController {
    constructor(private readonly service: GradesService) { }

    @Get('dictionary')
    listGradeDictionary() {
        return this.service.listGradeDictionary();
    }

    @Get()
    listGrades(@Req() req: any) {
        return this.service.listGrades(req.schoolContext.id);
    }

    @Post()
    createGrade(@Req() req: any, @Body() dto: CreateGradeDto) {
        return this.service.createGrade(req.schoolContext.id, dto);
    }

    @Post('bulk')
    createGradesBulk(@Req() req: any, @Body() dto: CreateGradeBulkDto) {
        return this.service.createGradesBulk(req.schoolContext.id, dto.grades);
    }

    @Get(':id')
    getGrade(@Param('id', ParseIntPipe) id: number) {
        return this.service.getGradeById(id);
    }

    @Patch(':id')
    updateGrade(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGradeDto) {
        return this.service.updateGrade(id, dto);
    }

    @Delete(':id')
    deleteGrade(@Param('id', ParseIntPipe) id: number) {
        return this.service.deleteGrade(id);
    }

    @Patch(':id/toggle-active')
    toggleGradeActive(@Param('id', ParseIntPipe) id: number, @Body('isActive') isActive: boolean) {
        return this.service.toggleGradeActive(id, isActive);
    }

    // ========== SECTIONS ==========

    @Get(':id/sections')
    listSections(@Param('id', ParseIntPipe) id: number) {
        return this.service.listSections(id);
    }

    @Post(':id/sections')
    createSection(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateSectionDto) {
        return this.service.createSection(id, dto);
    }

    @Patch('sections/:sectionId')
    updateSection(@Param('sectionId', ParseIntPipe) sectionId: number, @Body() dto: UpdateSectionDto) {
        return this.service.updateSection(sectionId, dto);
    }

    @Delete('sections/:sectionId')
    deleteSection(@Param('sectionId', ParseIntPipe) sectionId: number) {
        return this.service.deleteSection(sectionId);
    }
}
