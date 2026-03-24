// src/school/teacher/subjects/teacher-subjects.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { TeacherSubjectsService } from './teacher-subjects.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📚 Teacher Subjects Controller
 *
 * GET /school/teacher/my-subjects → المواد المسندة للمعلم
 */
@Controller('school/teacher')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherSubjectsController {
    constructor(private readonly service: TeacherSubjectsService) { }

    @Get('my-subjects')
    getMySubjects(@Req() req: any) {
        return this.service.getMySubjects(
            req.schoolContext.id,
            req.user.sub, // UUID من JWT
        );
    }
}
