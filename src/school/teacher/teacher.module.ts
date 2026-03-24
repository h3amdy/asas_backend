// src/school/teacher/teacher.module.ts
import { Module } from '@nestjs/common';
import { TeacherSubjectsController } from './subjects/teacher-subjects.controller';
import { TeacherSubjectsService } from './subjects/teacher-subjects.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';

/**
 * 🧑‍🏫 وحدة المعلم
 * تجمع كل الـ endpoints الخاصة بصلاحيات المعلم
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [TeacherSubjectsController],
    providers: [TeacherSubjectsService],
})
export class TeacherModule { }
