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
import { UpdateStatusDto } from './dto/update-status.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { CreateBlockItemDto } from './dto/create-block-item.dto';
import { UpdateBlockItemDto } from './dto/update-block-item.dto';
import { ReorderBlocksDto } from './dto/reorder-blocks.dto';
import { ReorderBlockItemsDto } from './dto/reorder-block-items.dto';
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

    // ══════════════════════════════════════════════════
    //  الفقرات (Blocks) — النظام الجديد
    // ══════════════════════════════════════════════════

    @Get('lessons/:lessonUuid/blocks')
    getBlocks(@Req() req: any, @Param('lessonUuid') lessonUuid: string) {
        return this.service.getBlocks(req.user.sub, lessonUuid);
    }

    @Post('lessons/:lessonUuid/blocks')
    createBlock(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Body() dto: CreateBlockDto) {
        return this.service.createBlock(req.user.sub, lessonUuid, dto);
    }

    @Patch('lessons/:lessonUuid/blocks/reorder')
    reorderBlocks(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Body() dto: ReorderBlocksDto) {
        return this.service.reorderBlocks(req.user.sub, lessonUuid, dto);
    }

    @Patch('lessons/:lessonUuid/blocks/:blockUuid')
    updateBlock(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Param('blockUuid') blockUuid: string, @Body() dto: UpdateBlockDto) {
        return this.service.updateBlock(req.user.sub, lessonUuid, blockUuid, dto);
    }

    @Delete('lessons/:lessonUuid/blocks/:blockUuid')
    deleteBlock(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Param('blockUuid') blockUuid: string) {
        return this.service.deleteBlock(req.user.sub, lessonUuid, blockUuid);
    }

    // ─── عناصر الفقرة (Block Items) ───

    @Post('lessons/:lessonUuid/blocks/:blockUuid/items')
    createBlockItem(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Param('blockUuid') blockUuid: string, @Body() dto: CreateBlockItemDto) {
        return this.service.createBlockItem(req.user.sub, lessonUuid, blockUuid, dto);
    }

    @Patch('lessons/:lessonUuid/blocks/:blockUuid/items/reorder')
    reorderBlockItems(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Param('blockUuid') blockUuid: string, @Body() dto: ReorderBlockItemsDto) {
        return this.service.reorderBlockItems(req.user.sub, lessonUuid, blockUuid, dto);
    }

    @Patch('lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid')
    updateBlockItem(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Param('blockUuid') blockUuid: string, @Param('itemUuid') itemUuid: string, @Body() dto: UpdateBlockItemDto) {
        return this.service.updateBlockItem(req.user.sub, lessonUuid, blockUuid, itemUuid, dto);
    }

    @Delete('lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid')
    deleteBlockItem(@Req() req: any, @Param('lessonUuid') lessonUuid: string, @Param('blockUuid') blockUuid: string, @Param('itemUuid') itemUuid: string) {
        return this.service.deleteBlockItem(req.user.sub, lessonUuid, blockUuid, itemUuid);
    }
}

