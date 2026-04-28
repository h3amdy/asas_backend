// src/platform/platform.module.ts
import { Module } from '@nestjs/common';
import { PlatformAuthModule } from './auth/platform-auth.module';
import { PlatformUsersModule } from './users/platform-users.module';
import { PlatformSubjectsModule } from './subjects/platform-subjects.module';
import { PlatformProfileModule } from './profile/platform-profile.module';
import { PlatformUnitsModule } from './units/platform-units.module';
import { PlatformLessonsModule } from './lessons/platform-lessons.module';
import { PlatformQuestionsModule } from './questions/platform-questions.module';
import { PlatformMediaModule } from './media/platform-media.module';

@Module({
  imports: [
    PlatformAuthModule,
    PlatformUsersModule,
    PlatformSubjectsModule,
    PlatformProfileModule,
    PlatformUnitsModule,
    PlatformLessonsModule,
    PlatformQuestionsModule,
    PlatformMediaModule,
  ],
})
export class PlatformModule {}
