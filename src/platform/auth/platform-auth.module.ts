// src/platform/auth/platform-auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PLATFORM_AUTH_JWT } from './constants';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'SUPER_SECRET_ASAS',
      signOptions: {
        expiresIn: PLATFORM_AUTH_JWT.accessTokenTtlSec,
        issuer: PLATFORM_AUTH_JWT.issuer,
        audience: PLATFORM_AUTH_JWT.audience,
      },
    }),
  ],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformJwtStrategy],
  exports: [PlatformAuthService],
})
export class PlatformAuthModule {}
