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
import { UpdateStatusDto } from './dto/update-status.dto';
import { CreateBlockDto } from './dto/create-block.dto';
import { UpdateBlockDto } from './dto/update-block.dto';
import { CreateBlockItemDto } from './dto/create-block-item.dto';
import { UpdateBlockItemDto } from './dto/update-block-item.dto';
import { ReorderBlocksDto } from './dto/reorder-blocks.dto';
import { ReorderBlockItemsDto } from './dto/reorder-block-items.dto';
import { MoveBlockItemDto } from './dto/move-block-item.dto';
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

    // ══════════════════════════════════════════════════
    //  الفقرات (Blocks)
    // ══════════════════════════════════════════════════

    /** GET — جلب الفقرات مع عناصرها */
    @Get('lessons/:lessonUuid/blocks')
    getBlocks(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
    ) {
        return this.service.getBlocks(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
        );
    }

    /** POST — إنشاء فقرة */
    @Post('lessons/:lessonUuid/blocks')
    createBlock(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: CreateBlockDto,
    ) {
        return this.service.createBlock(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    /** PATCH — إعادة ترتيب الفقرات (يجب أن يكون قبل :blockUuid) */
    @Patch('lessons/:lessonUuid/blocks/reorder')
    reorderBlocks(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Body() dto: ReorderBlocksDto,
    ) {
        return this.service.reorderBlocks(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            dto,
        );
    }

    /** PATCH — تعديل فقرة */
    @Patch('lessons/:lessonUuid/blocks/:blockUuid')
    updateBlock(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
        @Body() dto: UpdateBlockDto,
    ) {
        return this.service.updateBlock(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
            dto,
        );
    }

    /** DELETE — حذف فقرة */
    @Delete('lessons/:lessonUuid/blocks/:blockUuid')
    deleteBlock(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
    ) {
        return this.service.deleteBlock(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
        );
    }

    // ══════════════════════════════════════════════════
    //  عناصر الفقرة (Block Items)
    // ══════════════════════════════════════════════════

    /** POST — إضافة عنصر داخل فقرة */
    @Post('lessons/:lessonUuid/blocks/:blockUuid/items')
    createBlockItem(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
        @Body() dto: CreateBlockItemDto,
    ) {
        return this.service.createBlockItem(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
            dto,
        );
    }

    /** PATCH — إعادة ترتيب عناصر فقرة (يجب أن يكون قبل :itemUuid) */
    @Patch('lessons/:lessonUuid/blocks/:blockUuid/items/reorder')
    reorderBlockItems(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
        @Body() dto: ReorderBlockItemsDto,
    ) {
        return this.service.reorderBlockItems(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
            dto,
        );
    }

    /** PATCH — تعديل عنصر */
    @Patch('lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid')
    updateBlockItem(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
        @Param('itemUuid') itemUuid: string,
        @Body() dto: UpdateBlockItemDto,
    ) {
        return this.service.updateBlockItem(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
            itemUuid,
            dto,
        );
    }

    /** DELETE — حذف عنصر */
    @Delete('lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid')
    deleteBlockItem(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
        @Param('itemUuid') itemUuid: string,
    ) {
        return this.service.deleteBlockItem(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
            itemUuid,
        );
    }

    /** PATCH — نقل عنصر من فقرة لأخرى */
    @Patch('lessons/:lessonUuid/blocks/:blockUuid/items/:itemUuid/move')
    moveItemToBlock(
        @Req() req: any,
        @Param('lessonUuid') lessonUuid: string,
        @Param('blockUuid') blockUuid: string,
        @Param('itemUuid') itemUuid: string,
        @Body() dto: MoveBlockItemDto,
    ) {
        return this.service.moveItemToBlock(
            req.schoolContext.id,
            req.user.sub,
            lessonUuid,
            blockUuid,
            itemUuid,
            dto,
        );
    }
}
