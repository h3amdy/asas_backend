// src/school/media/media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedMediaModule } from '../../shared/media/shared-media.module';
import { MediaService } from './media.service';
import { MediaUploadService } from './media-upload.service';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaController } from './media.controller';
import { MediaUploadController } from './media-upload.controller';
import { SchoolMediaFromUrlController } from './media-from-url.controller';
import { SchoolMediaFromUrlService } from './media-from-url.service';

/**
 * 🎬 وحدة الوسائط — المدارس
 * - تنزيل ملفات (Range + ETag + Variants)
 * - رفع ملفات (Chunked + Resume + Processing Pipeline)
 * - تخزين على VPS (قابل للترحيل لاحقاً)
 * 
 * StorageService و MediaProcessingService تأتي من SharedMediaModule
 */
@Module({
    imports: [PrismaModule, SharedMediaModule],
    controllers: [MediaController, MediaUploadController, SchoolMediaFromUrlController],
    providers: [
        MediaService,
        MediaUploadService,
        MediaCleanupService,
        SchoolMediaFromUrlService,
    ],
    exports: [MediaService],
})
export class MediaModule { }
