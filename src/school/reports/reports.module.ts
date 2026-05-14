// src/school/reports/reports.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';
import { StudentProgressSummaryService } from '../common/services/student-progress-summary.service';
import { ReportsController } from './reports.controller';
import { GradesReportController } from './grades-report.controller';
import { ReportsService } from './reports.service';

/**
 * 📊 وحدة التقارير
 *
 * ADM-073: تقرير إنجاز الطلاب
 * ADM-074: تقرير درجات الطلاب
 *
 * حالياً: @Roles('ADMIN') فقط
 * مستقبلاً: TEACHER + SUPERVISOR مع فلتر نطاق الإسناد
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [ReportsController, GradesReportController],
    providers: [ReportsService, StudentProgressSummaryService],
})
export class ReportsModule { }

