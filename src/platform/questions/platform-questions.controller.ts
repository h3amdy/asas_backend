// src/platform/questions/platform-questions.controller.ts
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
import { PlatformQuestionsService } from './platform-questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';

/**
 * ❓ Platform Questions Controller
 * إدارة أسئلة الدروس — منصة المحتوى
 */
@Controller('platform')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformQuestionsController {
    constructor(private readonly service: PlatformQuestionsService) {}

    /** GET — جلب أسئلة الدرس */
    @Get('lessons/:lessonUuid/questions')
    getQuestions(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getQuestions(req.user.sub, lessonUuid);
    }

    /** POST — إنشاء سؤال جديد */
    @Post('lessons/:lessonUuid/questions')
    createQuestion(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: CreateQuestionDto,
    ) {
        return this.service.createQuestion(req.user.sub, lessonUuid, dto);
    }

    /** GET — جلب سؤال بالتفصيل */
    @Get('questions/:questionUuid')
    getQuestion(
        @Req() req: any,
        @Param('questionUuid') questionUuid: string,
    ) {
        return this.service.getQuestion(req.user.sub, questionUuid);
    }

    /** PATCH — تعديل سؤال */
    @Patch('questions/:questionUuid')
    updateQuestion(
        @Req() req: any,
        @Param('questionUuid') questionUuid: string,
        @Body() dto: UpdateQuestionDto,
    ) {
        return this.service.updateQuestion(req.user.sub, questionUuid, dto);
    }

    /** DELETE — حذف سؤال */
    @Delete('questions/:questionUuid')
    deleteQuestion(
        @Req() req: any,
        @Param('questionUuid') questionUuid: string,
    ) {
        return this.service.deleteQuestion(req.user.sub, questionUuid);
    }

    /** PATCH — إعادة ترتيب أسئلة الدرس */
    @Patch('lessons/:lessonUuid/questions/reorder')
    reorderQuestions(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: ReorderQuestionsDto,
    ) {
        return this.service.reorderQuestions(req.user.sub, lessonUuid, dto);
    }
}
