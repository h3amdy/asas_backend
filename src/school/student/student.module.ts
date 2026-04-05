// src/school/student/student.module.ts
import { Module } from '@nestjs/common';
import { StudentSubjectsController } from './subjects/student-subjects.controller';
import { StudentSubjectsService } from './subjects/student-subjects.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';

/**
 * 🧑‍🎓 وحدة الطالب
 * تجمع كل الـ endpoints الخاصة بصلاحيات الطالب
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [StudentSubjectsController],
    providers: [StudentSubjectsService],
})
export class StudentModule { }
