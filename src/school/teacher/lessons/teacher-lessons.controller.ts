// src/school/teacher/lessons/teacher-lessons.controller.ts
import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { TeacherLessonsService } from './teacher-lessons.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ReorderContentsDto } from './dto/reorder-contents.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📖 Teacher Lessons Controller
 *
 * إدارة الدروس ومحتوياتها من منظور المعلم
 * TCH-012, TCH-030..032, TCH-040, TCH-060/061
 */
@Controller('school/teacher')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherLessonsController {
    constructor(private readonly service: TeacherLessonsService) {}

    // ══════════════════════════════════════════
    //  الدروس (Lessons)
    // ══════════════════════════════════════════

    /** GET — قائمة الدروس مقسّمة بالوحدات (SRS-LSN-01) */
    @Get('subjects/:subjectUuid/lessons-by-units')
    getLessonsByUnits(
        @Req() req: any,
        @Param('subjectUuid') subjectUuid: string,
    ) {
        return this.service.getLessonsByUnits(
            req.schoolContext.id,
            req.user.sub,
            subjectUuid,
        );
    }

    /** POST — إنشاء درس جديد (SRS-LSN-02) */
    @Post('subjects/:subjectUuid/units/:unitUuid/lessons')
    createLesson(
        @Req() req: any,
        @Param('subjectUuid') subjectUuid: string,
        @Param('unitUuid') unitUuid: string,
        @Body() dto: CreateLessonDto,
    ) {
        return this.service.createLesson(
            req.schoolContext.id,
            req.user.sub,
            subjectUuid,
            unitUuid,
            dto,
        );
    }

    /** PATCH — تعديل درس (SRS-LSN-03) */
    @Patch('lessons/:lessonUuid')
    updateLesson(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: UpdateLessonDto,
    ) {
        return this.service.updateLesson(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    /** DELETE — حذف درس DRAFT (SRS-LSN-04) */
    @Delete('lessons/:lessonUuid')
    deleteLesson(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.deleteLesson(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
        );
    }

    /** PATCH — تغيير حالة الدرس (SRS-LSN-06) */
    @Patch('lessons/:lessonUuid/status')
    updateStatus(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: UpdateStatusDto,
    ) {
        return this.service.updateStatus(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    // ══════════════════════════════════════════
    //  المحتوى (Contents)
    // ══════════════════════════════════════════

    /** GET — جلب محتوى الدرس (SRS-LSN-05) */
    @Get('lessons/:lessonUuid/contents')
    getContents(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getContents(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
        );
    }

    /** POST — إضافة كتلة محتوى (SRS-LSN-05) */
    @Post('lessons/:lessonUuid/contents')
    createContent(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: CreateContentDto,
    ) {
        return this.service.createContent(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    /** PATCH — إعادة ترتيب كتل المحتوى (SRS-LSN-05) — يجب أن يكون قبل :contentUuid */
    @Patch('lessons/:lessonUuid/contents/reorder')
    reorderContents(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: ReorderContentsDto,
    ) {
        return this.service.reorderContents(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    /** PATCH — تعديل كتلة محتوى (SRS-LSN-05) */
    @Patch('lessons/:lessonUuid/contents/:contentUuid')
    updateContent(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('contentUuid') contentUuid: string,
        @Body() dto: UpdateContentDto,
    ) {
        return this.service.updateContent(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            contentUuid,
            dto,
        );
    }

    /** DELETE — حذف كتلة محتوى (SRS-LSN-05) */
    @Delete('lessons/:lessonUuid/contents/:contentUuid')
    deleteContent(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('contentUuid') contentUuid: string,
    ) {
        return this.service.deleteContent(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            contentUuid,
        );
    }
}
