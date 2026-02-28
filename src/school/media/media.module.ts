// src/school/media/media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from './storage.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaService } from './media.service';
import { MediaUploadService } from './media-upload.service';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaController } from './media.controller';
import { MediaUploadController } from './media-upload.controller';

/**
 * 🎬 وحدة الوسائط
 * - تنزيل ملفات (Range + ETag + Variants)
 * - رفع ملفات (Chunked + Resume + Processing Pipeline)
 * - تخزين على VPS (قابل للترحيل لاحقاً)
 */
@Module({
    imports: [PrismaModule],
    controllers: [MediaController, MediaUploadController],
    providers: [
        StorageService,
        MediaProcessingService,
        MediaService,
        MediaUploadService,
        MediaCleanupService,
    ],
    exports: [MediaService, StorageService],
})
export class MediaModule { }
