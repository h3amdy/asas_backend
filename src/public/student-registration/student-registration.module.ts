import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { StudentRegistrationController } from './student-registration.controller';
import { StudentRegistrationService } from './student-registration.service';
import { RegistrationDataController } from './registration-data.controller';
import { RegistrationDataService } from './registration-data.service';
import { PhoneRateLimiterService } from './phone-rate-limiter.service';
import { InMemoryRateLimitStorage } from './in-memory-rate-limit.storage';
import { RATE_LIMIT_STORAGE } from './phone-rate-limiter.interface';
import { OtpBypassGuard } from './guards/otp-bypass.guard';
import { OtpModule } from '../../shared/otp/otp.module';
import { SessionsModule } from '../../school/sessions/sessions.module';
import { SchoolCommonModule } from '../../school/common/school-common.module';
import { SCHOOL_AUTH_JWT } from '../../school/auth/constants';

@Module({
  imports: [
    OtpModule,
    SessionsModule,
    SchoolCommonModule, // SubscriptionTrialService — تجربة الطالب المسجّل ذاتياً
    // ThrottlerModule مطلوب هنا لكي يعمل @UseGuards(ThrottlerGuard) على هذا الـ controller
    // نُعيد استخدام نفس إعدادات AppModule (short + long)
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60000, limit: 5 },
      { name: 'long', ttl: 3600000, limit: 20 },
    ]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        issuer: SCHOOL_AUTH_JWT.issuer,
        audience: SCHOOL_AUTH_JWT.audience,
      },
    }),
  ],
  controllers: [StudentRegistrationController, RegistrationDataController],
  providers: [
    StudentRegistrationService,
    RegistrationDataService,
    PhoneRateLimiterService,
    InMemoryRateLimitStorage,
    {
      provide: RATE_LIMIT_STORAGE,
      useExisting: InMemoryRateLimitStorage,
    },
    OtpBypassGuard,
  ],
  exports: [StudentRegistrationService, PhoneRateLimiterService],
})
export class StudentRegistrationModule {}
