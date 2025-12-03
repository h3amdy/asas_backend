// src/schools/schools.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { SchoolsSyncController } from './schools-sync.controller';
import { SchoolsSyncService } from './schools-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [SchoolsController, SchoolsSyncController],
  providers: [SchoolsService, SchoolsSyncService],
  exports: [SchoolsService, SchoolsSyncService],
})
export class SchoolsModule {}