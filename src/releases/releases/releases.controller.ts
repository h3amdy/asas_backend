import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from '../dto/create-release.dto';
import { UpdateReleaseDto } from '../dto/update-release.dto';
import { CreateDistributionDto } from '../dto/create-distribution.dto';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform/auth/guards/platform-admin.guard';

@Controller('releases')
@UseGuards(PlatformJwtAuthGuard, PlatformAdminGuard)
export class ReleasesController {
  constructor(private readonly releasesService: ReleasesService) {}

  // ══════ Releases CRUD ══════

  @Get('apps/:appUuid/releases')
  findByApp(@Param('appUuid') appUuid: string) {
    return this.releasesService.findByApp(appUuid);
  }

  @Post('apps/:appUuid/releases')
  create(
    @Param('appUuid') appUuid: string,
    @Body() dto: CreateReleaseDto,
  ) {
    return this.releasesService.create(appUuid, dto);
  }

  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateReleaseDto) {
    return this.releasesService.update(uuid, dto);
  }

  // ══════ Release Lifecycle ══════

  @Post(':uuid/test')
  setTesting(@Param('uuid') uuid: string) {
    return this.releasesService.setTesting(uuid);
  }

  @Post(':uuid/publish')
  publish(@Param('uuid') uuid: string) {
    return this.releasesService.publish(uuid);
  }

  @Post(':uuid/deprecate')
  deprecate(@Param('uuid') uuid: string) {
    return this.releasesService.deprecate(uuid);
  }

  @Post(':uuid/revoke')
  revoke(@Param('uuid') uuid: string) {
    return this.releasesService.revoke(uuid);
  }

  // ══════ Distribution Channels ══════

  @Post(':uuid/distributions')
  addDistribution(
    @Param('uuid') uuid: string,
    @Body() dto: CreateDistributionDto,
  ) {
    return this.releasesService.addDistribution(uuid, dto);
  }

  @Patch('distributions/:uuid')
  updateDistribution(
    @Param('uuid') uuid: string,
    @Body() data: { downloadUrl?: string; fileSize?: number; isEnabled?: boolean },
  ) {
    return this.releasesService.updateDistribution(uuid, data);
  }

  @Delete('distributions/:uuid')
  deleteDistribution(@Param('uuid') uuid: string) {
    return this.releasesService.deleteDistribution(uuid);
  }
}
