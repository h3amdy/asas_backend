// src/school/manager/parents/parents.controller.ts
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ParentsService } from './parents.service';
import { CreateParentDto, UpdateParentDto, LinkChildrenDto } from './dto/parents.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/parents')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class ParentsController {
    constructor(private readonly service: ParentsService) { }

    @Get()
    list(@Req() req: any, @Query('q') q?: string) {
        return this.service.listParents(req.schoolContext.id, q);
    }

    @Post()
    create(@Req() req: any, @Body() dto: CreateParentDto) {
        return this.service.createParent(req.schoolContext.id, dto);
    }

    @Get(':uuid')
    getProfile(@Param('uuid') uuid: string) { return this.service.getParentProfile(uuid); }

    @Patch(':uuid')
    update(@Param('uuid') uuid: string, @Body() dto: UpdateParentDto) {
        return this.service.updateParent(uuid, dto);
    }

    @Post(':uuid/link-children')
    linkChildren(@Param('uuid') uuid: string, @Body() dto: LinkChildrenDto) {
        return this.service.linkChildren(uuid, dto);
    }

    @Delete(':uuid/children/:studentId')
    unlinkChild(@Param('uuid') uuid: string, @Param('studentId', ParseIntPipe) studentId: number) {
        return this.service.unlinkChild(uuid, studentId);
    }

    @Post(':uuid/reset-password')
    resetPassword(@Param('uuid') uuid: string, @Body('password') password?: string) {
        return this.service.resetPassword(uuid, password);
    }
}
