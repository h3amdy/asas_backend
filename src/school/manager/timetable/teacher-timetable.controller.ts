// src/school/manager/timetable/teacher-timetable.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { TimetableService } from './timetable.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { ParseIntPipe } from '@nestjs/common';

@Controller('school/manager/teachers/:teacherUuid/timetable')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class TeacherTimetableController {
    constructor(private readonly service: TimetableService) { }

    /**
     * GET /school/manager/teachers/:teacherUuid/timetable?yearId=&termId=
     * جلب جدول المعلم الأسبوعي — يجمّع كل حصصه من كل الشعب
     */
    @Get()
    getTeacherTimetable(
        @Req() req: any,
        @Param('teacherUuid') teacherUuid: string,
        @Query('yearId', ParseIntPipe) yearId: number,
        @Query('termId', ParseIntPipe) termId: number,
    ) {
        return this.service.getTeacherTimetable(
            req.schoolContext.id, teacherUuid, yearId, termId,
        );
    }
}
