// src/school/manager/subjects/subjects.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto, UpdateSubjectDto, AssignSubjectSectionsDto, AssignTeacherDto } from './dto/subjects.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/subjects')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class SubjectsController {
    constructor(private readonly service: SubjectsService) { }

    @Get()
    list(@Req() req: any, @Query('gradeId') gradeId?: string) {
        return this.service.listSubjects(req.schoolContext.id, gradeId ? +gradeId : undefined);
    }

    @Post()
    create(@Req() req: any, @Body() dto: CreateSubjectDto) {
        return this.service.createSubject(req.schoolContext.id, dto);
    }

    @Get(':subjectId')
    getOne(@Param('subjectId', ParseIntPipe) id: number) { return this.service.getSubjectById(id); }

    @Patch(':subjectId')
    update(@Param('subjectId', ParseIntPipe) id: number, @Body() dto: UpdateSubjectDto) {
        return this.service.updateSubject(id, dto);
    }

    @Delete(':subjectId')
    delete(@Param('subjectId', ParseIntPipe) id: number) { return this.service.deleteSubject(id); }

    // Section assignments
    @Post(':subjectId/sections')
    assignSections(@Param('subjectId', ParseIntPipe) id: number, @Body() dto: AssignSubjectSectionsDto) {
        return this.service.assignToSections(id, dto);
    }

    @Delete(':subjectId/sections/:sectionId')
    removeSection(@Param('subjectId', ParseIntPipe) subjectId: number, @Param('sectionId', ParseIntPipe) sectionId: number) {
        return this.service.removeFromSection(subjectId, sectionId);
    }

    // Teacher assignments
    @Post('subject-sections/:ssId/teachers')
    assignTeacher(@Param('ssId', ParseIntPipe) ssId: number, @Body() dto: AssignTeacherDto) {
        return this.service.assignTeacher(ssId, dto);
    }

    @Delete('subject-sections/:ssId/teachers/:teacherId')
    removeTeacher(@Param('ssId', ParseIntPipe) ssId: number, @Param('teacherId', ParseIntPipe) teacherId: number) {
        return this.service.removeTeacher(ssId, teacherId);
    }
}
