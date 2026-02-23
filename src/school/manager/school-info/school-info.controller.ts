// src/school/manager/school-info/school-info.controller.ts
import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { SchoolInfoService } from './school-info.service';
import { UpdateSchoolInfoDto } from './dto/update-school-info.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/school-info')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class SchoolInfoController {
    constructor(private readonly service: SchoolInfoService) { }

    @Get()
    getSchoolInfo(@Req() req: any) {
        return this.service.getSchoolInfo(req.schoolContext.id);
    }

    @Patch()
    updateSchoolInfo(@Req() req: any, @Body() dto: UpdateSchoolInfoDto) {
        return this.service.updateSchoolInfo(req.schoolContext.id, dto);
    }
}
