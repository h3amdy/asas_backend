// src/platform/platform.module.ts
import { Module } from '@nestjs/common';
import { PlatformAuthModule } from './auth/platform-auth.module';
import { PlatformUsersModule } from './users/platform-users.module';
import { PlatformSubjectsModule } from './subjects/platform-subjects.module';
import { PlatformProfileModule } from './profile/platform-profile.module';

@Module({
  imports: [
    PlatformAuthModule,
    PlatformUsersModule,
    PlatformSubjectsModule,
    PlatformProfileModule,
  ],
})
export class PlatformModule {}
