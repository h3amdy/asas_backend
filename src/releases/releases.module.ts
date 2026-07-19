import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppsController } from './apps/apps.controller';
import { AppsService } from './apps/apps.service';
import { ReleasesController } from './releases/releases.controller';
import { ReleasesService } from './releases/releases.service';
import { UpdateCheckController } from './update-check/update-check.controller';
import { UpdateCheckService } from './update-check/update-check.service';
import { StatsController } from './stats/stats.controller';
import { StatsService } from './stats/stats.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AppsController,
    ReleasesController,
    UpdateCheckController,
    StatsController,
  ],
  providers: [
    AppsService,
    ReleasesService,
    UpdateCheckService,
    StatsService,
  ],
})
export class ReleasesModule {}
