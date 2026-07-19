import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AppsService } from './apps.service';
import { CreateAppDto } from '../dto/create-app.dto';
import { UpdateAppDto } from '../dto/update-app.dto';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';

@Controller('releases/apps')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class AppsController {
  constructor(private readonly appsService: AppsService) {}

  @Get()
  findAll() {
    return this.appsService.findAll();
  }

  @Get(':uuid')
  findOne(@Param('uuid') uuid: string) {
    return this.appsService.findOne(uuid);
  }

  @Post()
  create(@Body() dto: CreateAppDto) {
    return this.appsService.create(dto);
  }

  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateAppDto) {
    return this.appsService.update(uuid, dto);
  }
}
