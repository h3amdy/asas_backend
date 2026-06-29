// src/school/teacher/lesson-targeting/scheduled-lesson.cron.ts
// ─── Cron Job — نشر الـ targets المجدولة المستحقة (DEC-020 v3.0) ───────
// يعمل كل 5 دقائق — يبحث عن targets حان وقتها وينشرها
// ───────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LessonDeliveryService } from './lesson-delivery.service';

@Injectable()
export class ScheduledLessonCron {
    private readonly logger = new Logger(ScheduledLessonCron.name);

    constructor(private readonly deliveryService: LessonDeliveryService) {}

    /**
     * كل 5 دقائق — يفحص targets المجدولة المستحقة وينشرها
     * SRS-P4-06: publishDueTargets
     */
    @Cron('*/5 * * * *')
    async handleScheduledTargets() {
        try {
            const count = await this.deliveryService.publishDueTargets();
            if (count > 0) {
                this.logger.log(`✅ Published ${count} scheduled target(s)`);
            }
        } catch (error) {
            this.logger.error(`❌ Cron job failed: ${error}`);
        }
    }
}
