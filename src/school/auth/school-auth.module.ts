// src/school/auth/school-auth.module.ts

/**
 * 🔐 وحدة مصادقة المدرسة
 * تدير تسجيل الدخول/الخروج للأدوار: ADMIN, TEACHER, STUDENT, PARENT
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SchoolAuthController } from './school-auth.controller';
import { SchoolAuthService } from './school-auth.service';
import { SCHOOL_AUTH_JWT } from './constants';
import { SchoolJwtStrategy } from './strategies/school-jwt.strategy';

@Module({
    imports: [
        PrismaModule,
        SessionsModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: {
                issuer: SCHOOL_AUTH_JWT.issuer,
                audience: SCHOOL_AUTH_JWT.audience,
            },
        }),
    ],
    controllers: [SchoolAuthController],
    providers: [SchoolAuthService, SchoolJwtStrategy],
    exports: [SchoolAuthService],
})
export class SchoolAuthModule { }

