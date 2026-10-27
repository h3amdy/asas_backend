// src/owner/imports/imports.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../../school/common/school-common.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [ImportsController],
    providers: [ImportsService],
    exports: [ImportsService],
})
export class ImportsModule {}
