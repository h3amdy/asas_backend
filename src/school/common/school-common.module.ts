// src/school/common/school-common.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolContextGuard } from './guards/school-context.guard';
import { SubscriptionGuard } from './guards/subscription.guard';
import { AcademicContextService } from './academic-context/academic-context.service';
import { AcademicContextController } from './academic-context/academic-context.controller';
import { StudentProgressSummaryService } from './services/student-progress-summary.service';
import { IdempotencyService } from './subscription/idempotency.service';
import { SubscriptionTrialService } from './subscription/subscription-trial.service';

/**
 * 🔧 وحدة المكونات المشتركة للمدرسة
 * تحتوي على Guards و Decorators و Services المشتركة
 */
@Module({
    imports: [PrismaModule],
    controllers: [AcademicContextController],
    providers: [
        SchoolContextGuard,
        SubscriptionGuard,
        AcademicContextService,
        StudentProgressSummaryService,
        IdempotencyService,
        SubscriptionTrialService,
    ],
    exports: [
        SchoolContextGuard,
        SubscriptionGuard,
        AcademicContextService,
        StudentProgressSummaryService,
        IdempotencyService,
        SubscriptionTrialService,
    ],
})
export class SchoolCommonModule { }
