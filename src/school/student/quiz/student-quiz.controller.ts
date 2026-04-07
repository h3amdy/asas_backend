// src/school/student/quiz/student-quiz.controller.ts
import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { StudentQuizService } from './student-quiz.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📝 Student Quiz Controller (STD-050 → STD-071)
 *
 * GET  /school/student/lesson/:lessonUuid/questions     → جلب أسئلة الدرس
 * POST /school/student/lesson/:lessonUuid/check-answer   → تصحيح إجابة واحدة
 * POST /school/student/lesson/:lessonUuid/submit-quiz    → إنهاء المحاولة + حفظ النتيجة
 * GET  /school/student/lesson/:lessonUuid/result         → جلب آخر نتيجة
 */
@Controller('school/student')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentQuizController {
    constructor(private readonly service: StudentQuizService) { }

    /**
     * جلب أسئلة الدرس مع الإجابات الصحيحة (DEC: أمان أقل + تفاعلية أعلى)
     */
    @Get('lesson/:lessonUuid/questions')
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

    /**
     * تصحيح إجابة واحدة فورياً (بعد كل سؤال)
     */
    @Post('lesson/:lessonUuid/check-answer')
    checkAnswer(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() body: { questionUuid: string; answerValue: any },
    ) {
        return this.service.checkAnswer(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            body.questionUuid,
            body.answerValue,
        );
    }

    /**
     * إنهاء المحاولة + حفظ النتيجة النهائية
     */
    @Post('lesson/:lessonUuid/submit-quiz')
    submitQuiz(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() body: { answers: { questionUuid: string; answerValue: any; isCorrect: boolean }[] },
    ) {
        return this.service.submitQuiz(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            body.answers,
        );
    }

    /**
     * جلب آخر نتيجة (للمراجعة)
     */
    @Get('lesson/:lessonUuid/result')
    getResult(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getResult(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
        );
    }
}
