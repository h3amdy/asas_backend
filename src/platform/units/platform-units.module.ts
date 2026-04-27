// src/platform/units/platform-units.module.ts
import { Module } from '@nestjs/common';
import { PlatformUnitsController } from './platform-units.controller';
import { PlatformUnitsService } from './platform-units.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [PlatformUnitsController],
    providers: [PlatformUnitsService],
    exports: [PlatformUnitsService],
})
export class PlatformUnitsModule {}
