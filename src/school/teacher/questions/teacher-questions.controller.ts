// src/school/teacher/questions/teacher-questions.controller.ts
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
import { TeacherQuestionsService } from './teacher-questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * ❓ Teacher Questions Controller
 *
 * إدارة أسئلة الدروس من منظور المعلم
 * TCH-090→094, TCH-096→101
 */
@Controller('school/teacher')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherQuestionsController {
    constructor(private readonly service: TeacherQuestionsService) {}

    // ══════════════════════════════════════════
    //  SRS-QST-01 — قائمة الأسئلة
    // ══════════════════════════════════════════

    /** GET — جلب أسئلة الدرس */
    @Get('lessons/:lessonUuid/questions')
    getQuestions(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getQuestions(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
        );
    }

    // ══════════════════════════════════════════
    //  SRS-QST-02 — إنشاء سؤال
    // ══════════════════════════════════════════

    /** POST — إنشاء سؤال جديد (nested) */
    @Post('lessons/:lessonUuid/questions')
    createQuestion(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: CreateQuestionDto,
    ) {
        return this.service.createQuestion(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    // ══════════════════════════════════════════
    //  SRS-QST-03 — جلب / تعديل سؤال
    // ══════════════════════════════════════════

    /** GET — جلب سؤال بالتفصيل مع بياناته الفرعية */
    @Get('questions/:questionUuid')
    getQuestion(
        @Req() req: any,
        @Param('questionUuid') questionUuid: string,
    ) {
        return this.service.getQuestion(
            req.schoolContext.id,
            req.user.sub,
            questionUuid,
        );
    }

    /** PATCH — تعديل سؤال (Replace Strategy للبيانات الفرعية) */
    @Patch('questions/:questionUuid')
    updateQuestion(
        @Req() req: any,
        @Param('questionUuid') questionUuid: string,
        @Body() dto: UpdateQuestionDto,
    ) {
        return this.service.updateQuestion(
            req.schoolContext.id,
            req.user.sub,
            questionUuid,
            dto,
        );
    }

    // ══════════════════════════════════════════
    //  SRS-QST-04 — حذف سؤال
    // ══════════════════════════════════════════

    /** DELETE — حذف سؤال (cascading soft-delete) */
    @Delete('questions/:questionUuid')
    deleteQuestion(
        @Req() req: any,
        @Param('questionUuid') questionUuid: string,
    ) {
        return this.service.deleteQuestion(
            req.schoolContext.id,
            req.user.sub,
            questionUuid,
        );
    }

    // ══════════════════════════════════════════
    //  SRS-QST-05 — إعادة ترتيب
    // ══════════════════════════════════════════

    /** PATCH — إعادة ترتيب أسئلة الدرس */
    @Patch('lessons/:lessonUuid/questions/reorder')
    reorderQuestions(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: ReorderQuestionsDto,
    ) {
        return this.service.reorderQuestions(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }
}
