// src/school/manager/rollover/rollover.controller.ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { RolloverService } from './rollover.service';
import { RolloverRequestDto } from './dto/rollover.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/rollover')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class RolloverController {
    constructor(private readonly service: RolloverService) { }

    /** فحص أهلية الترحيل — يرجع حالة السنة + قائمة الصفوف */
    @Get('check-eligibility')
    checkEligibility(@Req() req: any) {
        return this.service.checkEligibility(req.schoolContext.id);
    }

    /** معاينة الترحيل — يحسب النتائج بدون تنفيذ */
    @Post('preview')
    preview(@Req() req: any, @Body() dto: RolloverRequestDto) {
        return this.service.preview(req.schoolContext.id, dto);
    }

    /** تنفيذ الترحيل — عملية نهائية غير قابلة للتراجع */
    @Post('execute')
    execute(@Req() req: any, @Body() dto: RolloverRequestDto) {
        return this.service.execute(req.schoolContext.id, dto);
    }
}
