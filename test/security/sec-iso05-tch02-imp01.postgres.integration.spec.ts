/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AppType,
  EnrollmentStatus,
  GradeStage,
  PlatformRole,
  UserType,
} from '@prisma/client';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { UserCodeGeneratorService } from '../../src/common/user-code/user-code-generator.service';
import {
  ImportCredentialsCryptoService,
  IMPORT_CREDENTIALS_ENVELOPE_PREFIX,
} from '../../src/owner/imports/import-credentials-crypto.service';
import { ImportsService } from '../../src/owner/imports/imports.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SubscriptionTrialService } from '../../src/school/common/subscription/subscription-trial.service';
import { AcademicYearsService } from '../../src/school/manager/academic-years/academic-years.service';
import { TimetableService } from '../../src/school/manager/timetable/timetable.service';
import { ReportsService } from '../../src/school/reports/reports.service';
import { StudentProgressSummaryService } from '../../src/school/common/services/student-progress-summary.service';
import { TeacherReportController } from '../../src/school/teacher/reports/teacher-report.controller';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolvePgBinary(name: 'createdb' | 'dropdb'): string {
  const candidates = [
    `/usr/local/opt/libpq/bin/${name}`,
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return name;
}

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_sec_iso05_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-ISO-05, SEC-TCH-02 (DUP-R3-01), & SEC-IMP-01 — Real PostgreSQL Integration', () => {
  jest.setTimeout(120_000);

  const originalEnv = { ...process.env };
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prisma: PrismaService;
  let timetableService: TimetableService;
  let academicYearsService: AcademicYearsService;
  let reportsService: ReportsService;
  let teacherReportController: TeacherReportController;
  let importsService: ImportsService;
  let credentialsCrypto: ImportCredentialsCryptoService;

  let schoolA: any;
  let schoolB: any;
  let yearA: any;
  let termA1: any;
  let termA2: any;
  let yearB: any;
  let termB1: any;
  let termB2: any;
  let secA1: any;
  let secA2: any;
  let secB1: any;
  let ssA1Math: any;
  let ssA1Sci: any;
  let ssB1Math: any;
  let teacherA1: any;
  let teacherA2: any;
  let studentA1: any;
  let studentA2: any;
  let subjectA1Math: any;
  let subjectA1Sci: any;
  let lessonMath: any;
  let tplMath: any;
  let lessonSci: any;
  let platformAdmin: any;

  beforeAll(async () => {
    process.env.APP_ENV = 'local';
    process.env.JWT_SECRET = 'sec-iso05-pg-jwt-secret-key-min-32-chars!!';
    process.env.IMPORT_CREDENTIALS_ENC_KEY =
      'sec-iso05-pg-import-enc-key-min-32-chars!!';
    process.env.IMPORT_CREDENTIALS_TTL_HOURS = '24';

    tempDbName = `asas_sec_iso05_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);

    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}?connection_limit=15`;

    await execFileAsync(resolvePgBinary('createdb'), [
      '-h',
      'localhost',
      '-p',
      '5432',
      tempDbName,
    ]);
    dbCreated = true;

    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    prisma = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prisma.onModuleInit();

    const dbCheck: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (dbCheck[0]?.db !== tempDbName) {
      throw new Error(`ISOLATION FAILURE: got "${dbCheck[0]?.db}"`);
    }

    timetableService = new TimetableService(prisma);
    academicYearsService = new AcademicYearsService(prisma);
    reportsService = new ReportsService(
      prisma,
      new StudentProgressSummaryService(prisma),
    );
    teacherReportController = new TeacherReportController(reportsService, prisma);
    credentialsCrypto = new ImportCredentialsCryptoService();
    importsService = new ImportsService(
      prisma,
      new SubscriptionTrialService(),
      new UserCodeGeneratorService(),
      credentialsCrypto,
    );

    // Seed School A & B
    schoolA = await prisma.school.create({
      data: {
        name: 'PG Wave3 School A',
        displayName: 'مدرسة أ',
        schoolCode: 97001,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    schoolB = await prisma.school.create({
      data: {
        name: 'PG Wave3 School B',
        displayName: 'مدرسة ب',
        schoolCode: 97002,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });

    yearA = await prisma.year.create({
      data: { schoolId: schoolA.id, name: '2026-2027', isCurrent: true },
    });
    termA1 = await prisma.term.create({
      data: {
        yearId: yearA.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-15'),
        isCurrent: true,
      },
    });
    termA2 = await prisma.term.create({
      data: {
        yearId: yearA.id,
        name: 'الفصل الثاني',
        orderIndex: 2,
        startDate: new Date('2027-02-01'),
        endDate: new Date('2027-06-15'),
        isCurrent: false,
      },
    });

    yearB = await prisma.year.create({
      data: { schoolId: schoolB.id, name: '2026-2027', isCurrent: true },
    });
    termB1 = await prisma.term.create({
      data: {
        yearId: yearB.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-15'),
        isCurrent: true,
      },
    });
    termB2 = await prisma.term.create({
      data: {
        yearId: yearB.id,
        name: 'الفصل الثاني',
        orderIndex: 2,
        startDate: new Date('2027-02-01'),
        endDate: new Date('2027-06-15'),
        isCurrent: false,
      },
    });

    const dictG1 = await prisma.gradeDictionary.upsert({
      where: { code: 'G1_PG_TEST' },
      update: {},
      create: {
        code: 'G1_PG_TEST',
        defaultName: 'الأول',
        stage: GradeStage.PRIMARY,
        sortOrder: 1,
      },
    });

    const gradeA = await prisma.schoolGrade.create({
      data: { schoolId: schoolA.id, displayName: 'الأول أ', sortOrder: 1, dictionaryId: dictG1.id },
    });
    secA1 = await prisma.section.create({
      data: { gradeId: gradeA.id, name: 'أ', orderIndex: 1 },
    });
    secA2 = await prisma.section.create({
      data: { gradeId: gradeA.id, name: 'ب', orderIndex: 2 },
    });

    const gradeB = await prisma.schoolGrade.create({
      data: { schoolId: schoolB.id, displayName: 'الأول ب', sortOrder: 1 },
    });
    secB1 = await prisma.section.create({
      data: { gradeId: gradeB.id, name: 'أ', orderIndex: 1 },
    });

    subjectA1Math = await prisma.subject.create({
      data: { schoolId: schoolA.id, gradeId: gradeA.id, displayName: 'الرياضيات' },
    });
    subjectA1Sci = await prisma.subject.create({
      data: { schoolId: schoolA.id, gradeId: gradeA.id, displayName: 'العلوم' },
    });
    const subjectBMath = await prisma.subject.create({
      data: { schoolId: schoolB.id, gradeId: gradeB.id, displayName: 'رياضيات ب' },
    });

    ssA1Math = await prisma.subjectSection.create({
      data: { subjectId: subjectA1Math.id, sectionId: secA1.id },
    });
    ssA1Sci = await prisma.subjectSection.create({
      data: { subjectId: subjectA1Sci.id, sectionId: secA1.id },
    });
    const ssA2Math = await prisma.subjectSection.create({
      data: { subjectId: subjectA1Math.id, sectionId: secA2.id },
    });
    ssB1Math = await prisma.subjectSection.create({
      data: { subjectId: subjectBMath.id, sectionId: secB1.id },
    });

    // Teacher A1 teaches ONLY Math in secA1
    teacherA1 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 100101,
        name: 'معلم رياضيات 1أ',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    await prisma.teacher.create({ data: { userId: teacherA1.id } });
    await prisma.subjectSectionTeacher.create({
      data: { subjectSectionId: ssA1Math.id, teacherId: teacherA1.id, isActive: true },
    });

    // Teacher A2 teaches Sci in secA1 and Math in secA2
    teacherA2 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 100102,
        name: 'معلم 2',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    await prisma.teacher.create({ data: { userId: teacherA2.id } });
    await prisma.subjectSectionTeacher.createMany({
      data: [
        { subjectSectionId: ssA1Sci.id, teacherId: teacherA2.id, isActive: true },
        { subjectSectionId: ssA2Math.id, teacherId: teacherA2.id, isActive: true },
      ],
    });

    // Student A1 in secA1, Student A2 in secA2
    studentA1 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: 2297001,
        name: 'طالب الشعبة أ',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    await prisma.student.create({ data: { userId: studentA1.id } });
    await prisma.studentEnrollment.create({
      data: {
        studentId: studentA1.id,
        yearId: yearA.id,
        gradeId: gradeA.id,
        sectionId: secA1.id,
        isCurrent: true,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    studentA2 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: 2297002,
        name: 'طالب الشعبة ب',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    await prisma.student.create({ data: { userId: studentA2.id } });
    await prisma.studentEnrollment.create({
      data: {
        studentId: studentA2.id,
        yearId: yearA.id,
        gradeId: gradeA.id,
        sectionId: secA2.id,
        isCurrent: true,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    // Lessons & results in both Math (80%) and Science (20%) for studentA1
    tplMath = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA1Math.id,
        title: 'درس رياضيات 1',
        orderIndex: 1,
        status: 'READY',
        questionsRevision: 1,
      },
    });
    lessonMath = await prisma.lesson.create({
      data: {
        templateId: tplMath.id,
        schoolId: schoolA.id,
        teacherId: teacherA1.id,
        subjectId: subjectA1Math.id,
        yearId: yearA.id,
        termId: termA1.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await prisma.lessonTarget.create({
      data: { lessonId: lessonMath.id, sectionId: secA1.id, publishedAt: new Date() },
    });
    await prisma.studentLessonProgress.create({
      data: { studentId: studentA1.id, lessonId: lessonMath.id, status: 'COMPLETED' },
    });
    await prisma.studentLessonResult.create({
      data: {
        studentId: studentA1.id,
        lessonId: lessonMath.id,
        totalQuestions: 5,
        correctQuestions: 4,
        totalPoints: 10,
        earnedPoints: 8,
        percent: 80,
        gradeLabel: 'جيد جداً',
        calculatedAt: new Date(),
        questionsRevisionAtSubmit: 1,
      },
    });

    const tplSci = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA1Sci.id,
        title: 'درس علوم سرّي',
        orderIndex: 1,
        status: 'READY',
        questionsRevision: 1,
      },
    });
    lessonSci = await prisma.lesson.create({
      data: {
        templateId: tplSci.id,
        schoolId: schoolA.id,
        teacherId: teacherA2.id,
        subjectId: subjectA1Sci.id,
        yearId: yearA.id,
        termId: termA1.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await prisma.lessonTarget.create({
      data: { lessonId: lessonSci.id, sectionId: secA1.id, publishedAt: new Date() },
    });
    await prisma.studentLessonProgress.create({
      data: { studentId: studentA1.id, lessonId: lessonSci.id, status: 'COMPLETED' },
    });
    await prisma.studentLessonResult.create({
      data: {
        studentId: studentA1.id,
        lessonId: lessonSci.id,
        totalQuestions: 5,
        correctQuestions: 1,
        totalPoints: 10,
        earnedPoints: 2,
        percent: 20,
        gradeLabel: 'ضعيف',
        calculatedAt: new Date(),
        questionsRevisionAtSubmit: 1,
      },
    });

    platformAdmin = await prisma.platformUser.create({
      data: {
        email: 'pg_owner@mafhooom.test',
        username: 'pg_owner',
        passwordHash: 'hash',
        name: 'مالك PG',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    if (prisma) {
      await prisma.onModuleDestroy();
    }
    if (dbCreated && tempDbName) {
      assertSafeTestDb(tempDbName);
      await execFileAsync(resolvePgBinary('dropdb'), [
        '-h',
        'localhost',
        '-p',
        '5432',
        '--if-exists',
        tempDbName,
      ]);
    }
  });

  it('PG-1 (SEC-ISO-05): blocks cross-school yearId/termId injection, eliminates GET side-effects, and isolates timetable copy', async () => {
    // 1. Cross-school termId rejected & creates 0 timetable rows
    await expect(
      timetableService.getTimetable(schoolA.id, secA1.id, yearB.id, termB1.id),
    ).rejects.toThrow(new NotFoundException('TERM_NOT_FOUND'));

    const beforeCount = await prisma.timetable.count({
      where: { sectionId: secA1.id, yearId: yearB.id, termId: termB1.id },
    });
    expect(beforeCount).toBe(0);

    // 2. Valid empty GET returns uuid: '' and creates 0 timetable rows
    const emptyGet = await timetableService.getTimetable(
      schoolA.id,
      secA1.id,
      yearA.id,
      termA1.id,
    );
    expect(emptyGet.uuid).toBe('');
    expect(emptyGet.slots).toEqual([]);
    expect(
      await prisma.timetable.count({
        where: { sectionId: secA1.id, yearId: yearA.id, termId: termA1.id },
      }),
    ).toBe(0);

    // 3. saveTimetable rejects cross-school subjectSectionId with ZERO writes
    await expect(
      timetableService.saveTimetable(schoolA.id, secA1.id, yearA.id, termA1.id, {
        slots: [
          { weekday: 0, lessonNumber: 1, subjectSectionId: ssA1Math.id },
          { weekday: 0, lessonNumber: 2, subjectSectionId: ssB1Math.id },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(
      await prisma.timetable.count({
        where: { sectionId: secA1.id, yearId: yearA.id, termId: termA1.id },
      }),
    ).toBe(0);

    // 4. Valid save + conflict check + section-scoped delete
    const saved = await timetableService.saveTimetable(
      schoolA.id,
      secA1.id,
      yearA.id,
      termA1.id,
      {
        slots: [{ weekday: 1, lessonNumber: 2, subjectSectionId: ssA1Math.id }],
      },
    );
    expect(saved.slots).toHaveLength(1);
    const slotUuid = saved.slots[0].uuid;

    await expect(
      timetableService.checkTeacherConflicts(
        schoolA.id,
        secA1.id,
        yearB.id,
        termB1.id,
        1,
        2,
        ssA1Math.id,
      ),
    ).rejects.toThrow(new NotFoundException('TERM_NOT_FOUND'));

    await expect(
      timetableService.checkTeacherConflicts(
        schoolA.id,
        secA1.id,
        yearA.id,
        termA1.id,
        1,
        2,
        ssB1Math.id,
      ),
    ).rejects.toThrow(new NotFoundException('SUBJECT_SECTION_NOT_FOUND'));

    // deleteSlot rejects wrong sectionId even within School A
    await expect(
      timetableService.deleteSlot(schoolA.id, slotUuid, secA2.id),
    ).rejects.toThrow(new NotFoundException('SLOT_NOT_FOUND'));

    // 5. Seed a valid School B timetable AND a rogue School A section timetable stamped with yearB/termB1
    await timetableService.saveTimetable(schoolB.id, secB1.id, yearB.id, termB1.id, {
      slots: [{ weekday: 0, lessonNumber: 1, subjectSectionId: ssB1Math.id }],
    });
    const rogueTt = await prisma.timetable.create({
      data: { sectionId: secA1.id, yearId: yearB.id, termId: termB1.id },
    });
    await prisma.timetableSlot.create({
      data: { timetableId: rogueTt.id, weekday: 0, lessonNumber: 1, subjectSectionId: ssA1Math.id },
    });

    const copyRes = await academicYearsService.copyTimetable(schoolB.id, yearB.id, {
      sourceTermId: termB1.id,
      targetTermId: termB2.id,
    });
    expect(copyRes.copied).toBe(1);
    // Rogue School A section MUST NOT be copied into yearB/termB2
    const copiedRogue = await prisma.timetable.findFirst({
      where: { sectionId: secA1.id, yearId: yearB.id, termId: termB2.id },
    });
    expect(copiedRogue).toBeNull();

    // 6. Direct test of AcademicYearsService.startTerm(..., { copyTimetable: true }) isolation
    const termB3 = await prisma.term.create({
      data: {
        yearId: yearB.id,
        name: 'الفصل الثالث',
        orderIndex: 3,
        startDate: new Date('2027-07-01'),
        endDate: new Date('2027-08-30'),
        isCurrent: false,
      },
    });
    await prisma.term.update({
      where: { id: termB1.id },
      data: { isCurrent: false },
    });
    const rogueTtTerm2 = await prisma.timetable.create({
      data: { sectionId: secA1.id, yearId: yearB.id, termId: termB2.id },
    });
    await prisma.timetableSlot.create({
      data: { timetableId: rogueTtTerm2.id, weekday: 0, lessonNumber: 1, subjectSectionId: ssA1Math.id },
    });

    await academicYearsService.startTerm(schoolB.id, yearB.id, termB3.id, {
      copyTimetable: true,
    });

    const termB3State = await prisma.term.findUnique({ where: { id: termB3.id } });
    expect(termB3State?.isCurrent).toBe(true);

    const copiedOwnTerm3 = await prisma.timetable.findFirst({
      where: { sectionId: secB1.id, yearId: yearB.id, termId: termB3.id, isDeleted: false },
      include: { slots: { where: { isDeleted: false } } },
    });
    expect(copiedOwnTerm3).not.toBeNull();
    expect(copiedOwnTerm3?.slots).toHaveLength(1);
    expect(copiedOwnTerm3?.slots[0].subjectSectionId).toBe(ssB1Math.id);

    const copiedRogueTerm3 = await prisma.timetable.findFirst({
      where: { sectionId: secA1.id, yearId: yearB.id, termId: termB3.id },
    });
    expect(copiedRogueTerm3).toBeNull();

    // 7. getSectionSubjects excludes soft-deleted and cross-school subjects
    const deletedSubj = await prisma.subject.create({
      data: { schoolId: schoolA.id, gradeId: secA1.gradeId, displayName: 'مادة محذوفة', isDeleted: true },
    });
    await prisma.subjectSection.create({
      data: { subjectId: deletedSubj.id, sectionId: secA1.id, isDeleted: false },
    });
    const secSubjects = await timetableService.getSectionSubjects(schoolA.id, secA1.id);
    expect(secSubjects.map((s) => s.subjectUuid)).not.toContain(deletedSubj.uuid);
    expect(secSubjects.map((s) => s.subjectUuid)).toContain(subjectA1Math.uuid);
  });

  it('PG-2 (SEC-TCH-02 & DUP-R3-01): blocks horizontal teacher IDOR across students, subjects, KPIs, and lesson reviews', async () => {
    const reqT1 = { schoolContext: { id: schoolA.id }, user: { sub: teacherA1.uuid } };

    // 1. filter-options leaks ONLY teacherA1's subject (رياضيات) and section (أ)
    const filters = await teacherReportController.getFilterOptions(reqT1);
    expect(filters.subjects.map((s) => s.uuid)).toEqual([subjectA1Math.uuid]);
    expect(filters.sections.map((s) => s.uuid)).toEqual([secA1.uuid]);

    // 2. comprehensive report rejects unassigned subject or sectionB
    await expect(
      teacherReportController.getComprehensiveReport(reqT1, subjectA1Sci.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getComprehensiveReport(
        reqT1,
        subjectA1Math.uuid,
        undefined,
        'full_semester',
        secA2.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    const compMath = await teacherReportController.getComprehensiveReport(
      reqT1,
      subjectA1Math.uuid,
    );
    expect(compMath.students.map((s: any) => s.uuid)).toEqual([studentA1.uuid]);

    // 3. studentA2 is in secA2 (teacherA1 does NOT teach secA2) -> unified 403 across ALL paths & non-existent UUIDs (no 404 vs 403 oracle)
    await expect(
      teacherReportController.getStudentComprehensiveDetail(reqT1, studentA2.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getStudentSubjectComprehensive(
        reqT1,
        studentA2.uuid,
        subjectA1Math.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getStudentLessonReview(reqT1, studentA2.uuid, lessonMath.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getStudentLessonReview(
        reqT1,
        studentA2.uuid,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getStudentLessonReview(
        reqT1,
        crypto.randomUUID(),
        lessonMath.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 4. studentA1 comprehensive detail returns ONLY Math (80%), NOT Science (20%)
    const stuDetail = await teacherReportController.getStudentComprehensiveDetail(
      reqT1,
      studentA1.uuid,
    );
    expect(stuDetail.subjects.map((s: any) => s.uuid)).toEqual([subjectA1Math.uuid]);
    expect(stuDetail.overallKpis.gradePercent).toBe(80);

    // 5. studentA1 Science subject detail, Science lesson review, & non-existent lesson -> unified 403
    await expect(
      teacherReportController.getStudentSubjectComprehensive(
        reqT1,
        studentA1.uuid,
        subjectA1Sci.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getStudentLessonReview(reqT1, studentA1.uuid, lessonSci.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      teacherReportController.getStudentLessonReview(
        reqT1,
        studentA1.uuid,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(ForbiddenException);

    // 6. studentA1 Math lesson review succeeds AND still enforces SEC-R3-07 questionsRevision gate
    const reviewOk = await teacherReportController.getStudentLessonReview(
      reqT1,
      studentA1.uuid,
      lessonMath.uuid,
    );
    expect(reviewOk.reviewAvailable).toBe(true);
    expect(reviewOk.result.percent).toBe(80);

    await prisma.lessonTemplate.update({
      where: { id: tplMath.id },
      data: { questionsRevision: 2 },
    });
    const reviewRevMismatch = await teacherReportController.getStudentLessonReview(
      reqT1,
      studentA1.uuid,
      lessonMath.uuid,
    );
    expect(reviewRevMismatch.reviewAvailable).toBe(false);
    expect(reviewRevMismatch.questions).toEqual([]);
  });

  it('PG-3 (SEC-IMP-01): encrypts credentials_json with AES-256-GCM, checks TTL/lazy-wipe, and purges expired/legacy rows on cron', async () => {
    const preview = await importsService.previewStudents(
      schoolA.uuid,
      {
        _schema: 'asas_students_import_v1',
        students: [
          {
            student_name: 'طالب تشفير استيراد',
            gender: 'MALE',
            grade_code: 'G1_PG_TEST',
            section: 'أ',
          },
        ],
      },
      platformAdmin.uuid,
    );
    const executed = await importsService.executeImport(schoolA.uuid, preview.importUuid);
    expect(executed.credentials).toHaveLength(1);
    const plainPwd = executed.credentials[0].password;

    // DB stores ONLY enc:v1: ciphertext — ZERO plaintext password/name
    const rawSession = await prisma.importSession.findUnique({
      where: { uuid: preview.importUuid },
    });
    expect(rawSession?.credentialsJson?.startsWith(IMPORT_CREDENTIALS_ENVELOPE_PREFIX)).toBe(true);
    expect(rawSession?.credentialsJson).not.toContain(plainPwd);
    expect(rawSession?.credentialsJson).not.toContain('طالب تشفير استيراد');

    // Readiness exposes boolean hasActiveCredentials without leaking credentialsJson
    const readiness = await importsService.getImportReadiness(schoolA.uuid);
    const entry = readiness.recentImports.find((r: any) => r.uuid === preview.importUuid);
    expect(entry?.hasActiveCredentials).toBe(true);

    // Valid decrypt within TTL
    const fetched = await importsService.getCredentials(schoolA.uuid, preview.importUuid);
    expect(fetched.credentials[0].password).toBe(plainPwd);
    expect(fetched.expiresAt).toBeTruthy();

    // Cross-school isolation: School B cannot read School A's import credentials -> 404 IMPORT_SESSION_NOT_FOUND
    await expect(
      importsService.getCredentials(schoolB.uuid, preview.importUuid),
    ).rejects.toThrow(new NotFoundException('IMPORT_SESSION_NOT_FOUND'));

    // Swapping ciphertext across school/session AAD must fail decryption
    const alienSession = await prisma.importSession.create({
      data: {
        schoolId: schoolA.id,
        platformUserId: platformAdmin.id,
        importType: 'STUDENTS',
        status: 'COMPLETED',
        completedAt: new Date(),
        credentialsJson: rawSession!.credentialsJson, // wrong importUuid AAD!
      },
    });
    await expect(
      importsService.getCredentials(schoolA.uuid, alienSession.uuid),
    ).rejects.toThrow(InternalServerErrorException);

    // Backdating completedAt >24h -> lazy wipe & 410 GoneException
    await prisma.importSession.update({
      where: { uuid: preview.importUuid },
      data: { completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    await expect(
      importsService.getCredentials(schoolA.uuid, preview.importUuid),
    ).rejects.toThrow(GoneException);
    const wiped = await prisma.importSession.findUnique({
      where: { uuid: preview.importUuid },
    });
    expect(wiped?.credentialsJson).toBeNull();

    // Scheduled purge test: 1 fresh encrypted (keep), 1 expired encrypted (wipe), 1 fresh legacy plaintext (wipe)
    const freshEncUuid = crypto.randomUUID();
    const expiredEncUuid = crypto.randomUUID();
    const freshLegacyUuid = crypto.randomUUID();

    await prisma.importSession.createMany({
      data: [
        {
          uuid: freshEncUuid,
          schoolId: schoolA.id,
          platformUserId: platformAdmin.id,
          importType: 'STUDENTS',
          status: 'COMPLETED',
          completedAt: new Date(),
          credentialsJson: credentialsCrypto.encrypt([{ password: 'keep' }], schoolA.id, freshEncUuid),
        },
        {
          uuid: expiredEncUuid,
          schoolId: schoolA.id,
          platformUserId: platformAdmin.id,
          importType: 'STUDENTS',
          status: 'COMPLETED',
          completedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
          credentialsJson: credentialsCrypto.encrypt([{ password: 'old' }], schoolA.id, expiredEncUuid),
        },
        {
          uuid: freshLegacyUuid,
          schoolId: schoolA.id,
          platformUserId: platformAdmin.id,
          importType: 'STUDENTS',
          status: 'COMPLETED',
          completedAt: new Date(),
          credentialsJson: JSON.stringify([{ password: 'legacy-plaintext' }]),
        },
      ],
    });

    // Ensure alienSession stays clean before counting
    await prisma.importSession.update({
      where: { uuid: alienSession.uuid },
      data: { credentialsJson: null },
    });

    const purgeRes = await importsService.purgeExpiredCredentials({ ttlHours: 24 });
    expect(purgeRes.skippedDueToLock).toBe(false);
    expect(purgeRes.purgedCount).toBe(2);

    const rowsAfter = await prisma.importSession.findMany({
      where: { uuid: { in: [freshEncUuid, expiredEncUuid, freshLegacyUuid] } },
    });
    const byUuid = new Map(rowsAfter.map((r) => [r.uuid, r.credentialsJson]));
    expect(byUuid.get(freshEncUuid)?.startsWith(IMPORT_CREDENTIALS_ENVELOPE_PREFIX)).toBe(true);
    expect(byUuid.get(expiredEncUuid)).toBeNull();
    expect(byUuid.get(freshLegacyUuid)).toBeNull();
  });
});
