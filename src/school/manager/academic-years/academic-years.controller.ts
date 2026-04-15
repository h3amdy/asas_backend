// src/school/manager/academic-years/academic-years.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import { CreateYearDto, UpdateYearDto, UpdateTermDto, AddTermDto, StartTermDto, CopyTimetableDto } from './dto/academic-years.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/academic-years')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class AcademicYearsController {
    constructor(private readonly service: AcademicYearsService) { }

    @Get()
    list(@Req() req: any) { return this.service.listYears(req.schoolContext.id); }

    @Get('current')
    getCurrent(@Req() req: any) { return this.service.getCurrentYear(req.schoolContext.id); }

    @Post()
    create(@Req() req: any, @Body() dto: CreateYearDto) {
        return this.service.createYear(req.schoolContext.id, dto);
    }

    @Get(':yearId')
    getOne(@Req() req: any, @Param('yearId', ParseIntPipe) id: number) {
        return this.service.getYearById(req.schoolContext.id, id);
    }

    @Patch(':yearId')
    update(@Req() req: any, @Param('yearId', ParseIntPipe) id: number, @Body() dto: UpdateYearDto) {
        return this.service.updateYear(req.schoolContext.id, id, dto);
    }

    // ─── الإجراء الموحد (القديم) ───
    @Post(':yearId/advance-term')
    advanceTerm(@Req() req: any, @Param('yearId', ParseIntPipe) id: number) {
        return this.service.advanceToNextTerm(req.schoolContext.id, id);
    }

    // ─── ADM-010a: إنهاء فصل دراسي ───
    @Post(':yearId/end-current-term')
    endCurrentTerm(@Req() req: any, @Param('yearId', ParseIntPipe) yearId: number) {
        return this.service.endCurrentTerm(req.schoolContext.id, yearId);
    }

    // ─── ADM-010b: بدء فصل دراسي ───
    @Post(':yearId/terms/:termId/start')
    startTerm(
        @Req() req: any,
        @Param('yearId', ParseIntPipe) yearId: number,
        @Param('termId', ParseIntPipe) termId: number,
        @Body() dto: StartTermDto,
    ) {
        return this.service.startTerm(req.schoolContext.id, yearId, termId, dto);
    }

    // ─── ADM-010c: نسخ الجدول الدراسي ───
    @Post(':yearId/copy-timetable')
    copyTimetable(
        @Req() req: any,
        @Param('yearId', ParseIntPipe) yearId: number,
        @Body() dto: CopyTimetableDto,
    ) {
        return this.service.copyTimetable(req.schoolContext.id, yearId, dto);
    }

    @Patch('terms/:termId')
    updateTerm(@Req() req: any, @Param('termId', ParseIntPipe) id: number, @Body() dto: UpdateTermDto) {
        return this.service.updateTerm(req.schoolContext.id, id, dto);
    }

    @Post(':yearId/terms')
    addTerm(@Req() req: any, @Param('yearId', ParseIntPipe) yearId: number, @Body() dto: AddTermDto) {
        return this.service.addTerm(req.schoolContext.id, yearId, dto);
    }

    @Delete('terms/:termId')
    deleteTerm(@Req() req: any, @Param('termId', ParseIntPipe) id: number) {
        return this.service.deleteTerm(req.schoolContext.id, id);
    }
}
