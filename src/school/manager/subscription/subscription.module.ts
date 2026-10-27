// src/school/manager/subscription/subscription.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SchoolCommonModule } from '../../common/school-common.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { CodeBatchService } from './code-batch.service';
import { CodeGeneratorService } from './crypto/code-generator.service';
import { CodeCryptoService } from './crypto/code-crypto.service';
import { CodeHmacService } from './crypto/code-hmac.service';

/**
 * 📋 وحدة اشتراكات المدير — المرحلتان 2 و 3
 *
 * تعتمد على SchoolCommonModule (IdempotencyService + SubscriptionTrialService)
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [SubscriptionController],
    providers: [
        SubscriptionService,
        CodeBatchService,
        CodeGeneratorService,
        CodeCryptoService,
        CodeHmacService,
    ],
    exports: [CodeCryptoService, CodeHmacService],
})
export class SubscriptionModule {}
