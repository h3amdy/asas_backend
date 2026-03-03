// src/public/public.module.ts
import { Module } from '@nestjs/common';
import { PublicMediaModule } from './media/public-media.module';
import { PublicSchoolsModule } from './schools/public-schools.module';

/**
 * 🌍 وحدة الـ endpoints العامة (بدون مصادقة)
 * تُستخدم للبحث عن المدارس والتحقق من كودها قبل تسجيل الدخول
 */
@Module({
    imports: [PublicSchoolsModule, PublicMediaModule],
})
export class PublicModule { }
