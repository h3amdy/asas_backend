// src/public/public.module.ts
import { Module } from '@nestjs/common';
import { PublicMediaModule } from './media/public-media.module';
import { PublicSchoolsModule } from './schools/public-schools.module';
import { StudentRegistrationModule } from './student-registration/student-registration.module';

/**
 * 🌍 وحدة الـ endpoints العامة (بدون مصادقة)
 * تُستخدم للبحث عن المدارس والتحقق من كودها قبل تسجيل الدخول
 */
@Module({
    imports: [PublicSchoolsModule, PublicMediaModule, StudentRegistrationModule],
})
export class PublicModule { }
