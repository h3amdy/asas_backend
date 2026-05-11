import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { StudentSubjectsService } from './student-subjects.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { ParentStudentContextGuard } from '../../common/guards/parent-student-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📚 Student Subjects Controller
 *
 * GET /school/student/my-subjects → المواد المسجّلة للطالب
 */
@Controller('school/student')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, ParentStudentContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentSubjectsController {
    constructor(private readonly service: StudentSubjectsService) { }

    @Get('my-subjects')
    getMySubjects(@Req() req: any) {
        return this.service.getMySubjects(
            req.schoolContext.id,
            req.user.sub,
        );
    }
}
