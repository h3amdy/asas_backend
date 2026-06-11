// src/school/shared/platform-content/platform-content.module.ts
import { Module } from '@nestjs/common';
import { PlatformContentController } from './platform-content.controller';
import { PlatformContentService } from './platform-content.service';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * 📖 وحدة محتوى المنصة (مشتركة)
 * 
 * توفر APIs لاستعراض دروس المنصة الموزعة + Fork + Fork & Publish
 * موضوعة في shared/ لإمكانية التوسع لأدوار أخرى (مدير، مشرف)
 */
@Module({
    imports: [PrismaModule],
    controllers: [PlatformContentController],
    providers: [PlatformContentService],
    exports: [PlatformContentService],
})
export class PlatformContentModule {}
