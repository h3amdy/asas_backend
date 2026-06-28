// src/school/teacher/lesson-targeting/scheduled-lesson.cron.ts
// ─── Cron Job — نشر الدروس المجدولة المستحقة ───────────────────────────
// يعمل كل 5 دقائق — يبحث عن دروس SCHEDULED حان وقتها وينشرها
// ───────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LessonDeliveryService } from './lesson-delivery.service';

@Injectable()
export class ScheduledLessonCron {
    private readonly logger = new Logger(ScheduledLessonCron.name);

    constructor(private readonly deliveryService: LessonDeliveryService) {}

    /**
     * كل 5 دقائق — يفحص الدروس المجدولة المستحقة وينشرها
     * قابل للتعديل حسب الحاجة (يمكن جعله يومياً أو كل دقيقة)
     */
    @Cron('*/5 * * * *')
    async handleScheduledLessons() {
        try {
            const count = await this.deliveryService.publishDueLessons();
            if (count > 0) {
                this.logger.log(`✅ Published ${count} scheduled lesson(s)`);
            }
        } catch (error) {
            this.logger.error(`❌ Cron job failed: ${error}`);
        }
    }
}
