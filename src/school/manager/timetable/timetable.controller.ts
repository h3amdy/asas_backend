// src/school/manager/timetable/timetable.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { TimetableService } from './timetable.service';
import { SaveTimetableDto } from './dto/timetable.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/sections/:sectionId/timetable')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class TimetableController {
    constructor(private readonly service: TimetableService) { }

    /**
     * GET /sections/:sectionId/timetable?yearId=&termId=
     * جلب جدول الشعبة
     */
    @Get()
    getTimetable(
        @Req() req: any,
        @Param('sectionId', ParseIntPipe) sectionId: number,
        @Query('yearId', ParseIntPipe) yearId: number,
        @Query('termId', ParseIntPipe) termId: number,
    ) {
        return this.service.getTimetable(req.schoolContext.id, sectionId, yearId, termId);
    }

    /**
     * PUT /sections/:sectionId/timetable?yearId=&termId=
     * حفظ/تحديث حصص الجدول
     */
    @Put()
    saveTimetable(
        @Req() req: any,
        @Param('sectionId', ParseIntPipe) sectionId: number,
        @Query('yearId', ParseIntPipe) yearId: number,
        @Query('termId', ParseIntPipe) termId: number,
        @Body() dto: SaveTimetableDto,
    ) {
        return this.service.saveTimetable(req.schoolContext.id, sectionId, yearId, termId, dto);
    }

    /**
     * GET /sections/:sectionId/timetable/subjects
     * المواد المتاحة للشعبة (لـ bottom sheet)
     */
    @Get('subjects')
    getSectionSubjects(
        @Req() req: any,
        @Param('sectionId', ParseIntPipe) sectionId: number,
    ) {
        return this.service.getSectionSubjects(req.schoolContext.id, sectionId);
    }

    /**
     * DELETE /sections/:sectionId/timetable/slots/:slotUuid
     * حذف حصة
     */
    @Delete('slots/:slotUuid')
    deleteSlot(
        @Req() req: any,
        @Param('slotUuid') slotUuid: string,
    ) {
        return this.service.deleteSlot(req.schoolContext.id, slotUuid);
    }

    /**
     * GET /sections/:sectionId/timetable/teacher-conflicts
     * كشف تعارض المعلم
     */
    @Get('teacher-conflicts')
    checkTeacherConflicts(
        @Req() req: any,
        @Param('sectionId', ParseIntPipe) sectionId: number,
        @Query('yearId', ParseIntPipe) yearId: number,
        @Query('termId', ParseIntPipe) termId: number,
        @Query('weekday', ParseIntPipe) weekday: number,
        @Query('lessonNumber', ParseIntPipe) lessonNumber: number,
        @Query('subjectSectionId', ParseIntPipe) subjectSectionId: number,
    ) {
        return this.service.checkTeacherConflicts(
            req.schoolContext.id, sectionId, yearId, termId,
            weekday, lessonNumber, subjectSectionId,
        );
    }
}
