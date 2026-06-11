// src/school/shared/platform-content/platform-content.controller.ts
import {
    Body,
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
import { ForkAndPublishDto } from './dto/fork-and-publish.dto';

/**
 * 📖 Platform Content Controller
 *
 * APIs لاستعراض دروس المنصة الموزعة + Fork + Fork & Publish
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
     * POST /school/teacher/platform-lessons/:uuid/fork-and-publish
     * Fork + نشر مباشر مع اختيار الشُعب المستهدفة
     */
    @Post('platform-lessons/:uuid/fork-and-publish')
    forkAndPublish(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: ForkAndPublishDto,
    ) {
        return this.service.forkAndPublish(
            req.schoolContext.id,
            req.user.sub,
            uuid,
            dto.sectionUuids,
        );
    }
}
