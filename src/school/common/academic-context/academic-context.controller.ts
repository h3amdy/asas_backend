// src/school/common/academic-context/academic-context.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AcademicContextService } from './academic-context.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../guards/school-context.guard';

/**
 * 📅 السياق الأكاديمي — مشترك لجميع الأدوار
 * UC-CTX-060: عرض السنة الحالية والفصل الحالي
 */
@Controller('school/academic-context')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard)
export class AcademicContextController {
    constructor(private readonly service: AcademicContextService) { }

    @Get()
    async getContext(@Req() req: any) {
        const schoolId: number = req.schoolContext.schoolId;
        return this.service.getContext(schoolId);
    }
}
