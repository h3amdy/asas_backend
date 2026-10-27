// src/school/student/subscription/student-subscription.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SchoolCommonModule } from '../../common/school-common.module';
import { SubscriptionModule } from '../../manager/subscription/subscription.module';
import { StudentSubscriptionController } from './student-subscription.controller';
import { StudentSubscriptionService } from './student-subscription.service';

/**
 * 🎫 وحدة اشتراك الطالب — المرحلة 6
 *
 * تعتمد على:
 * - SchoolCommonModule (IdempotencyService + Guards)
 * - SubscriptionModule (CodeHmacService — مُصدَّر منها)
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule, SubscriptionModule],
    controllers: [StudentSubscriptionController],
    providers: [StudentSubscriptionService],
    exports: [StudentSubscriptionService],
})
export class StudentSubscriptionModule {}
