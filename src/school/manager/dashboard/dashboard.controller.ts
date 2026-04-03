// src/school/manager/dashboard/dashboard.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/dashboard')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class DashboardController {
    constructor(private readonly service: DashboardService) { }

    @Get('stats')
    getStats(@Req() req: any) {
        const adminName = req.user?.name ?? 'المدير';
        return this.service.getStats(req.schoolContext.id, adminName);
    }
}
