// src/school/parent/children/parent-children.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ParentChildrenService } from './parent-children.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 👨‍👧‍👦 Parent Children Controller
 *
 * GET /school/parent/my-children              → قائمة الأبناء (PAR-010)
 * GET /school/parent/child/:uuid/subjects     → مواد ابن مع الإنجاز (PAR-021)
 *
 * SRS-PAR-010 | SRS-PAR-020/021
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
            req.user.sub,
        );
    }

    @Get('child/:uuid/subjects')
    getChildSubjects(@Req() req: any, @Param('uuid') childUuid: string) {
        return this.service.getChildSubjects(
            req.schoolContext.id,
            req.user.sub,
            childUuid,
        );
    }
}
