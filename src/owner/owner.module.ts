// src/owner/owner.module.ts
import { Module } from '@nestjs/common';
import { OwnerService } from './owner.service';
import { OwnerController } from './owner.controller';
import { SchoolsModule } from '../schools/schools.module';

@Module({
  imports: [SchoolsModule],        // نحتاج SchoolsService من هنا
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}
