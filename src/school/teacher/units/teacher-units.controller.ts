// src/school/teacher/units/teacher-units.controller.ts
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
import { TeacherUnitsService } from './teacher-units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { ReorderUnitsDto } from './dto/reorder-units.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 📂 Teacher Units Controller
 *
 * إدارة الوحدات الخاصة بالمعلم داخل مادة محددة
 * TCH-020..023
 */
@Controller('school/teacher/subjects/:subjectId/units')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('TEACHER')
export class TeacherUnitsController {
    constructor(private readonly service: TeacherUnitsService) {}

    /** GET — جلب وحدات المادة (TCH-020) */
    @Get()
    getUnits(@Req() req: any, @Param('subjectId') subjectId: string) {
        return this.service.getUnits(
            req.schoolContext.id,
            req.user.sub,
            subjectId,
        );
    }

    /** POST — إضافة وحدة جديدة (TCH-023) */
    @Post()
    createUnit(
        @Req() req: any,
        @Param('subjectId') subjectId: string,
        @Body() dto: CreateUnitDto,
    ) {
        return this.service.createUnit(
            req.schoolContext.id,
            req.user.sub,
            subjectId,
            dto,
        );
    }

    /** PATCH — تعديل وحدة (TCH-021) */
    @Patch(':unitId')
    updateUnit(
        @Req() req: any,
        @Param('subjectId') subjectId: string,
        @Param('unitId') unitId: string,
        @Body() dto: UpdateUnitDto,
    ) {
        return this.service.updateUnit(
            req.schoolContext.id,
            req.user.sub,
            subjectId,
            unitId,
            dto,
        );
    }

    /** DELETE — حذف وحدة فارغة (TCH-022) */
    @Delete(':unitId')
    deleteUnit(
        @Req() req: any,
        @Param('subjectId') subjectId: string,
        @Param('unitId') unitId: string,
    ) {
        return this.service.deleteUnit(
            req.schoolContext.id,
            req.user.sub,
            subjectId,
            unitId,
        );
    }

    /** PUT — إعادة ترتيب الوحدات (TCH-020) */
    @Put('reorder')
    reorderUnits(
        @Req() req: any,
        @Param('subjectId') subjectId: string,
        @Body() dto: ReorderUnitsDto,
    ) {
        return this.service.reorderUnits(
            req.schoolContext.id,
            req.user.sub,
            subjectId,
            dto,
        );
    }
}
