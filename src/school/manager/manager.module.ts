// src/school/manager/manager.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';

import { SchoolInfoController } from './school-info/school-info.controller';
import { SchoolInfoService } from './school-info/school-info.service';

import { GradesController } from './grades/grades.controller';
import { GradesService } from './grades/grades.service';

import { AcademicYearsController } from './academic-years/academic-years.controller';
import { AcademicYearsService } from './academic-years/academic-years.service';

import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';

import { ParentsController } from './parents/parents.controller';
import { ParentsService } from './parents/parents.service';

import { TeachersController } from './teachers/teachers.controller';
import { TeachersService } from './teachers/teachers.service';

import { SubjectsController } from './subjects/subjects.controller';
import { SubjectsService } from './subjects/subjects.service';

import { SetupController } from './setup/setup.controller';
import { SetupService } from './setup/setup.service';

import { TimetableController } from './timetable/timetable.controller';
import { TimetableService } from './timetable/timetable.service';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

import { RolloverController } from './rollover/rollover.controller';
import { RolloverService } from './rollover/rollover.service';

/**
 * 🏫 وحدة المدير — تجمع كل APIs إدارة المدرسة
 * جميع الـ endpoints تتطلب دور ADMIN
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [
        SchoolInfoController,
        GradesController,
        AcademicYearsController,
        StudentsController,
        ParentsController,
        TeachersController,
        SubjectsController,
        SetupController,
        TimetableController,
        DashboardController,
        RolloverController,
    ],
    providers: [
        SchoolInfoService,
        GradesService,
        AcademicYearsService,
        StudentsService,
        ParentsService,
        TeachersService,
        SubjectsService,
        SetupService,
        TimetableService,
        DashboardService,
        RolloverService,
    ],
})
export class ManagerModule { }
