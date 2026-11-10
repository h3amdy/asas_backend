// src/shared/media/shared-media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from './storage.service';
import { MediaProcessingService } from './media-processing.service';
import { VideoMediaConfig } from './video-media.config';
import { R2StorageProvider } from './r2-storage.provider';
import { LocalObjectStorageProvider } from './local-object-storage.provider';
import { ObjectStorageRegistry } from './object-storage.registry';
import { DiskSpaceGuardService } from './disk-space-guard.service';
import { FfprobeService } from './ffprobe.service';
import { UploadValidationHelper } from './upload-validation.helper';
import { MediaAccessPolicyService } from './media-access-policy.service';
import { MediaLifecycleService } from './media-lifecycle.service';
import { VideoUploadService } from './video-upload.service';
import { MediaJobQueueService } from './queue/media-job-queue.service';
import { VideoTranscodeProcessor } from './worker/video-transcode.processor';
import { MoveSourceProcessor } from './worker/move-source.processor';
import { MediaWorkerService } from './worker/media-worker.service';
import { DeleteObjectsProcessor } from './worker/delete-objects.processor';

/**
 * 🎬 وحدة الوسائط المشتركة
 * - StorageService: التخزين على VPS
 * - MediaProcessingService: معالجة الصور والصوت (resize, transcode)
 * - VideoMediaConfig: إعدادات الفيديو المركزية + عزل R2 (VIDEO P4-1)
 * - R2StorageProvider / LocalObjectStorageProvider / ObjectStorageRegistry:
 *   العقد الموحد للتخزين (VIDEO P4-2)
 * - DiskSpaceGuardService: حارس مساحة القرص التزامني (VIDEO P4-3)
 * - FfprobeService: الفحص السداسي العميق (VIDEO P4-3)
 * - UploadValidationHelper: فحوصات W-050/W-057/W-058 وملكية الجلسة W-063 (VIDEO P4-3)
 * - MediaAccessPolicyService: صلاحيات رفع الفيديو الفعلية (VIDEO P4-3)
 * - VideoUploadService: منطق جلسات رفع الفيديو المشترك بين المدرسة والمنصة (VIDEO P4-3)
 * - MediaJobQueueService / VideoTranscodeProcessor / MoveSourceProcessor / MediaWorkerService:
 *   طابور وعامل معالجة الفيديو الخلفي مع السياج الأربعي وعزل الأجيال (VIDEO P4-4)
 * - DeleteObjectsProcessor: الخطوات 5–7 من دورة الحذف السباعي (VIDEO P4-6)
 *
 * تُستخدم من: SchoolMediaModule + PlatformMediaModule + MediaWorker
 */
@Module({
  imports: [PrismaModule],
  providers: [
    StorageService,
    MediaProcessingService,
    VideoMediaConfig,
    R2StorageProvider,
    LocalObjectStorageProvider,
    ObjectStorageRegistry,
    DiskSpaceGuardService,
    FfprobeService,
    UploadValidationHelper,
    MediaAccessPolicyService,
    MediaLifecycleService,
    VideoUploadService,
    MediaJobQueueService,
    VideoTranscodeProcessor,
    MoveSourceProcessor,
    DeleteObjectsProcessor,
    MediaWorkerService,
  ],
  exports: [
    StorageService,
    MediaProcessingService,
    VideoMediaConfig,
    R2StorageProvider,
    LocalObjectStorageProvider,
    ObjectStorageRegistry,
    DiskSpaceGuardService,
    FfprobeService,
    UploadValidationHelper,
    MediaAccessPolicyService,
    MediaLifecycleService,
    VideoUploadService,
    MediaJobQueueService,
    VideoTranscodeProcessor,
    MoveSourceProcessor,
    DeleteObjectsProcessor,
    MediaWorkerService,
  ],
})
export class SharedMediaModule {}
