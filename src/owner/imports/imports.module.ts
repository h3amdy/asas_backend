// src/owner/imports/imports.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../../school/common/school-common.module';
import { ImportCredentialsCryptoService } from './import-credentials-crypto.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [ImportsController],
    providers: [ImportCredentialsCryptoService, ImportsService],
    exports: [ImportsService],
})
export class ImportsModule {}
