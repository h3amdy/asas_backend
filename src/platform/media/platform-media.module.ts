// src/platform/media/platform-media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedMediaModule } from '../../shared/media/shared-media.module';
import { PlatformMediaService } from './platform-media.service';
import { PlatformMediaUploadService } from './platform-media-upload.service';
import { PlatformMediaController } from './platform-media.controller';
import { PlatformMediaUploadController } from './platform-media-upload.controller';

/**
 * 🎬 وحدة وسائط المنصة
 * - تنزيل (GET /platform/media/:uuid)
 * - رفع (POST /platform/media-upload/sessions)
 * 
 * StorageService و MediaProcessingService تأتي من SharedMediaModule
 */
@Module({
    imports: [PrismaModule, SharedMediaModule],
    controllers: [PlatformMediaController, PlatformMediaUploadController],
    providers: [PlatformMediaService, PlatformMediaUploadService],
    exports: [PlatformMediaService],
})
export class PlatformMediaModule {}
