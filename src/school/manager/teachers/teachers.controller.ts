// src/school/manager/teachers/teachers.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto, UpdateTeacherDto, SetSupervisorDto, SetExtraPermissionsDto, AddTeacherScopeDto } from './dto/teachers.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/teachers')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class TeachersController {
    constructor(private readonly service: TeachersService) { }

    @Get()
    list(@Req() req: any, @Query('q') q?: string) {
        return this.service.listTeachers(req.schoolContext.id, q);
    }

    @Post()
    create(@Req() req: any, @Body() dto: CreateTeacherDto) {
        return this.service.createTeacher(req.schoolContext.id, dto);
    }

    @Get(':uuid')
    getProfile(@Param('uuid') uuid: string) { return this.service.getTeacherProfile(uuid); }

    @Patch(':uuid')
    update(@Param('uuid') uuid: string, @Body() dto: UpdateTeacherDto) {
        return this.service.updateTeacher(uuid, dto);
    }

    @Post(':uuid/supervisor')
    setSupervisor(@Param('uuid') uuid: string, @Body() dto: SetSupervisorDto) {
        return this.service.setSupervisor(uuid, dto);
    }

    @Post(':uuid/extra-permissions')
    setExtraPermissions(@Param('uuid') uuid: string, @Body() dto: SetExtraPermissionsDto) {
        return this.service.setExtraPermissions(uuid, dto);
    }

    @Post(':uuid/scopes')
    addScope(@Param('uuid') uuid: string, @Body() dto: AddTeacherScopeDto) {
        return this.service.addScope(uuid, dto);
    }

    @Delete('scopes/:scopeId')
    removeScope(@Param('scopeId', ParseIntPipe) id: number) {
        return this.service.removeScope(id);
    }

    @Patch(':uuid/toggle-active')
    toggleActive(@Param('uuid') uuid: string, @Body('isActive') isActive: boolean) {
        return this.service.toggleActive(uuid, isActive);
    }

    @Post(':uuid/reset-password')
    resetPassword(@Param('uuid') uuid: string, @Body('password') password?: string) {
        return this.service.resetPassword(uuid, password);
    }
}
