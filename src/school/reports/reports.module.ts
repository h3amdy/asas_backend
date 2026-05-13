// src/school/reports/reports.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';
import { StudentProgressSummaryService } from '../common/services/student-progress-summary.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * 📊 وحدة التقارير
 *
 * ADM-073: تقرير إنجاز الطلاب
 * - تقرير الطلاب (قائمة + فلاتر + ملخص + pagination)
 * - تفاصيل إنجاز طالب (ملخص + مواد)
 * - إنجاز طالب في مادة (دروس)
 *
 * حالياً: @Roles('ADMIN') فقط
 * مستقبلاً: TEACHER + SUPERVISOR مع فلتر نطاق الإسناد
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [ReportsController],
    providers: [ReportsService, StudentProgressSummaryService],
})
export class ReportsModule { }
