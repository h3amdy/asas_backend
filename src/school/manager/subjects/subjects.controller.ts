// src/school/manager/subjects/subjects.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto, UpdateSubjectDto, AssignSubjectSectionsDto, AssignTeacherToSectionDto } from './dto/subjects.dto';
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
    getOne(@Req() req: any, @Param('subjectId', ParseIntPipe) id: number) {
        return this.service.getSubjectById(req.schoolContext.id, id);
    }

    @Patch(':subjectId')
    update(@Req() req: any, @Param('subjectId', ParseIntPipe) id: number, @Body() dto: UpdateSubjectDto) {
        return this.service.updateSubject(req.schoolContext.id, id, dto);
    }

    @Delete(':subjectId')
    delete(@Req() req: any, @Param('subjectId', ParseIntPipe) id: number) {
        return this.service.deleteSubject(req.schoolContext.id, id);
    }

    // Section assignments
    @Post(':subjectId/sections')
    assignSections(@Req() req: any, @Param('subjectId', ParseIntPipe) id: number, @Body() dto: AssignSubjectSectionsDto) {
        return this.service.assignToSections(req.schoolContext.id, id, dto);
    }

    @Delete(':subjectId/sections/:sectionId')
    removeSection(@Req() req: any, @Param('subjectId', ParseIntPipe) subjectId: number, @Param('sectionId', ParseIntPipe) sectionId: number) {
        return this.service.removeFromSection(req.schoolContext.id, subjectId, sectionId);
    }

    // ═══════ Teacher Assignment (ADM-052 — UUID-based) ═══════

    @Get(':subjectUuid/assignment')
    getAssignment(@Req() req: any, @Param('subjectUuid') subjectUuid: string) {
        return this.service.getAssignment(req.schoolContext.id, subjectUuid);
    }

    @Post(':subjectUuid/sections/:sectionId/assign-teacher')
    assignTeacher(
        @Req() req: any,
        @Param('subjectUuid') subjectUuid: string,
        @Param('sectionId', ParseIntPipe) sectionId: number,
        @Body() dto: AssignTeacherToSectionDto,
    ) {
        return this.service.assignTeacherToSection(
            req.schoolContext.id,
            subjectUuid,
            sectionId,
            dto.teacherUuid,
        );
    }

    @Delete(':subjectUuid/sections/:sectionId/unassign-teacher')
    unassignTeacher(
        @Req() req: any,
        @Param('subjectUuid') subjectUuid: string,
        @Param('sectionId', ParseIntPipe) sectionId: number,
    ) {
        return this.service.unassignTeacherFromSection(
            req.schoolContext.id,
            subjectUuid,
            sectionId,
        );
    }
}
