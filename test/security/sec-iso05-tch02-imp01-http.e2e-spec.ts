/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AppType,
  EnrollmentStatus,
  GradeStage,
  PlatformRole,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { promisify } from 'util';
import { IMPORT_CREDENTIALS_ENVELOPE_PREFIX } from '../../src/owner/imports/import-credentials-crypto.service';
import { PrismaService } from '../../src/prisma/prisma.service';

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
  if (!/^asas_sec_iso05_http_e2e_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-ISO-05, SEC-TCH-02, & SEC-IMP-01 — Real HTTP E2E (AppModule + ValidationPipe + Guards)', () => {
  jest.setTimeout(120_000);

  const originalEnv = { ...process.env };
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let app: INestApplication;
  let prisma: PrismaService;

  let schoolA: any;
  let schoolB: any;
  let yearA: any;
  let termA1: any;
  let yearB: any;
  let termB1: any;
  let secA1: any;
  let secA2: any;
  let secB1: any;
  let ssA1Math: any;
  let ssB1Math: any;
  let subjectA1Math: any;
  let subjectA1Sci: any;
  let studentA1: any;
  let studentA2: any;
  let lessonMath: any;
  let lessonSci: any;

  let managerAToken = '';
  let teacherA1Token = '';
  let platformAdminToken = '';

  beforeAll(async () => {
    tempDbName = `asas_sec_iso05_http_e2e_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);

    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}?connection_limit=20`;

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

    process.env.DATABASE_URL = tempDbUrl;
    process.env.APP_ENV = 'local';
    process.env.JWT_SECRET =
      'sec-iso05-http-e2e-jwt-secret-key-min-32-chars!!';
    process.env.PLATFORM_JWT_SECRET =
      'sec-iso05-http-e2e-platform-jwt-secret-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'sec-iso05-http-e2e-hmac-secret-key-min-32-chars!!';
    process.env.IMPORT_CREDENTIALS_ENC_KEY =
      'sec-iso05-http-e2e-import-enc-key-min-32-chars!!';
    process.env.IMPORT_CREDENTIALS_TTL_HOURS = '24';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    const dbCheck: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (dbCheck[0]?.db !== tempDbName) {
      throw new Error(`ISOLATION FAILURE: got "${dbCheck[0]?.db}"`);
    }

    const passPlain = 'Wave3HttpE2e#2026';
    const hash = await bcrypt.hash(passPlain, 10);

    schoolA = await prisma.school.create({
      data: {
        name: 'E2E Wave3 School A',
        displayName: 'مدرسة أ',
        schoolCode: 98001,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    schoolB = await prisma.school.create({
      data: {
        name: 'E2E Wave3 School B',
        displayName: 'مدرسة ب',
        schoolCode: 98002,
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
        name: 'الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isCurrent: true,
      },
    });

    yearB = await prisma.year.create({
      data: { schoolId: schoolB.id, name: '2026-2027', isCurrent: true },
    });
    termB1 = await prisma.term.create({
      data: {
        yearId: yearB.id,
        name: 'الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isCurrent: true,
      },
    });

    const dictG1 = await prisma.gradeDictionary.upsert({
      where: { code: 'G1_E2E_TEST' },
      update: {},
      create: {
        code: 'G1_E2E_TEST',
        defaultName: 'الأول',
        stage: GradeStage.PRIMARY,
        sortOrder: 1,
      },
    });

    const gradeA = await prisma.schoolGrade.create({
      data: {
        schoolId: schoolA.id,
        displayName: 'الأول أ',
        sortOrder: 1,
        dictionaryId: dictG1.id,
      },
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
      data: { schoolId: schoolA.id, gradeId: gradeA.id, displayName: 'رياضيات' },
    });
    subjectA1Sci = await prisma.subject.create({
      data: { schoolId: schoolA.id, gradeId: gradeA.id, displayName: 'علوم' },
    });
    const subjectBMath = await prisma.subject.create({
      data: { schoolId: schoolB.id, gradeId: gradeB.id, displayName: 'رياضيات ب' },
    });

    ssA1Math = await prisma.subjectSection.create({
      data: { subjectId: subjectA1Math.id, sectionId: secA1.id },
    });
    await prisma.subjectSection.create({
      data: { subjectId: subjectA1Sci.id, sectionId: secA1.id },
    });
    ssB1Math = await prisma.subjectSection.create({
      data: { subjectId: subjectBMath.id, sectionId: secB1.id },
    });

    await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.ADMIN,
        code: 2450001,
        name: 'مدير E2E',
        passwordHash: hash,
        isActive: true,
      },
    });

    const teacherA1 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 2450101,
        name: 'معلم رياضيات 1',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prisma.teacher.create({ data: { userId: teacherA1.id } });
    await prisma.subjectSectionTeacher.create({
      data: { subjectSectionId: ssA1Math.id, teacherId: teacherA1.id, isActive: true },
    });

    const teacherA2 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 2450102,
        name: 'معلم علوم',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prisma.teacher.create({ data: { userId: teacherA2.id } });

    studentA1 = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: 2450201,
        name: 'طالب أ1',
        passwordHash: hash,
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
        code: 2450202,
        name: 'طالب أ2',
        passwordHash: hash,
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

    const tplMath = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA1Math.id,
        title: 'درس رياضيات E2E',
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
        correctQuestions: 5,
        totalPoints: 10,
        earnedPoints: 10,
        percent: 100,
        gradeLabel: 'ممتاز',
        calculatedAt: new Date(),
        questionsRevisionAtSubmit: 1,
      },
    });

    const tplSci = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA1Sci.id,
        title: 'درس علوم E2E',
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

    await prisma.platformUser.create({
      data: {
        email: 'e2e_wave3_owner@mafhooom.test',
        username: 'e2e_wave3_owner',
        passwordHash: hash,
        name: 'مالك Wave3',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });

    // Real HTTP logins
    const loginSchool = async (code: number, fp: string) => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/school/auth/login')
        .send({
          identifier: String(code),
          password: passPlain,
          deviceFingerprint: fp,
          deviceType: 'WEB',
        })
        .expect(201);
      return r.body.accessToken as string;
    };

    managerAToken = await loginSchool(2450001, 'fp-mgr-a');
    teacherA1Token = await loginSchool(2450101, 'fp-tch-a1');

    const platformLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({
        login: 'e2e_wave3_owner@mafhooom.test',
        password: passPlain,
      })
      .expect(201);
    platformAdminToken = platformLogin.body.accessToken as string;
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    try {
      if (app) await app.close();
    } finally {
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
    }
  });

  it('HTTP-1 (SEC-ISO-05): rejects cross-school GET/PUT timetable with 404/400, keeps empty GET read-only (200), and scopes DELETE slot by sectionId', async () => {
    const server = app.getHttpServer();

    // 1. Cross-school yearId/termId -> 404 TERM_NOT_FOUND
    const crossGet = await request(server)
      .get(`/api/v1/school/manager/sections/${secA1.id}/timetable?yearId=${yearB.id}&termId=${termB1.id}`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(404);
    expect(crossGet.body.message).toBe('TERM_NOT_FOUND');

    // 2. Valid empty GET -> 200 { uuid: '', slots: [] } without creating DB row
    const emptyGet = await request(server)
      .get(`/api/v1/school/manager/sections/${secA1.id}/timetable?yearId=${yearA.id}&termId=${termA1.id}`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(emptyGet.body.uuid).toBe('');
    expect(emptyGet.body.slots).toEqual([]);
    expect(await prisma.timetable.count()).toBe(0);

    // 3. Cross-school subjectSectionId on PUT -> 400
    await request(server)
      .put(`/api/v1/school/manager/sections/${secA1.id}/timetable?yearId=${yearA.id}&termId=${termA1.id}`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({ slots: [{ weekday: 0, lessonNumber: 1, subjectSectionId: ssB1Math.id }] })
      .expect(400);

    // 4. Valid PUT + wrong-section DELETE -> 404 + right-section DELETE -> 200
    const saved = await request(server)
      .put(`/api/v1/school/manager/sections/${secA1.id}/timetable?yearId=${yearA.id}&termId=${termA1.id}`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({ slots: [{ weekday: 0, lessonNumber: 1, subjectSectionId: ssA1Math.id }] })
      .expect(200);
    expect(saved.body.slots).toHaveLength(1);
    const slotUuid = saved.body.slots[0].uuid as string;

    await request(server)
      .delete(`/api/v1/school/manager/sections/${secA2.id}/timetable/slots/${slotUuid}`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(404);

    await request(server)
      .delete(`/api/v1/school/manager/sections/${secA1.id}/timetable/slots/${slotUuid}`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
  });

  it('HTTP-2 (SEC-TCH-02 & DUP-R3-01): enforces teacher authorization over HTTP on filter-options, comprehensive, detail, subject-detail, and review', async () => {
    const server = app.getHttpServer();

    const opts = await request(server)
      .get('/api/v1/school/teacher/reports/filter-options')
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(opts.body.subjects.map((s: any) => s.uuid)).toEqual([subjectA1Math.uuid]);
    expect(opts.body.sections.map((s: any) => s.uuid)).toEqual([secA1.uuid]);

    // Missing subjectUuid -> 400; unassigned subject -> 403
    await request(server)
      .get('/api/v1/school/teacher/reports/comprehensive')
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(400);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive?subjectUuid=${subjectA1Sci.uuid}`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    // Other section student -> 403 on all 3 student detail/review routes
    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA2.uuid}`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA2.uuid}/subjects/${subjectA1Math.uuid}`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA2.uuid}/lessons/${lessonMath.uuid}/review`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    // Own section student -> detail shows ONLY Math (100), Science routes return 403, Math review returns 200
    const detailOk = await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA1.uuid}`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(detailOk.body.subjects.map((s: any) => s.uuid)).toEqual([subjectA1Math.uuid]);
    expect(detailOk.body.overallKpis.gradePercent).toBe(100);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA1.uuid}/subjects/${subjectA1Sci.uuid}`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA1.uuid}/lessons/${lessonSci.uuid}/review`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    // Oracle closure: non-existent student/lesson & unassigned section return unified 403 (never 404)
    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA2.uuid}/lessons/${crypto.randomUUID()}/review`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA1.uuid}/lessons/${crypto.randomUUID()}/review`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${crypto.randomUUID()}/lessons/${lessonMath.uuid}/review`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(403);

    const reviewOk = await request(server)
      .get(`/api/v1/school/teacher/reports/comprehensive/students/${studentA1.uuid}/lessons/${lessonMath.uuid}/review`)
      .set('Authorization', `Bearer ${teacherA1Token}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(reviewOk.body.reviewAvailable).toBe(true);
    expect(reviewOk.body.result.percent).toBe(100);
  });

  it('HTTP-3 (SEC-IMP-01): encrypts imported credentials at rest, enforces no-store cache headers, isolates across schools (404), decrypts within 24h via GET /credentials, and returns 410 after expiry', async () => {
    const server = app.getHttpServer();

    const previewRes = await request(server)
      .post(`/api/v1/schools/${schoolA.uuid}/imports/students/preview`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({
        _schema: 'asas_students_import_v1',
        students: [
          {
            student_name: 'طالب استيراد E2E',
            gender: 'MALE',
            grade_code: 'G1_E2E_TEST',
            section: 'أ',
          },
        ],
      })
      .expect(201);
    const importUuid = previewRes.body.importUuid as string;

    const execRes = await request(server)
      .post(`/api/v1/schools/${schoolA.uuid}/imports/${importUuid}/execute`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(201);
    expect(execRes.headers['cache-control']).toContain('no-store');
    expect(execRes.headers['pragma']).toBe('no-cache');
    expect(execRes.body.credentials).toHaveLength(1);
    const plainPwd = execRes.body.credentials[0].password as string;

    // DB stores ONLY encrypted envelope
    const row = await prisma.importSession.findUnique({ where: { uuid: importUuid } });
    expect(row?.credentialsJson?.startsWith(IMPORT_CREDENTIALS_ENVELOPE_PREFIX)).toBe(true);
    expect(row?.credentialsJson).not.toContain(plainPwd);

    // Cross-school GET /credentials via School B UUID must return 404
    const crossSchoolRes = await request(server)
      .get(`/api/v1/schools/${schoolB.uuid}/imports/${importUuid}/credentials`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(404);
    expect(crossSchoolRes.body.message).toBe('IMPORT_SESSION_NOT_FOUND');

    // GET /credentials within 24h returns decrypted credentials + expiresAt + no-store headers
    const credsRes = await request(server)
      .get(`/api/v1/schools/${schoolA.uuid}/imports/${importUuid}/credentials`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(200);
    expect(credsRes.headers['cache-control']).toContain('no-store');
    expect(credsRes.headers['pragma']).toBe('no-cache');
    expect(credsRes.body.credentials[0].password).toBe(plainPwd);
    expect(credsRes.body.expiresAt).toBeTruthy();

    // After 25h -> GET /credentials returns 410 Gone and wipes DB column to NULL
    await prisma.importSession.update({
      where: { uuid: importUuid },
      data: { completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    await request(server)
      .get(`/api/v1/schools/${schoolA.uuid}/imports/${importUuid}/credentials`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .expect(410);

    const purgedRow = await prisma.importSession.findUnique({ where: { uuid: importUuid } });
    expect(purgedRow?.credentialsJson).toBeNull();
  });
});
