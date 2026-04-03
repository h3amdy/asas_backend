// src/school/teacher/timetable/teacher-timetable.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { TeacherTimetableService } from './teacher-timetable.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * Teacher Timetable Controller
 * GET /school/teacher/my-timetable — جدول المعلم الأسبوعي (السنة والفصل الحاليين تلقائياً)
 */
@Controller('school/teacher')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherTimetableController {
    constructor(private readonly service: TeacherTimetableService) {}

    @Get('my-timetable')
    getMyTimetable(@Req() req: any) {
        return this.service.getMyTimetable(req.schoolContext.id, req.user.sub);
    }
}
