// src/school/manager/students/students.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto, UpdateStudentDto, TransferStudentDto } from './dto/students.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/students')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class StudentsController {
    constructor(private readonly service: StudentsService) { }

    @Get()
    list(@Req() req: any,
        @Query('gradeId') gradeId?: string,
        @Query('sectionId') sectionId?: string,
        @Query('yearId') yearId?: string,
        @Query('q') q?: string,
    ) {
        return this.service.listStudents(req.schoolContext.id, {
            gradeId: gradeId ? +gradeId : undefined,
            sectionId: sectionId ? +sectionId : undefined,
            yearId: yearId ? +yearId : undefined,
            q,
        });
    }

    @Post()
    create(@Req() req: any, @Body() dto: CreateStudentDto) {
        return this.service.createStudent(req.schoolContext.id, dto);
    }

    @Get(':uuid')
    getProfile(@Param('uuid') uuid: string) { return this.service.getStudentProfile(uuid); }

    @Patch(':uuid')
    update(@Param('uuid') uuid: string, @Body() dto: UpdateStudentDto) {
        return this.service.updateStudent(uuid, dto);
    }

    @Post(':uuid/transfer')
    transfer(@Param('uuid') uuid: string, @Body() dto: TransferStudentDto) {
        return this.service.transferStudent(uuid, dto);
    }

    @Patch(':uuid/toggle-active')
    toggleActive(@Param('uuid') uuid: string, @Body('isActive') isActive: boolean) {
        return this.service.toggleStudentActive(uuid, isActive);
    }

    @Post(':uuid/reset-password')
    resetPassword(@Param('uuid') uuid: string, @Body('password') password?: string) {
        return this.service.resetPassword(uuid, password);
    }
}
