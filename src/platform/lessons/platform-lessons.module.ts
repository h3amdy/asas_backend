// src/platform/lessons/platform-lessons.module.ts
import { Module } from '@nestjs/common';
import { PlatformLessonsController } from './platform-lessons.controller';
import { PlatformLessonsService } from './platform-lessons.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedMediaModule } from '../../shared/media/shared-media.module';

@Module({
  imports: [PrismaModule, SharedMediaModule],
  controllers: [PlatformLessonsController],
  providers: [PlatformLessonsService],
  exports: [PlatformLessonsService],
})
export class PlatformLessonsModule {}
