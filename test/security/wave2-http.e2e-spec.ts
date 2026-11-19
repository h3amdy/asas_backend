/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessPeriodType, AppType, EnrollmentStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { promisify } from 'util';
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
  if (!/^asas_wave2_http_e2e_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('Wave 2 — Real HTTP E2E (AppModule + Supertest + ValidationPipe + JWT Guards)', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let app: INestApplication;
  let prisma: PrismaService;

  let schoolA: any;
  let schoolB: any;
  let studentA1: any;
  let studentA_unsub: any;
  let studentB: any;
  let parentA: any;
  let adminA: any;

  let lessonA1: any;
  let lessonA_sec2: any;
  let lessonB1: any;
  let tplA1: any;
  let qA1_mcq: any;
  let qA1_rightOpt: any;
  let qA1_wrongOpt: any;
  let qB1_mcq: any;

  let studentAToken = '';
  let studentAUnsubToken = '';
  let studentBToken = '';
  let parentAToken = '';
  let adminAToken = '';

  beforeAll(async () => {
    tempDbName = `asas_wave2_http_e2e_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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

    // Inject ephemeral test DB URL & JWT secrets BEFORE importing AppModule
    process.env.DATABASE_URL = tempDbUrl;
    process.env.APP_ENV = 'local';
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'wave2-ephemeral-e2e-jwt-secret-key-minimum-32-chars';
    }
    if (!process.env.PLATFORM_JWT_SECRET) {
      process.env.PLATFORM_JWT_SECRET = 'wave2-ephemeral-platform-jwt-secret-32-chars';
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
      throw new Error(`ISOLATION FAILURE: expected "${tempDbName}", got "${dbCheck[0]?.db}"`);
    }

    // Seed test schools, users, lessons & questions
    const passwordPlain = 'Wave2Http#2026';
    const hash = await bcrypt.hash(passwordPlain, 10);

    schoolA = await prisma.school.create({
      data: {
        name: 'E2E School A',
        displayName: 'مدرسة E2E أ',
        schoolCode: 94001,
        appType: AppType.PRIVATE,
      },
    });
    await prisma.schoolSubscriptionSettings.create({
      data: {
        schoolId: schoolA.id,
        isActivated: true,
        activatedAt: new Date('2026-09-01T00:00:00Z'),
        isTrialEnabled: true,
        trialDurationDays: 7,
        subscriptionPrice: 100,
        contactNumber: '+966500000001',
      },
    });

    schoolB = await prisma.school.create({
      data: {
        name: 'E2E School B',
        displayName: 'مدرسة E2E ب',
        schoolCode: 94002,
        appType: AppType.PRIVATE,
      },
    });
    await prisma.schoolSubscriptionSettings.create({
      data: {
        schoolId: schoolB.id,
        isActivated: true,
        activatedAt: new Date('2026-09-01T00:00:00Z'),
        isTrialEnabled: true,
        trialDurationDays: 7,
        subscriptionPrice: 100,
        contactNumber: '+966500000002',
      },
    });

    const yearA = await prisma.year.create({
      data: { schoolId: schoolA.id, name: '2026-2027', isCurrent: true },
    });
    const termA = await prisma.term.create({
      data: {
        yearId: yearA.id,
        name: 'الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isCurrent: true,
      },
    });
    const gradeA = await prisma.schoolGrade.create({
      data: { schoolId: schoolA.id, displayName: 'أول', sortOrder: 1 },
    });
    const secA1 = await prisma.section.create({
      data: { gradeId: gradeA.id, name: 'أ', orderIndex: 1 },
    });
    const secA2 = await prisma.section.create({
      data: { gradeId: gradeA.id, name: 'ب', orderIndex: 2 },
    });

    const yearB = await prisma.year.create({
      data: { schoolId: schoolB.id, name: '2026-2027', isCurrent: true },
    });
    const termB = await prisma.term.create({
      data: {
        yearId: yearB.id,
        name: 'الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isCurrent: true,
      },
    });
    const gradeB = await prisma.schoolGrade.create({
      data: { schoolId: schoolB.id, displayName: 'أول ب', sortOrder: 1 },
    });
    const secB1 = await prisma.section.create({
      data: { gradeId: gradeB.id, name: 'أ', orderIndex: 1 },
    });

    const teacherA = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 2401001,
        name: 'معلم أ',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prisma.teacher.create({ data: { userId: teacherA.id } });

    const teacherB = await prisma.user.create({
      data: {
        schoolId: schoolB.id,
        userType: UserType.TEACHER,
        code: 2401002,
        name: 'معلم ب',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prisma.teacher.create({ data: { userId: teacherB.id } });

    adminA = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.ADMIN,
        code: 2400001,
        name: 'مدير أ',
        passwordHash: hash,
        isActive: true,
      },
    });

    const seedStudent = async (
      schoolId: number,
      code: number,
      name: string,
      yearId: number,
      gradeId: number,
      sectionId: number,
    ) => {
      const u = await prisma.user.create({
        data: {
          schoolId,
          userType: UserType.STUDENT,
          code,
          name,
          passwordHash: hash,
          isActive: true,
        },
      });
      await prisma.student.create({ data: { userId: u.id } });
      await prisma.studentEnrollment.create({
        data: {
          studentId: u.id,
          yearId,
          gradeId,
          sectionId,
          isCurrent: true,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      return u;
    };

    studentA1 = await seedStudent(schoolA.id, 2402001, 'طالب أ1', yearA.id, gradeA.id, secA1.id);
    studentA_unsub = await seedStudent(schoolA.id, 2402002, 'طالب أ غير مشترك', yearA.id, gradeA.id, secA1.id);
    studentB = await seedStudent(schoolB.id, 2402003, 'طالب ب', yearB.id, gradeB.id, secB1.id);

    await prisma.studentAccessPeriod.create({
      data: {
        schoolId: schoolA.id,
        studentUserId: studentA1.id,
        periodType: AccessPeriodType.TRIAL,
        startedAt: new Date('2026-09-01T00:00:00Z'),
        expiresAt: new Date('2027-06-01T00:00:00Z'),
      },
    });

    parentA = await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.PARENT,
        code: 2403001,
        name: 'ولي أ',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prisma.parent.create({ data: { userId: parentA.id } });
    await prisma.parentStudent.create({
      data: { parentId: parentA.id, studentId: studentA1.id },
    });

    const subjectA = await prisma.subject.create({
      data: { schoolId: schoolA.id, gradeId: gradeA.id, displayName: 'رياضيات أ' },
    });
    const subjectB = await prisma.subject.create({
      data: { schoolId: schoolB.id, gradeId: gradeB.id, displayName: 'رياضيات ب' },
    });

    tplA1 = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA.id,
        title: 'درس E2E أ1',
        orderIndex: 1,
        status: 'READY',
        questionsRevision: 1,
      },
    });
    lessonA1 = await prisma.lesson.create({
      data: {
        templateId: tplA1.id,
        schoolId: schoolA.id,
        teacherId: teacherA.id,
        subjectId: subjectA.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
    await prisma.lessonTarget.create({
      data: {
        lessonId: lessonA1.id,
        sectionId: secA1.id,
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
    qA1_mcq = await prisma.question.create({
      data: { templateId: tplA1.id, type: 'MCQ', orderIndex: 1, questionText: '2+2=؟', score: 10 },
    });
    qA1_rightOpt = await prisma.questionOption.create({
      data: { questionId: qA1_mcq.id, optionText: '4', isCorrect: true, orderIndex: 1 },
    });
    qA1_wrongOpt = await prisma.questionOption.create({
      data: { questionId: qA1_mcq.id, optionText: '5', isCorrect: false, orderIndex: 2 },
    });

    const tplA2 = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA.id,
        title: 'درس شعبة 2 فقط',
        orderIndex: 2,
        status: 'READY',
      },
    });
    lessonA_sec2 = await prisma.lesson.create({
      data: {
        templateId: tplA2.id,
        schoolId: schoolA.id,
        teacherId: teacherA.id,
        subjectId: subjectA.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
      },
    });
    await prisma.lessonTarget.create({
      data: { lessonId: lessonA_sec2.id, sectionId: secA2.id, publishedAt: new Date() },
    });

    const tplB = await prisma.lessonTemplate.create({
      data: {
        schoolId: schoolB.id,
        subjectId: subjectB.id,
        title: 'درس E2E ب',
        orderIndex: 1,
        status: 'READY',
      },
    });
    lessonB1 = await prisma.lesson.create({
      data: {
        templateId: tplB.id,
        schoolId: schoolB.id,
        teacherId: teacherB.id,
        subjectId: subjectB.id,
        yearId: yearB.id,
        termId: termB.id,
        status: 'PUBLISHED',
      },
    });
    await prisma.lessonTarget.create({
      data: { lessonId: lessonB1.id, sectionId: secB1.id, publishedAt: new Date() },
    });
    qB1_mcq = await prisma.question.create({
      data: { templateId: tplB.id, type: 'MCQ', orderIndex: 1, questionText: 'سؤال ب', score: 5 },
    });

    // Real HTTP Logins (5 requests total < throttle limit 10/min)
    const login = async (code: number, schoolUuid: string, fp: string) => {
      const r = await request(app.getHttpServer())
        .post('/api/v1/school/auth/login')
        .send({
          schoolUuid,
          identifier: String(code),
          password: passwordPlain,
          deviceFingerprint: fp,
          deviceType: 'WEB',
        })
        .expect(201);
      return r.body.accessToken as string;
    };

    studentAToken = await login(2402001, schoolA.uuid, 'e2e-stu-a1');
    studentAUnsubToken = await login(2402002, schoolA.uuid, 'e2e-stu-unsub');
    studentBToken = await login(2402003, schoolB.uuid, 'e2e-stu-b');
    parentAToken = await login(2403001, schoolA.uuid, 'e2e-parent-a');
    adminAToken = await login(2400001, schoolA.uuid, 'e2e-admin-a');
  });

  afterAll(async () => {
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

  it('HTTP E2E: submit-quiz enforces ValidationPipe (forbidNonWhitelisted + DTO compat with Flutter isCorrect), rejects duplicate questionUuid with 400, and evaluates on server', async () => {
    // 1. Extra unexpected top-level property rejected by ValidationPipe (400)
    await request(app.getHttpServer())
      .post(`/api/v1/school/student/lesson/${lessonA1.uuid}/submit-quiz`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({
        unexpectedHackField: true,
        answers: [],
      })
      .expect(400);

    // 2. Duplicate questionUuid rejected with 400
    await request(app.getHttpServer())
      .post(`/api/v1/school/student/lesson/${lessonA1.uuid}/submit-quiz`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({
        answers: [
          { questionUuid: qA1_mcq.uuid, answerValue: { selectedOptionUuid: qA1_rightOpt.uuid }, isCorrect: true },
          { questionUuid: qA1_mcq.uuid, answerValue: { selectedOptionUuid: qA1_rightOpt.uuid }, isCorrect: true },
        ],
      })
      .expect(400);

    // 3. Flutter-compatible payload with wrong option + forged isCorrect: true -> HTTP 201, server returns 0%!
    const res = await request(app.getHttpServer())
      .post(`/api/v1/school/student/lesson/${lessonA1.uuid}/submit-quiz`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({
        questionsRevision: 1,
        answers: [
          {
            questionUuid: qA1_mcq.uuid,
            answerValue: { selectedOptionUuid: qA1_wrongOpt.uuid },
            isCorrect: true, // Forged!
          },
        ],
      })
      .expect(201);

    expect(res.body.correctQuestions).toBe(0);
    expect(res.body.earnedPoints).toBe(0);
    expect(res.body.percent).toBe(0);

    // 4. Cross-school lesson submission blocked (404 LESSON_NOT_FOUND)
    await request(app.getHttpServer())
      .post(`/api/v1/school/student/lesson/${lessonB1.uuid}/submit-quiz`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({ answers: [] })
      .expect(404);
  });

  it('HTTP E2E: check-answer blocks foreign question UUID (404) and validates body (400)', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/school/student/lesson/${lessonA1.uuid}/check-answer`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({ questionUuid: 'not-a-uuid', answerValue: {} })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/school/student/lesson/${lessonA1.uuid}/check-answer`)
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({ questionUuid: qB1_mcq.uuid, answerValue: { selectedOptionUuid: 'any' } })
      .expect(404);
  });

  it('HTTP E2E: sync/push accepts Flutter resync_* payloads, re-evaluates forged scores, rejects lesson_result & cross-school changes, and enforces subscription window', async () => {
    const validResyncUuid = `resync_answer_${crypto.randomUUID()}`;
    const lessonResultUuid = crypto.randomUUID();
    const schoolBLessonChange = crypto.randomUUID();

    const pushRes = await request(app.getHttpServer())
      .post('/api/v1/school/student/sync/push')
      .set('Authorization', `Bearer ${studentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({
        changes: [
          {
            clientChangeUuid: validResyncUuid,
            entityType: 'student_answer',
            entityUuid: qA1_mcq.uuid,
            operation: 'upsert',
            payload: {
              questionUuid: qA1_mcq.uuid,
              answerValue: JSON.stringify({ selectedOptionUuid: qA1_wrongOpt.uuid }),
              correctness: 'CORRECT', // Forged!
              isCorrect: true, // Forged!
              scoreAwarded: 999, // Forged!
              lessonUuid: lessonA1.uuid,
              studentUuid: studentA1.uuid,
            },
          },
          {
            clientChangeUuid: lessonResultUuid,
            entityType: 'lesson_result',
            entityUuid: crypto.randomUUID(),
            operation: 'upsert',
            payload: { lessonUuid: lessonA1.uuid, percent: 100 },
          },
          {
            clientChangeUuid: schoolBLessonChange,
            entityType: 'lesson_progress',
            entityUuid: 'prog-b',
            operation: 'upsert',
            payload: { lessonUuid: lessonB1.uuid, status: 'COMPLETED' },
          },
        ],
      })
      .expect(201);

    const byUuid = new Map<string, any>(
      pushRes.body.results.map((r: any) => [r.clientChangeUuid, r]),
    );
    expect(byUuid.get(validResyncUuid)?.status).toBe('OK');
    expect(byUuid.get(lessonResultUuid)?.status).toBe('ERROR');
    expect(byUuid.get(schoolBLessonChange)?.status).toBe('ERROR');

    // Verify DB persisted server-evaluated WRONG answer (0 pts), NOT 999
    const dbAns = await prisma.studentAnswer.findUniqueOrThrow({
      where: { studentId_questionId: { studentId: studentA1.id, questionId: qA1_mcq.id } },
    });
    expect(dbAns.isCorrect).toBe(false);
    expect(dbAns.scoreAwarded).toBe(0);

    // Unsubscribed student push returns per-item SUBSCRIPTION_REQUIRED error
    const unsubRes = await request(app.getHttpServer())
      .post('/api/v1/school/student/sync/push')
      .set('Authorization', `Bearer ${studentAUnsubToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .send({
        changes: [
          {
            clientChangeUuid: crypto.randomUUID(),
            entityType: 'lesson_progress',
            entityUuid: 'prog-unsub',
            operation: 'upsert',
            payload: { lessonUuid: lessonA1.uuid, status: 'COMPLETED' },
          },
        ],
      })
      .expect(201);
    expect(unsubRes.body.results[0].status).toBe('ERROR');
    expect(unsubRes.body.results[0].error).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('HTTP E2E: parent & report reviews enforce targeting and questionsRevision gating (SEC-SUB-01 & SEC-R3-07)', async () => {
    // Student A1 has a result on lessonA1 from submit-quiz test above (questionsRevisionAtSubmit = 1)
    // Non-targeted lesson (even if parent guesses UUID) -> 404
    await request(app.getHttpServer())
      .get(`/api/v1/school/parent/child/${studentA1.uuid}/lesson/${lessonA_sec2.uuid}/review`)
      .set('Authorization', `Bearer ${parentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(404);

    // Before question edit -> reviewAvailable: true
    const parentBefore = await request(app.getHttpServer())
      .get(`/api/v1/school/parent/child/${studentA1.uuid}/lesson/${lessonA1.uuid}/review`)
      .set('Authorization', `Bearer ${parentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(parentBefore.body.reviewAvailable).toBe(true);
    expect(parentBefore.body.questions).toHaveLength(1);

    // Bump template questionsRevision -> both parent & admin report reviews return reviewAvailable: false
    await prisma.lessonTemplate.update({
      where: { id: tplA1.id },
      data: { questionsRevision: 3 },
    });

    const parentAfter = await request(app.getHttpServer())
      .get(`/api/v1/school/parent/child/${studentA1.uuid}/lesson/${lessonA1.uuid}/review`)
      .set('Authorization', `Bearer ${parentAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(parentAfter.body.reviewAvailable).toBe(false);
    expect(parentAfter.body.questions).toEqual([]);

    const adminAfter = await request(app.getHttpServer())
      .get(`/api/v1/school/reports/student-progress/students/${studentA1.uuid}/lessons/${lessonA1.uuid}/review`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .set('x-school-uuid', schoolA.uuid)
      .expect(200);
    expect(adminAfter.body.reviewAvailable).toBe(false);
    expect(adminAfter.body.questions).toEqual([]);
  });
});
