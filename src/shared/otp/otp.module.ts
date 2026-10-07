// src/shared/otp/otp.module.ts
import { Module, Logger } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OTP_PROVIDER } from './providers/otp-provider.interface';
import { MockOtpProvider } from './providers/mock-otp.provider';
import { RoidNetOtpProvider } from './providers/roidnet-otp.provider';
import { OTP_DEFAULTS } from './otp.constants';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * 🔐 وحدة OTP — Provider يُحدد من environment
 *
 * local/staging → MockOtpProvider (SELF_MANAGED)
 * production    → RoidNetOtpProvider (DELEGATED) أو مزود حقيقي آخر
 */
@Module({
  imports: [PrismaModule],
  providers: [
    OtpService,
    {
      provide: OTP_PROVIDER,
      useFactory: () => {
        const appEnv = process.env.APP_ENV || 'local';
        const providerName = OTP_DEFAULTS.provider;
        const logger = new Logger('OtpModule');

        // production يجب أن يحدد provider حقيقي
        if (appEnv === 'production' && providerName === 'mock') {
          throw new Error(
            '❌ OTP_PROVIDER=mock is not allowed in production. ' +
            'Set OTP_PROVIDER to a real provider (e.g., roidnet).',
          );
        }

        switch (providerName) {
          case 'mock':
            logger.warn('🧪 Using MockOtpProvider — NOT for production!');
            return new MockOtpProvider();

          case 'roidnet':
            logger.log('🌐 Using RoidNet WhatsApp OTP Provider');
            return new RoidNetOtpProvider();

          default:
            throw new Error(
              `❌ Unknown OTP_PROVIDER="${providerName}". ` +
              `Supported: mock, roidnet.`,
            );
        }
      },
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
