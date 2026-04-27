// src/platform/lessons/platform-lessons.controller.ts
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
import { PlatformLessonsService } from './platform-lessons.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ReorderContentsDto } from './dto/reorder-contents.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';

/**
 * 📖 Platform Lessons Controller
 * إدارة الدروس ومحتوياتها — منصة المحتوى
 */
@Controller('platform')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformLessonsController {
    constructor(private readonly service: PlatformLessonsService) {}

    // ══════════════════════════════════════════
    //  الدروس (Lessons)
    // ══════════════════════════════════════════

    /** GET — قائمة الدروس مقسّمة بالوحدات */
    @Get('subjects/:subjectDictUuid/lessons-by-units')
    getLessonsByUnits(
        @Req() req: any,
        @Param('subjectDictUuid') subjectDictUuid: string,
    ) {
        return this.service.getLessonsByUnits(req.user.sub, subjectDictUuid);
    }

    /** POST — إنشاء درس جديد */
    @Post('subjects/:subjectDictUuid/units/:unitUuid/lessons')
    createLesson(
        @Req() req: any,
        @Param('subjectDictUuid') subjectDictUuid: string,
        @Param('unitUuid') unitUuid: string,
        @Body() dto: CreateLessonDto,
    ) {
        return this.service.createLesson(req.user.sub, subjectDictUuid, unitUuid, dto);
    }

    /** PATCH — تعديل درس */
    @Patch('lessons/:lessonUuid')
    updateLesson(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: UpdateLessonDto,
    ) {
        return this.service.updateLesson(req.user.sub, lessonUuid, dto);
    }

    /** DELETE — حذف درس DRAFT */
    @Delete('lessons/:lessonUuid')
    deleteLesson(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.deleteLesson(req.user.sub, lessonUuid);
    }

    /** PATCH — تغيير حالة الدرس */
    @Patch('lessons/:lessonUuid/status')
    updateStatus(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: UpdateStatusDto,
    ) {
        return this.service.updateStatus(req.user.sub, lessonUuid, dto);
    }

    // ══════════════════════════════════════════
    //  المحتوى (Contents)
    // ══════════════════════════════════════════

    /** GET — جلب محتوى الدرس */
    @Get('lessons/:lessonUuid/contents')
    getContents(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getContents(req.user.sub, lessonUuid);
    }

    /** POST — إضافة كتلة محتوى */
    @Post('lessons/:lessonUuid/contents')
    createContent(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: CreateContentDto,
    ) {
        return this.service.createContent(req.user.sub, lessonUuid, dto);
    }

    /** PATCH — إعادة ترتيب كتل المحتوى */
    @Patch('lessons/:lessonUuid/contents/reorder')
    reorderContents(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: ReorderContentsDto,
    ) {
        return this.service.reorderContents(req.user.sub, lessonUuid, dto);
    }

    /** PATCH — تعديل كتلة محتوى */
    @Patch('lessons/:lessonUuid/contents/:contentUuid')
    updateContent(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('contentUuid') contentUuid: string,
        @Body() dto: UpdateContentDto,
    ) {
        return this.service.updateContent(req.user.sub, lessonUuid, contentUuid, dto);
    }

    /** DELETE — حذف كتلة محتوى */
    @Delete('lessons/:lessonUuid/contents/:contentUuid')
    deleteContent(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('contentUuid') contentUuid: string,
    ) {
        return this.service.deleteContent(req.user.sub, lessonUuid, contentUuid);
    }
}
