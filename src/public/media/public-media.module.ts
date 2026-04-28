// src/public/media/public-media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedMediaModule } from '../../shared/media/shared-media.module';
import { PublicMediaController } from './public-media.controller';

/**
 * 📥 وحدة الوسائط العامة
 * تقدم ملفات وسائط محدودة بدون مصادقة (شعارات المدارس فقط)
 * StorageService تأتي من SharedMediaModule
 */
@Module({
    imports: [PrismaModule, SharedMediaModule],
    controllers: [PublicMediaController],
})
export class PublicMediaModule { }
