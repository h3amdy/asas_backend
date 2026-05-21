// src/platform/subjects/platform-subjects.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformSubjectsService } from './platform-subjects.service';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { ReorderSubjectsDto } from './dto/reorder-subjects.dto';
import { UpdateCoverDto } from './dto/update-cover.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Controller('platform')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformSubjectsController {
  constructor(private subjectsService: PlatformSubjectsService) {}

  // ═══════════════════════════════════════════════════
  //  المواد الرسمية — CRUD
  // ═══════════════════════════════════════════════════

  /**
   * GET /platform/subjects
   * المواد الرسمية (PLT-020)
   * Admin: يرى الكل (بما في ذلك المعطّلة)
   * Teacher: النشطة فقط
   */
  @Get('subjects')
  async findAllSubjects(@Query('includeInactive') includeInactive?: string) {
    const include = includeInactive === 'true';
    return this.subjectsService.findAllSubjects(include);
  }

  /**
   * GET /platform/subjects/:uuid
   * تفاصيل مادة واحدة
   */
  @Get('subjects/:uuid')
  async findSubjectByUuid(@Param('uuid') uuid: string) {
    return this.subjectsService.findSubjectByUuid(uuid);
  }

  /**
   * POST /platform/subjects
   * إنشاء مادة جديدة (Admin فقط)
   */
  @Post('subjects')
  @UseGuards(PlatformAdminGuard)
  async createSubject(@Body() dto: CreateSubjectDto) {
    return this.subjectsService.createSubject(dto);
  }

  /**
   * PATCH /platform/subjects/:uuid
   * تعديل مادة (Admin فقط) — الاسم والاسم المختصر فقط
   */
  @Patch('subjects/:uuid')
  @UseGuards(PlatformAdminGuard)
  async updateSubject(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.subjectsService.updateSubject(uuid, dto);
  }

  /**
   * PATCH /platform/subjects/:uuid/status
   * تفعيل/تعطيل مادة (Admin فقط)
   */
  @Patch('subjects/:uuid/status')
  @UseGuards(PlatformAdminGuard)
  async updateSubjectStatus(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.subjectsService.updateSubjectStatus(uuid, dto.isActive);
  }

  /**
   * PATCH /platform/subjects/:uuid/cover
   * تحديث صورة الغلاف (Admin فقط)
   */
  @Patch('subjects/:uuid/cover')
  @UseGuards(PlatformAdminGuard)
  async updateSubjectCover(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateCoverDto,
  ) {
    return this.subjectsService.updateSubjectCover(uuid, dto);
  }

  /**
   * PATCH /platform/subjects/reorder
   * إعادة ترتيب المواد داخل صف (Admin فقط)
   */
  @Patch('subjects/reorder')
  @UseGuards(PlatformAdminGuard)
  async reorderSubjects(@Body() dto: ReorderSubjectsDto) {
    return this.subjectsService.reorderSubjects(dto);
  }

  // ═══════════════════════════════════════════════════
  //  الصفوف الرسمية
  // ═══════════════════════════════════════════════════

  /**
   * GET /platform/grades
   * الصفوف الرسمية النشطة (لقائمة الاختيار)
   */
  @Get('grades')
  async findAllGrades() {
    return this.subjectsService.findAllGrades();
  }

  // ═══════════════════════════════════════════════════
  //  إسناد المواد لمعلمي المنصة (بدون تغيير)
  // ═══════════════════════════════════════════════════

  /**
   * POST /platform/users/:uuid/subjects
   * إسناد مواد لمعلم (PLT-021)
   */
  @Post('users/:uuid/subjects')
  @UseGuards(PlatformAdminGuard)
  async assignSubjects(
    @Param('uuid') userUuid: string,
    @Body('subjectUuids') subjectUuids: string[],
  ) {
    return this.subjectsService.assignSubjects(userUuid, subjectUuids);
  }

  /**
   * DELETE /platform/users/:uuid/subjects/:subjectUuid
   * إلغاء إسناد مادة (PLT-022)
   */
  @Delete('users/:uuid/subjects/:subjectUuid')
  @UseGuards(PlatformAdminGuard)
  async unassignSubject(
    @Param('uuid') userUuid: string,
    @Param('subjectUuid') subjectUuid: string,
  ) {
    return this.subjectsService.unassignSubject(userUuid, subjectUuid);
  }
}
