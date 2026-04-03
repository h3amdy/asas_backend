// src/school/teacher/teacher.module.ts
import { Module } from '@nestjs/common';
import { TeacherSubjectsController } from './subjects/teacher-subjects.controller';
import { TeacherSubjectsService } from './subjects/teacher-subjects.service';
import { TeacherUnitsController } from './units/teacher-units.controller';
import { TeacherUnitsService } from './units/teacher-units.service';
import { TeacherLessonsController } from './lessons/teacher-lessons.controller';
import { TeacherLessonsService } from './lessons/teacher-lessons.service';
import { TeacherQuestionsController } from './questions/teacher-questions.controller';
import { TeacherQuestionsService } from './questions/teacher-questions.service';
import { TeacherLessonTargetingController } from './lesson-targeting/teacher-lesson-targeting.controller';
import { TeacherLessonTargetingService } from './lesson-targeting/teacher-lesson-targeting.service';
import { TeacherTimetableController } from './timetable/teacher-timetable.controller';
import { TeacherTimetableService } from './timetable/teacher-timetable.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';

/**
 * 🧑‍🏫 وحدة المعلم
 * تجمع كل الـ endpoints الخاصة بصلاحيات المعلم
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [TeacherSubjectsController, TeacherUnitsController, TeacherLessonsController, TeacherQuestionsController, TeacherLessonTargetingController, TeacherTimetableController],
    providers: [TeacherSubjectsService, TeacherUnitsService, TeacherLessonsService, TeacherQuestionsService, TeacherLessonTargetingService, TeacherTimetableService],
})
export class TeacherModule { }

