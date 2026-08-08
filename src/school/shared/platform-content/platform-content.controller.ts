// src/school/shared/platform-content/platform-content.controller.ts
import {
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { PlatformContentService } from './platform-content.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📖 Platform Content Controller
 *
 * APIs لاستعراض دروس المنصة الموزعة + Fork + Fork for Publish
 * متاح للمعلم (يمكن توسيعه لأدوار أخرى لاحقاً)
 */
@Controller('school/teacher')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class PlatformContentController {
    constructor(private readonly service: PlatformContentService) {}

    /**
     * GET /school/teacher/platform-lessons
     * قائمة دروس المنصة الموزعة للمدرسة (مجمّعة حسب المادة/الوحدة)
     */
    @Get('platform-lessons')
    getPlatformLessons(@Req() req: any) {
        return this.service.getPlatformLessons(
            req.schoolContext.id,
            req.user.sub,
        );
    }

    /**
     * GET /school/teacher/platform-lessons/:uuid
     * تفاصيل درس المنصة (محتوى كامل: blocks + items + questions)
     */
    @Get('platform-lessons/:uuid')
    getPlatformLessonDetail(
        @Req() req: any,
        @Param('uuid') uuid: string,
    ) {
        return this.service.getPlatformLessonDetail(
            req.schoolContext.id,
            req.user.sub,
            uuid,
        );
    }

    /**
     * POST /school/teacher/platform-lessons/:uuid/fork
     * Fork: إنشاء نسخة مدرسية من درس المنصة (DRAFT)
     */
    @Post('platform-lessons/:uuid/fork')
    forkLesson(
        @Req() req: any,
        @Param('uuid') uuid: string,
    ) {
        return this.service.forkLesson(
            req.schoolContext.id,
            req.user.sub,
            uuid,
        );
    }

    /**
     * POST /school/teacher/platform-lessons/:uuid/fork-for-publish
     * Fork تمهيداً للنشر — ينسخ الدرس بحالة READY (بدون شُعب)
     * النشر يتم عبر المسار العادي: saveTargeting → publishLesson
     */
    @Post('platform-lessons/:uuid/fork-for-publish')
    forkForPublish(
        @Req() req: any,
        @Param('uuid') uuid: string,
    ) {
        return this.service.forkForPublish(
            req.schoolContext.id,
            req.user.sub,
            uuid,
        );
    }
}

