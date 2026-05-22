// src/platform/sessions/platform-sessions.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformSessionsService } from './platform-sessions.service';

@Module({
    imports: [PrismaModule],
    providers: [PlatformSessionsService],
    exports: [PlatformSessionsService],
})
export class PlatformSessionsModule {}
