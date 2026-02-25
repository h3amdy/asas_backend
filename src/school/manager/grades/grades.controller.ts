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
    getGrade(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.service.getGradeById(req.schoolContext.id, id);
    }

    @Patch(':id')
    updateGrade(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGradeDto) {
        return this.service.updateGrade(req.schoolContext.id, id, dto);
    }

    @Delete(':id')
    deleteGrade(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.service.deleteGrade(req.schoolContext.id, id);
    }

    @Patch(':id/toggle-active')
    toggleGradeActive(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body('isActive') isActive: boolean) {
        return this.service.toggleGradeActive(req.schoolContext.id, id, isActive);
    }

    // ========== SECTIONS ==========

    @Get(':id/sections')
    listSections(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.service.listSections(req.schoolContext.id, id);
    }

    @Post(':id/sections')
    createSection(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateSectionDto) {
        return this.service.createSection(req.schoolContext.id, id, dto);
    }

    @Patch('sections/:sectionId')
    updateSection(@Req() req: any, @Param('sectionId', ParseIntPipe) sectionId: number, @Body() dto: UpdateSectionDto) {
        return this.service.updateSection(req.schoolContext.id, sectionId, dto);
    }

    @Delete('sections/:sectionId')
    deleteSection(@Req() req: any, @Param('sectionId', ParseIntPipe) sectionId: number) {
        return this.service.deleteSection(req.schoolContext.id, sectionId);
    }

    @Patch('sections/:sectionId/toggle-active')
    toggleSectionActive(
        @Req() req: any,
        @Param('sectionId', ParseIntPipe) sectionId: number,
        @Body('isActive') isActive: boolean,
    ) {
        return this.service.toggleSectionActive(req.schoolContext.id, sectionId, isActive);
    }
}
