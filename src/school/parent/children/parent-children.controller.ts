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
 * GET /school/parent/child/:childUuid/results                       → PAR-030/031
 * GET /school/parent/child/:childUuid/subject/:subjectUuid/results  → PAR-032
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

    // ── PAR-030/031: نتائج ابن (ملخص عام + مواد) ──
    @Get('child/:childUuid/results')
    getChildResults(
        @Req() req: any,
        @Param('childUuid') childUuid: string,
    ) {
        return this.service.getChildResults(
            req.schoolContext.id,
            req.user.sub,
            childUuid,
        );
    }

    // ── PAR-032: نتائج دروس مادة معيّنة ──
    @Get('child/:childUuid/subject/:subjectUuid/results')
    getChildSubjectResults(
        @Req() req: any,
        @Param('childUuid') childUuid: string,
        @Param('subjectUuid') subjectUuid: string,
    ) {
        return this.service.getChildSubjectResults(
            req.schoolContext.id,
            req.user.sub,
            childUuid,
            subjectUuid,
        );
    }

    // ── PAR-033: مراجعة إجابات درس معيّن ──
    @Get('child/:childUuid/lesson/:lessonUuid/review')
    getChildLessonReview(
        @Req() req: any,
        @Param('childUuid') childUuid: string,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getChildLessonReview(
            req.schoolContext.id,
            req.user.sub,
            childUuid,
            lessonUuid,
        );
    }
}

