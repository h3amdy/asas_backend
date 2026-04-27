// src/platform/questions/platform-questions.module.ts
import { Module } from '@nestjs/common';
import { PlatformQuestionsController } from './platform-questions.controller';
import { PlatformQuestionsService } from './platform-questions.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [PlatformQuestionsController],
    providers: [PlatformQuestionsService],
    exports: [PlatformQuestionsService],
})
export class PlatformQuestionsModule {}
