// src/public/student-registration/student-registration.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StudentRegistrationController } from './student-registration.controller';
import { StudentRegistrationService } from './student-registration.service';
import { RegistrationDataController } from './registration-data.controller';
import { RegistrationDataService } from './registration-data.service';
import { OtpModule } from '../../shared/otp/otp.module';
import { SessionsModule } from '../../school/sessions/sessions.module';
import { SCHOOL_AUTH_JWT } from '../../school/auth/constants';

@Module({
  imports: [
    OtpModule,
    SessionsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        issuer: SCHOOL_AUTH_JWT.issuer,
        audience: SCHOOL_AUTH_JWT.audience,
      },
    }),
  ],
  controllers: [StudentRegistrationController, RegistrationDataController],
  providers: [StudentRegistrationService, RegistrationDataService],
})
export class StudentRegistrationModule {}
