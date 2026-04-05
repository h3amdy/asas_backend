// src/school/school.module.ts
import { Module } from '@nestjs/common';
import { SchoolAuthModule } from './auth/school-auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { SchoolCommonModule } from './common/school-common.module';
import { ProfileModule } from './profile/profile.module';
import { ManagerModule } from './manager/manager.module';
import { MediaModule } from './media/media.module';
import { TeacherModule } from './teacher/teacher.module';
import { StudentModule } from './student/student.module';

/**
 * 🆕 وحدة المدرسة الرئيسية
 * تجمع كل ما يخص أدوار المدرسة (ADMIN/TEACHER/STUDENT/PARENT)
 */

@Module({
    imports: [SchoolAuthModule, SessionsModule, SchoolCommonModule, ProfileModule, ManagerModule, MediaModule, TeacherModule, StudentModule],
})
export class SchoolModule { }



