// src/school/teacher/lesson-targeting/teacher-lesson-targeting.controller.ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TeacherLessonTargetingService } from './teacher-lesson-targeting.service';
import { SaveTargetingDto } from '../lessons/dto/save-targeting.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * Teacher Lesson Targeting & Publishing Controller
 * Phase 4: SRS-P4-01..05
 */
@Controller('school/teacher')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherLessonTargetingController {
    constructor(private readonly service: TeacherLessonTargetingService) {}

    /** GET — الشُعب المتاحة (SRS-P4-01) */
    @Get('subjects/:subjectUuid/available-sections')
    getAvailableSections(
        @Req() req: any,
        @Param('subjectUuid') subjectUuid: string,
    ) {
        return this.service.getAvailableSections(req.schoolContext.id, req.user.sub, subjectUuid);
    }

    /** GET — حصص الجدول لشعبة (SRS-P4-02) */
    @Get('subjects/:subjectUuid/sections/:sectionUuid/timetable-slots')
    getTimetableSlotsForSection(
        @Req() req: any,
        @Param('subjectUuid') subjectUuid: string,
        @Param('sectionUuid') sectionUuid: string,
    ) {
        return this.service.getTimetableSlotsForSection(req.schoolContext.id, req.user.sub, subjectUuid, sectionUuid);
    }

    /** POST — حفظ الاستهداف (SRS-P4-01/02) */
    @Post('lessons/:lessonUuid/targeting')
    saveTargeting(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: SaveTargetingDto,
    ) {
        return this.service.saveTargeting(req.schoolContext.id, req.user.sub, lessonUuid, dto);
    }

    /** GET — جلب الاستهداف الحالي */
    @Get('lessons/:lessonUuid/targeting')
    getTargeting(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getTargeting(req.schoolContext.id, req.user.sub, lessonUuid);
    }

    /** POST — نشر الدرس (SRS-P4-05) */
    @Post('lessons/:lessonUuid/publish')
    publishLesson(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.publishLesson(req.schoolContext.id, req.user.sub, lessonUuid);
    }
}
