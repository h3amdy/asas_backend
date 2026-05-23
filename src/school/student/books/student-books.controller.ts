// src/school/student/books/student-books.controller.ts
import { Controller, Get, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { StudentBooksService } from './student-books.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { ParentStudentContextGuard } from '../../common/guards/parent-student-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📖 Student Books Controller
 *
 * GET /school/student/my-books?subjectUuid=xxx → الكتب المرتبطة بمادة الطالب
 */
@Controller('school/student')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, ParentStudentContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentBooksController {
    constructor(private readonly service: StudentBooksService) {}

    @Get('my-books')
    getMyBooks(
        @Req() req: any,
        @Query('subjectUuid') subjectUuid: string,
    ) {
        if (!subjectUuid) {
            throw new BadRequestException('SUBJECT_UUID_REQUIRED');
        }

        return this.service.getMyBooks(
            req.schoolContext.id,
            req.user.sub,
            subjectUuid,
        );
    }
}
