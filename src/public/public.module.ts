// src/public/public.module.ts
import { Module } from '@nestjs/common';
import { PublicSchoolsModule } from './schools/public-schools.module';

/**
 * 🌍 وحدة الـ endpoints العامة (بدون مصادقة)
 * تُستخدم للبحث عن المدارس والتحقق من كودها قبل تسجيل الدخول
 */
@Module({
    imports: [PublicSchoolsModule],
})
export class PublicModule { }
