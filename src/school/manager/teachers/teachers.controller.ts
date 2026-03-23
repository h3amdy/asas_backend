// src/school/manager/teachers/teachers.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto, UpdateTeacherDto, ResetPasswordDto, ToggleActiveDto } from './dto/teachers.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { ParseIntPipe } from '@nestjs/common';
import { TimetableService } from '../timetable/timetable.service';

/**
 * 🧑‍🏫 API إدارة المعلمين — SRS-TCH
 *
 * Endpoints (7):
 * ┌──────────┬────────────────────────────────────────┬──────────────┐
 * │  Method  │  Route                                 │  SRS         │
 * ├──────────┼────────────────────────────────────────┼──────────────┤
 * │  GET     │  /school/manager/teachers              │  SRS-TCH-01  │
 * │  POST    │  /school/manager/teachers              │  SRS-TCH-02  │
 * │  GET     │  /school/manager/teachers/:uuid        │  SRS-TCH-03  │
 * │  PATCH   │  /school/manager/teachers/:uuid        │  SRS-TCH-04  │
 * │  PATCH   │  /school/manager/teachers/:uuid/toggle-active  │  SRS-TCH-07  │
 * │  POST    │  /school/manager/teachers/:uuid/reset-password │  SRS-TCH-05  │
 * │  GET     │  /school/manager/teachers/:uuid/credentials    │  SRS-TCH-06  │
 * └──────────┴────────────────────────────────────────┴──────────────┘
 */
@Controller('school/manager/teachers')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class TeachersController {
    constructor(
        private readonly service: TeachersService,
        private readonly timetableService: TimetableService,
    ) { }

    // ─── SRS-TCH-01: List & Search ──────────────────────────

    @Get()
    list(
        @Req() req: any,
        @Query('search') search?: string,
        @Query('is_supervisor') isSupervisor?: string,
        @Query('is_active') isActive?: string,
    ) {
        return this.service.listTeachers(
            req.schoolContext.id,
            search,
            isSupervisor !== undefined ? isSupervisor === 'true' : undefined,
            isActive !== undefined ? isActive === 'true' : undefined,
        );
    }

    // ─── SRS-TCH-02: Create Teacher ─────────────────────────

    @Post()
    create(@Req() req: any, @Body() dto: CreateTeacherDto) {
        return this.service.createTeacher(req.schoolContext.id, dto);
    }

    // ─── SRS-TCH-03: Teacher Profile ────────────────────────

    @Get(':uuid')
    getProfile(@Param('uuid') uuid: string) {
        return this.service.getTeacherProfile(uuid);
    }

    // ─── SRS-TCH-04: Update Teacher ─────────────────────────

    @Patch(':uuid')
    update(@Param('uuid') uuid: string, @Body() dto: UpdateTeacherDto) {
        return this.service.updateTeacher(uuid, dto);
    }

    // ─── SRS-TCH-07: Block/Unblock ──────────────────────────

    @Patch(':uuid/toggle-active')
    toggleActive(@Param('uuid') uuid: string, @Body() dto: ToggleActiveDto) {
        return this.service.toggleActive(uuid, dto.isActive);
    }

    // ─── SRS-TCH-05: Reset Password ─────────────────────────

    @Post(':uuid/reset-password')
    resetPassword(@Param('uuid') uuid: string, @Body() dto: ResetPasswordDto) {
        return this.service.resetPassword(uuid, dto.newPassword);
    }

    // ─── SRS-TCH-06: Get Credentials ────────────────────────

    @Get(':uuid/credentials')
    getCredentials(@Req() req: any, @Param('uuid') uuid: string) {
        return this.service.getCredentials(uuid, req.schoolContext.id);
    }

    // ─── ADM-047: Teacher Timetable ─────────────────────────

    @Get(':uuid/timetable')
    getTeacherTimetable(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Query('yearId', ParseIntPipe) yearId: number,
        @Query('termId', ParseIntPipe) termId: number,
    ) {
        return this.timetableService.getTeacherTimetable(
            req.schoolContext.id, uuid, yearId, termId,
        );
    }
}
