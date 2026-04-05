// src/school/student/timetable/student-timetable.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { StudentTimetableService } from './student-timetable.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * Student Timetable Controller
 * GET /school/student/my-timetable — جدول الطالب الأسبوعي
 */
@Controller('school/student')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentTimetableController {
    constructor(private readonly service: StudentTimetableService) {}

    @Get('my-timetable')
    getMyTimetable(@Req() req: any) {
        return this.service.getMyTimetable(req.schoolContext.id, req.user.sub);
    }
}
