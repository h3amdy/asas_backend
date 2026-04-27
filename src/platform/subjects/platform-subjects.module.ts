// src/platform/subjects/platform-subjects.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformSubjectsService } from './platform-subjects.service';
import { PlatformSubjectsController } from './platform-subjects.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformSubjectsController],
  providers: [PlatformSubjectsService],
})
export class PlatformSubjectsModule {}
