// src/platform/units/platform-units.controller.ts
import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Put,
    Req,
    UseGuards,
} from '@nestjs/common';
import { PlatformUnitsService } from './platform-units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { ReorderUnitsDto } from './dto/reorder-units.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';

/**
 * 📂 Platform Units Controller
 *
 * إدارة الوحدات لمعلمي المنصة — مرتبطة بـ subject_dictionary
 */
@Controller('platform/subjects/:subjectDictId/units')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformUnitsController {
    constructor(private readonly service: PlatformUnitsService) {}

    /** GET — جلب وحدات المادة */
    @Get()
    getUnits(@Req() req: any, @Param('subjectDictId') subjectDictId: string) {
        return this.service.getUnits(req.user.sub, subjectDictId);
    }

    /** POST — إضافة وحدة جديدة */
    @Post()
    createUnit(
        @Req() req: any,
        @Param('subjectDictId') subjectDictId: string,
        @Body() dto: CreateUnitDto,
    ) {
        return this.service.createUnit(req.user.sub, subjectDictId, dto);
    }

    /** PATCH — تعديل وحدة */
    @Patch(':unitId')
    updateUnit(
        @Req() req: any,
        @Param('subjectDictId') subjectDictId: string,
        @Param('unitId') unitId: string,
        @Body() dto: UpdateUnitDto,
    ) {
        return this.service.updateUnit(req.user.sub, subjectDictId, unitId, dto);
    }

    /** DELETE — حذف وحدة فارغة */
    @Delete(':unitId')
    deleteUnit(
        @Req() req: any,
        @Param('subjectDictId') subjectDictId: string,
        @Param('unitId') unitId: string,
    ) {
        return this.service.deleteUnit(req.user.sub, subjectDictId, unitId);
    }

    /** PUT — إعادة ترتيب الوحدات */
    @Put('reorder')
    reorderUnits(
        @Req() req: any,
        @Param('subjectDictId') subjectDictId: string,
        @Body() dto: ReorderUnitsDto,
    ) {
        return this.service.reorderUnits(req.user.sub, subjectDictId, dto);
    }
}
