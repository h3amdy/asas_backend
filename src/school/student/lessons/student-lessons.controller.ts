// src/school/student/lessons/student-lessons.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { StudentLessonsService } from './student-lessons.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📖 Student Lessons Controller
 *
 * GET /school/student/my-lessons?subjectUuid=xxx → قائمة دروس المادة
 * GET /school/student/lesson/:lessonUuid         → تفاصيل درس (محتوى)
 */
@Controller('school/student')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentLessonsController {
    constructor(private readonly service: StudentLessonsService) { }

    @Get('my-lessons')
    getMyLessons(
        @Req() req: any,
        @Query('subjectUuid') subjectUuid: string,
    ) {
        return this.service.getMyLessons(
            req.schoolContext.id,
            req.user.sub,
            subjectUuid,
        );
    }

    @Get('lesson/:lessonUuid')
    getLessonDetail(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getLessonDetail(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
        );
    }

    @Get('my-summary')
    getMySummary(@Req() req: any) {
        return this.service.getMySummary(
            req.schoolContext.id,
            req.user.sub,
        );
    }
}
