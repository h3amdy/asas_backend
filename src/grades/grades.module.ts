import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GradesController } from './grades.controller';
import { GradesSyncController } from './grades-sync.controller';
import { GradesService } from './grades.service';
import { GradesSyncService } from './grades-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [GradesController, GradesSyncController],
  providers: [GradesService, GradesSyncService],
  exports: [GradesService, GradesSyncService],
})
export class GradesModule {}