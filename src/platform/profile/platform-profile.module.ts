// src/platform/profile/platform-profile.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformProfileService } from './platform-profile.service';
import { PlatformProfileController } from './platform-profile.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformProfileController],
  providers: [PlatformProfileService],
})
export class PlatformProfileModule {}
