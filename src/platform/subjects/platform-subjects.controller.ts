// src/platform/subjects/platform-subjects.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PlatformSubjectsService } from './platform-subjects.service';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';

@Controller('platform')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformSubjectsController {
  constructor(private subjectsService: PlatformSubjectsService) {}

  /**
   * GET /platform/subjects
   * المواد الرسمية المتاحة (PLT-020)
   */
  @Get('subjects')
  async findAllSubjects() {
    return this.subjectsService.findAllSubjects();
  }

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
