// src/platform/users/platform-users.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformUsersService } from './platform-users.service';
import { PlatformUsersController } from './platform-users.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformUsersController],
  providers: [PlatformUsersService],
  exports: [PlatformUsersService],
})
export class PlatformUsersModule {}
