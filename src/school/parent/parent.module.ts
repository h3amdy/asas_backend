// src/school/parent/parent.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';
import { StudentProgressSummaryService } from '../common/services/student-progress-summary.service';
import { ParentChildrenController } from './children/parent-children.controller';
import { ParentChildrenService } from './children/parent-children.service';

/**
 * 👨‍👧‍👦 وحدة ولي الأمر الرئيسية
 *
 * أول وحدة مخصصة لدور PARENT (منفصلة عن manager/parents)
 * تستورد SchoolCommonModule للـ Guards
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [ParentChildrenController],
    providers: [ParentChildrenService, StudentProgressSummaryService],
})
export class ParentModule { }
