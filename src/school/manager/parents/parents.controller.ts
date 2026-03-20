// src/school/manager/parents/parents.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParentsService } from './parents.service';
import { CreateParentDto, UpdateParentDto, LinkChildrenDto, ResetPasswordDto, ToggleActiveDto } from './dto/parents.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 👨‍👩‍👧 API إدارة أولياء الأمور — SRS-PAR
 *
 * Endpoints (9):
 * ┌──────────┬──────────────────────────────────────────────┬──────────────┐
 * │  Method  │  Route                                       │  SRS         │
 * ├──────────┼──────────────────────────────────────────────┼──────────────┤
 * │  GET     │  /school/manager/parents                     │  SRS-PAR-01  │
 * │  POST    │  /school/manager/parents                     │  SRS-PAR-02  │
 * │  GET     │  /school/manager/parents/:uuid               │  SRS-PAR-03  │
 * │  PATCH   │  /school/manager/parents/:uuid               │  SRS-PAR-04  │
 * │  PATCH   │  /school/manager/parents/:uuid/toggle-active │  SRS-PAR-05  │
 * │  POST    │  /school/manager/parents/:uuid/reset-password│  SRS-PAR-06  │
 * │  GET     │  /school/manager/parents/:uuid/credentials   │  SRS-PAR-07  │
 * │  POST    │  /school/manager/parents/:uuid/link-children │  SRS-PAR-08  │
 * │  DELETE  │  /school/manager/parents/:uuid/children/:id  │  SRS-PAR-08  │
 * └──────────┴──────────────────────────────────────────────┴──────────────┘
 */
@Controller('school/manager/parents')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class ParentsController {
    constructor(private readonly service: ParentsService) { }

    // ─── SRS-PAR-01: List & Search ──────────────────────────

    @Get()
    list(@Req() req: any, @Query('q') q?: string) {
        return this.service.listParents(req.schoolContext.id, q);
    }

    // ─── SRS-PAR-02: Create Parent ──────────────────────────

    @Post()
    create(@Req() req: any, @Body() dto: CreateParentDto) {
        return this.service.createParent(req.schoolContext.id, dto);
    }

    // ─── SRS-PAR-03: Parent Profile ─────────────────────────

    @Get(':uuid')
    getProfile(@Param('uuid') uuid: string) {
        return this.service.getParentProfile(uuid);
    }

    // ─── SRS-PAR-04: Update Parent ──────────────────────────

    @Patch(':uuid')
    update(@Param('uuid') uuid: string, @Body() dto: UpdateParentDto) {
        return this.service.updateParent(uuid, dto);
    }

    // ─── SRS-PAR-05: Block/Unblock ──────────────────────────

    @Patch(':uuid/toggle-active')
    toggleActive(@Param('uuid') uuid: string, @Body() dto: ToggleActiveDto) {
        return this.service.toggleActive(uuid, dto.isActive);
    }

    // ─── SRS-PAR-06: Reset Password ─────────────────────────

    @Post(':uuid/reset-password')
    resetPassword(@Param('uuid') uuid: string, @Body() dto: ResetPasswordDto) {
        return this.service.resetPassword(uuid, dto.password);
    }

    // ─── SRS-PAR-07: Get Credentials ────────────────────────

    @Get(':uuid/credentials')
    getCredentials(@Req() req: any, @Param('uuid') uuid: string) {
        return this.service.getCredentials(uuid, req.schoolContext.id);
    }

    // ─── SRS-PAR-08: Link Children ──────────────────────────

    @Post(':uuid/link-children')
    linkChildren(@Param('uuid') uuid: string, @Body() dto: LinkChildrenDto) {
        return this.service.linkChildren(uuid, dto);
    }

    // ─── SRS-PAR-08: Unlink Child ───────────────────────────

    @Delete(':uuid/children/:studentUuid')
    unlinkChild(@Param('uuid') uuid: string, @Param('studentUuid') studentUuid: string) {
        return this.service.unlinkChild(uuid, studentUuid);
    }
}
