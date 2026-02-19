// src/school/school.module.ts
import { Module } from '@nestjs/common';
import { SchoolAuthModule } from './auth/school-auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { SchoolCommonModule } from './common/school-common.module';
import { ProfileModule } from './profile/profile.module';

/**
 * 🆕 وحدة المدرسة الرئيسية
 * تجمع كل ما يخص أدوار المدرسة (ADMIN/TEACHER/STUDENT/PARENT)
 */

@Module({
    imports: [SchoolAuthModule, SessionsModule, SchoolCommonModule, ProfileModule],
})
export class SchoolModule { }

