// src/school/manager/students/students.controller.ts
import {
    Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import {
    CreateStudentDto, UpdateStudentDto,
    SectionTransferDto, GradeTransferDto,
    DropEnrollmentDto, ReEnrollDto, ResetPasswordDto, ToggleActiveDto,
} from './dto/students.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/students')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class StudentsController {
    constructor(private readonly service: StudentsService) { }

    // ─── SRS-STU-01: List Students ──────────────────────────────

    @Get()
    list(
        @Req() req: any,
        @Query('gradeId') gradeId?: string,
        @Query('sectionId') sectionId?: string,
        @Query('yearId') yearId?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.listStudents(req.schoolContext.id, {
            gradeId: gradeId ? +gradeId : undefined,
            sectionId: sectionId ? +sectionId : undefined,
            yearId: yearId ? +yearId : undefined,
            search,
            page: page ? +page : undefined,
            limit: limit ? +limit : undefined,
        });
    }

    // ─── SRS-STU-02: Create Student ─────────────────────────────

    @Post()
    create(@Req() req: any, @Body() dto: CreateStudentDto) {
        return this.service.createStudent(req.schoolContext.id, dto);
    }

    // ─── SRS-STU-03: Student Profile ────────────────────────────

    @Get(':uuid')
    getProfile(@Req() req: any, @Param('uuid') uuid: string) {
        return this.service.getStudentProfile(uuid, req.schoolContext.id);
    }

    // ─── SRS-STU-04: Update Student ─────────────────────────────

    @Patch(':uuid')
    update(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: UpdateStudentDto,
    ) {
        return this.service.updateStudent(uuid, req.schoolContext.id, dto);
    }

    // ─── SRS-STU-05: Section Transfer ──────────────────────────

    @Post(':uuid/transfer-section')
    transferSection(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: SectionTransferDto,
    ) {
        return this.service.transferSection(uuid, req.schoolContext.id, dto);
    }

    // ─── SRS-STU-06: Grade Transfer ────────────────────────────

    @Post(':uuid/transfer-grade')
    transferGrade(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: GradeTransferDto,
    ) {
        return this.service.transferGrade(uuid, req.schoolContext.id, dto);
    }

    // ─── SRS-STU-07: Drop Enrollment ──────────────────────────

    @Post(':uuid/drop')
    drop(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: DropEnrollmentDto,
    ) {
        return this.service.dropEnrollment(uuid, req.schoolContext.id, dto);
    }

    // ─── SRS-STU-08: Re-Enroll ────────────────────────────────

    @Post(':uuid/re-enroll')
    reEnroll(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: ReEnrollDto,
    ) {
        return this.service.reEnroll(uuid, req.schoolContext.id, dto);
    }

    // ─── SRS-STU-09: Toggle Active ────────────────────────────

    @Patch(':uuid/toggle-active')
    toggleActive(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: ToggleActiveDto,
    ) {
        return this.service.toggleStudentActive(uuid, req.schoolContext.id, dto.isActive);
    }

    // ─── SRS-STU-10: Reset Password ──────────────────────────

    @Post(':uuid/reset-password')
    resetPassword(
        @Req() req: any,
        @Param('uuid') uuid: string,
        @Body() dto: ResetPasswordDto,
    ) {
        return this.service.resetPassword(uuid, req.schoolContext.id, dto);
    }

    // ─── SRS-STU-11: Get Credentials ─────────────────────────

    @Get(':uuid/credentials')
    getCredentials(@Req() req: any, @Param('uuid') uuid: string) {
        return this.service.getCredentials(uuid, req.schoolContext.id);
    }
}
