// src/school/parent/children/parent-children.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ParentChildrenService } from './parent-children.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 👨‍👧‍👦 Parent Children Controller
 *
 * GET /school/parent/my-children                                    → PAR-010
 * GET /school/parent/child/:uuid/subjects                           → PAR-021
 * GET /school/parent/child/:childUuid/subject/:subjectUuid/lessons  → PAR-022/023
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

    @Get('child/:childUuid/subject/:subjectUuid/lessons')
    getChildSubjectLessons(
        @Req() req: any,
        @Param('childUuid') childUuid: string,
        @Param('subjectUuid') subjectUuid: string,
    ) {
        return this.service.getChildSubjectLessons(
            req.schoolContext.id,
            req.user.sub,
            childUuid,
            subjectUuid,
        );
    }
}
