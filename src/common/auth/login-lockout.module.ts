// src/common/auth/login-lockout.module.ts
// Shared singleton module exporting LoginLockoutService so both SchoolAuthModule
// and PlatformAuthModule reuse the exact same service instance and @Cron job.
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoginLockoutService } from '../../school/auth/login-lockout.service';

@Module({
  imports: [PrismaModule],
  providers: [LoginLockoutService],
  exports: [LoginLockoutService],
})
export class LoginLockoutModule {}

