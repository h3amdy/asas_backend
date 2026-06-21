// src/school/parent/parent.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';
import { StudentResultsAggregationService } from '../common/services/student-results-aggregation.service';
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
    providers: [ParentChildrenService, StudentResultsAggregationService],
})
export class ParentModule { }
