// src/school/student/student.module.ts
import { Module } from '@nestjs/common';
import { StudentSubjectsController } from './subjects/student-subjects.controller';
import { StudentSubjectsService } from './subjects/student-subjects.service';
import { StudentTimetableController } from './timetable/student-timetable.controller';
import { StudentTimetableService } from './timetable/student-timetable.service';
import { StudentLessonsController } from './lessons/student-lessons.controller';
import { StudentLessonsService } from './lessons/student-lessons.service';
import { StudentQuizController } from './quiz/student-quiz.controller';
import { StudentQuizService } from './quiz/student-quiz.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';

/**
 * 🧑‍🎓 وحدة الطالب
 * تجمع كل الـ endpoints الخاصة بصلاحيات الطالب
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [
        StudentSubjectsController,
        StudentTimetableController,
        StudentLessonsController,
        StudentQuizController,
    ],
    providers: [
        StudentSubjectsService,
        StudentTimetableService,
        StudentLessonsService,
        StudentQuizService,
    ],
})
export class StudentModule { }
