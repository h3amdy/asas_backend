// src/school/manager/academic-years/academic-years.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import { CreateYearDto, UpdateYearDto, UpdateTermDto } from './dto/academic-years.dto';
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
    getOne(@Param('yearId', ParseIntPipe) id: number) { return this.service.getYearById(id); }

    @Patch(':yearId')
    update(@Param('yearId', ParseIntPipe) id: number, @Body() dto: UpdateYearDto) {
        return this.service.updateYear(id, dto);
    }

    @Post(':yearId/advance-term')
    advanceTerm(@Param('yearId', ParseIntPipe) id: number) {
        return this.service.advanceToNextTerm(id);
    }

    @Patch('terms/:termId')
    updateTerm(@Param('termId', ParseIntPipe) id: number, @Body() dto: UpdateTermDto) {
        return this.service.updateTerm(id, dto);
    }
}
