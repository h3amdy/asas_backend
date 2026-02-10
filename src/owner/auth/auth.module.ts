// src/owner/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { OwnerJwtStrategy } from './jwt.strategy';
import { OWNER_AUTH_JWT } from './constants';
@Module({
  imports: [
    PrismaModule,
    PassportModule,
   
JwtModule.register({
  secret: process.env.JWT_SECRET || 'SUPER_SECRET_ASAS',
  signOptions: {
    expiresIn: OWNER_AUTH_JWT.accessTokenTtlSec, // أو '1d'
    issuer: OWNER_AUTH_JWT.issuer,
    audience: OWNER_AUTH_JWT.audience,
  },
}),
  ],
  controllers: [AuthController],
  providers: [AuthService, OwnerJwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
