// src/school/parent/children/parent-children.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ParentChildrenService } from './parent-children.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 👨‍👧‍👦 Parent Children Controller
 *
 * GET /school/parent/my-children → قائمة أبناء ولي الأمر مع ملخص الإنجاز
 *
 * SRS-PAR-010 | UC-PAR-010
 */
@Controller('school/parent')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('PARENT')
export class ParentChildrenController {
    constructor(private readonly service: ParentChildrenService) { }

    @Get('my-children')
    getMyChildren(@Req() req: any) {
        return this.service.getMyChildren(
            req.schoolContext.id,
            req.user.sub, // parent user UUID
        );
    }
}
