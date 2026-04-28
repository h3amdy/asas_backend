// src/shared/media/shared-media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from './storage.service';
import { MediaProcessingService } from './media-processing.service';

/**
 * 🎬 وحدة الوسائط المشتركة
 * - StorageService: التخزين على VPS
 * - MediaProcessingService: معالجة الصور والصوت (resize, transcode)
 * 
 * تُستخدم من: SchoolMediaModule + PlatformMediaModule
 */
@Module({
    imports: [PrismaModule],
    providers: [StorageService, MediaProcessingService],
    exports: [StorageService, MediaProcessingService],
})
export class SharedMediaModule {}
