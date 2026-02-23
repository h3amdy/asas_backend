// src/school/manager/setup/setup.controller.ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SetupService } from './setup.service';
import { AcademicInitializationDto } from './dto/academic-initialization.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/setup')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class SetupController {
    constructor(private readonly service: SetupService) { }

    @Get('status')
    getStatus(@Req() req: any) {
        return this.service.getSetupStatus(req.schoolContext.id);
    }

    @Post('academic-initialization')
    initializeAcademic(@Req() req: any, @Body() dto: AcademicInitializationDto) {
        return this.service.initializeAcademic(req.schoolContext.id, dto);
    }
}
