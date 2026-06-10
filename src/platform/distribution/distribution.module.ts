// src/platform/distribution/distribution.module.ts
import { Module } from '@nestjs/common';
import { DistributionController } from './distribution.controller';
import { DistributionService } from './distribution.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [DistributionController],
    providers: [DistributionService],
    exports: [DistributionService],
})
export class DistributionModule {}
