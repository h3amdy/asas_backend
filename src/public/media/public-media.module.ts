// src/public/media/public-media.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MediaModule } from '../../school/media/media.module';
import { PublicMediaController } from './public-media.controller';

/**
 * 📥 وحدة الوسائط العامة
 * تقدم ملفات وسائط محدودة بدون مصادقة (شعارات المدارس فقط)
 */
@Module({
    imports: [PrismaModule, MediaModule],
    controllers: [PublicMediaController],
})
export class PublicMediaModule { }
