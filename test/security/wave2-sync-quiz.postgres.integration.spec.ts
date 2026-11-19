/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessPeriodType,
  AppType,
  EnrollmentStatus,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StudentProgressSummaryService } from '../../src/school/common/services/student-progress-summary.service';
import { StudentResultsAggregationService } from '../../src/school/common/services/student-results-aggregation.service';
import { ParentChildrenService } from '../../src/school/parent/children/parent-children.service';
import { ReportsService } from '../../src/school/reports/reports.service';
import { StudentQuizService } from '../../src/school/student/quiz/student-quiz.service';
import { StudentSyncService } from '../../src/school/student/sync/student-sync.service';

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
  if (!/^asas_wave2_sec_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('Wave 2 — Real PostgreSQL Sync & Quiz Security Integration (2 Connections)', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prismaA: PrismaService;
  let prismaB: PrismaService;

  let quizServiceA: StudentQuizService;
  let quizServiceB: StudentQuizService;
  let syncServiceA: StudentSyncService;
  let syncServiceB: StudentSyncService;
  let parentChildrenService: ParentChildrenService;
  let reportsService: ReportsService;

  // Seeded School A & School B entities
  let schoolA: any;
  let schoolB: any;
  let schoolFree: any;
  let yearA: any;
  let termA: any;
  let secA1: any;
  let secA2: any;
  let secB1: any;

  let teacherAUser: any;
  let studentA1User: any;
  let studentA_unsubUser: any;
  let studentA_expiredUser: any;
  let studentBUser: any;
  let parentAUser: any;

  // Lesson A1 (published to secA1, has MCQ 5pts + FILL 5pts)
  let lessonA1: any;
  let tplA1: any;
  let qA1_mcq: any;
  let qA1_mcq_rightOpt: any;
  let qA1_mcq_wrongOpt: any;
  let qA1_fill: any;

  // Lesson A_draft (unpublished to secA1)
  let lessonA_draft: any;
  let qA_draft: any;

  // Lesson A_sec2 (published ONLY to secA2, NOT secA1)
  let lessonA_sec2: any;

  // Lesson A_postExpiry (published AFTER studentA_expired cutoff)
  let lessonA_postExpiry: any;

  // Lesson A_noQuiz (accessible to secA1, 0 questions -> 100%)
  let lessonA_noQuiz: any;

  // Lesson B1 (School B)
  let lessonB1: any;
  let qB1_mcq: any;
  let studentBResultUuid: string;

  beforeAll(async () => {
    tempDbName = `asas_wave2_sec_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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

    prismaA = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaB = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prismaA.$connect();
    await prismaB.$connect();

    const rows: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(`Wrong DB connected: ${rows[0]?.db}`);
    }

    quizServiceA = new StudentQuizService(prismaA);
    quizServiceB = new StudentQuizService(prismaB);
    syncServiceA = new StudentSyncService(prismaA);
    syncServiceB = new StudentSyncService(prismaB);

    const progressSummaryA = new StudentProgressSummaryService(prismaA);
    const resultsAggA = new StudentResultsAggregationService(
      prismaA,
      progressSummaryA,
    );
    parentChildrenService = new ParentChildrenService(
      prismaA,
      progressSummaryA,
      resultsAggA,
    );
    reportsService = new ReportsService(prismaA, progressSummaryA);

    const hash = await bcrypt.hash('Wave2Pass#1', 10);

    // 1. Schools + Subscription settings (School A & B activated, Free disabled)
    schoolA = await prismaA.school.create({
      data: {
        name: 'Wave2 School A',
        displayName: 'مدرسة أ',
        schoolCode: 93001,
        appType: AppType.PRIVATE,
      },
    });
    await prismaA.schoolSubscriptionSettings.create({
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

    schoolB = await prismaA.school.create({
      data: {
        name: 'Wave2 School B',
        displayName: 'مدرسة ب',
        schoolCode: 93002,
        appType: AppType.PRIVATE,
      },
    });
    await prismaA.schoolSubscriptionSettings.create({
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

    schoolFree = await prismaA.school.create({
      data: {
        name: 'Wave2 School Free',
        displayName: 'مدرسة مجانية',
        schoolCode: 93003,
        appType: AppType.PRIVATE,
      },
    });

    // 2. Years, Terms, Grades, Sections
    yearA = await prismaA.year.create({
      data: { schoolId: schoolA.id, name: '2026-2027', isCurrent: true },
    });
    termA = await prismaA.term.create({
      data: {
        yearId: yearA.id,
        name: 'الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isCurrent: true,
      },
    });
    const gradeA = await prismaA.schoolGrade.create({
      data: { schoolId: schoolA.id, displayName: 'الصف الأول أ', sortOrder: 1 },
    });
    secA1 = await prismaA.section.create({
      data: { gradeId: gradeA.id, name: 'شعبة ١', orderIndex: 1 },
    });
    secA2 = await prismaA.section.create({
      data: { gradeId: gradeA.id, name: 'شعبة ٢', orderIndex: 2 },
    });

    const yearB = await prismaA.year.create({
      data: { schoolId: schoolB.id, name: '2026-2027', isCurrent: true },
    });
    const termB = await prismaA.term.create({
      data: {
        yearId: yearB.id,
        name: 'الأول',
        orderIndex: 1,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-01-20'),
        isCurrent: true,
      },
    });
    const gradeB = await prismaA.schoolGrade.create({
      data: { schoolId: schoolB.id, displayName: 'الصف الأول ب', sortOrder: 1 },
    });
    secB1 = await prismaA.section.create({
      data: { gradeId: gradeB.id, name: 'شعبة ١', orderIndex: 1 },
    });

    // 3. Users: Teacher A, Teacher B, Student A1 (subscribed), A_unsub, A_expired, Student B, Parent A
    teacherAUser = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 2301001,
        name: 'معلم أ',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({ data: { userId: teacherAUser.id } });

    const teacherBUser = await prismaA.user.create({
      data: {
        schoolId: schoolB.id,
        userType: UserType.TEACHER,
        code: 2301002,
        name: 'معلم ب',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({ data: { userId: teacherBUser.id } });

    const makeStudent = async (
      schoolId: number,
      code: number,
      name: string,
      yearId: number,
      gradeId: number,
      sectionId: number,
    ) => {
      const u = await prismaA.user.create({
        data: {
          schoolId,
          userType: UserType.STUDENT,
          code,
          name,
          passwordHash: hash,
          isActive: true,
        },
      });
      await prismaA.student.create({ data: { userId: u.id } });
      await prismaA.studentEnrollment.create({
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

    studentA1User = await makeStudent(schoolA.id, 2302001, 'طالب أ مشترك', yearA.id, gradeA.id, secA1.id);
    studentA_unsubUser = await makeStudent(schoolA.id, 2302002, 'طالب أ غير مشترك', yearA.id, gradeA.id, secA1.id);
    studentA_expiredUser = await makeStudent(schoolA.id, 2302003, 'طالب أ منتهي', yearA.id, gradeA.id, secA1.id);
    studentBUser = await makeStudent(schoolB.id, 2302004, 'طالب ب', yearB.id, gradeB.id, secB1.id);

    parentAUser = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.PARENT,
        code: 2303001,
        name: 'ولي أمر أ',
        passwordHash: hash,
        isActive: true,
      },
    });
    await prismaA.parent.create({ data: { userId: parentAUser.id } });
    await prismaA.parentStudent.create({
      data: { parentId: parentAUser.id, studentId: studentA1User.id },
    });
    await prismaA.parentStudent.create({
      data: { parentId: parentAUser.id, studentId: studentA_expiredUser.id },
    });

    // Access periods: studentA1 active; studentA_expired expired on 2026-11-01
    await prismaA.studentAccessPeriod.create({
      data: {
        schoolId: schoolA.id,
        studentUserId: studentA1User.id,
        periodType: AccessPeriodType.TRIAL,
        startedAt: new Date('2026-09-01T00:00:00Z'),
        expiresAt: new Date('2027-06-01T00:00:00Z'),
      },
    });
    await prismaA.studentAccessPeriod.create({
      data: {
        schoolId: schoolA.id,
        studentUserId: studentA_expiredUser.id,
        periodType: AccessPeriodType.TRIAL,
        startedAt: new Date('2026-10-01T00:00:00Z'),
        expiresAt: new Date('2026-11-01T00:00:00Z'),
      },
    });

    // 4. Subjects & Lessons
    const subjectA = await prismaA.subject.create({
      data: { schoolId: schoolA.id, gradeId: gradeA.id, displayName: 'علوم أ' },
    });
    const subjectB = await prismaA.subject.create({
      data: { schoolId: schoolB.id, gradeId: gradeB.id, displayName: 'علوم ب' },
    });

    const unitA = await prismaA.unit.create({
      data: { schoolId: schoolA.id, subjectId: subjectA.id, title: 'وحدة ١', orderIndex: 1 },
    });
    const unitB = await prismaA.unit.create({
      data: { schoolId: schoolB.id, subjectId: subjectB.id, title: 'وحدة ١ ب', orderIndex: 1 },
    });

    // Helper to create lesson + optional target
    const createSchoolLesson = async (opts: {
      schoolId: number;
      teacherId: number;
      subjectId: number;
      unitId: number;
      yearId: number;
      termId: number;
      title: string;
      orderIndex: number;
      sectionId?: number;
      publishedAt?: Date | null;
    }) => {
      const tpl = await prismaA.lessonTemplate.create({
        data: {
          schoolId: opts.schoolId,
          subjectId: opts.subjectId,
          unitId: opts.unitId,
          title: opts.title,
          orderIndex: opts.orderIndex,
          status: 'READY',
          questionsRevision: 1,
        },
      });
      const lesson = await prismaA.lesson.create({
        data: {
          templateId: tpl.id,
          schoolId: opts.schoolId,
          teacherId: opts.teacherId,
          subjectId: opts.subjectId,
          yearId: opts.yearId,
          termId: opts.termId,
          status: 'PUBLISHED',
          publishedAt: opts.publishedAt ?? null,
        },
      });
      if (opts.sectionId) {
        await prismaA.lessonTarget.create({
          data: {
            lessonId: lesson.id,
            sectionId: opts.sectionId,
            publishedAt: opts.publishedAt ?? null,
          },
        });
      }
      return { tpl, lesson };
    };

    const a1 = await createSchoolLesson({
      schoolId: schoolA.id,
      teacherId: teacherAUser.id,
      subjectId: subjectA.id,
      unitId: unitA.id,
      yearId: yearA.id,
      termId: termA.id,
      title: 'درس أ١ بالاختبار',
      orderIndex: 1,
      sectionId: secA1.id,
      publishedAt: new Date('2026-10-15T10:00:00Z'), // Before studentA_expired cutoff
    });
    tplA1 = a1.tpl;
    lessonA1 = a1.lesson;

    qA1_mcq = await prismaA.question.create({
      data: {
        templateId: tplA1.id,
        type: 'MCQ',
        orderIndex: 1,
        questionText: 'عاصمة مصر؟',
        score: 5,
      },
    });
    qA1_mcq_rightOpt = await prismaA.questionOption.create({
      data: { questionId: qA1_mcq.id, optionText: 'القاهرة', isCorrect: true, orderIndex: 1 },
    });
    qA1_mcq_wrongOpt = await prismaA.questionOption.create({
      data: { questionId: qA1_mcq.id, optionText: 'الإسكندرية', isCorrect: false, orderIndex: 2 },
    });

    qA1_fill = await prismaA.question.create({
      data: {
        templateId: tplA1.id,
        type: 'FILL',
        orderIndex: 2,
        questionText: 'عاصمة الأردن ____',
        score: 5,
      },
    });
    await prismaA.questionFillBlank.create({
      data: { questionId: qA1_fill.id, blankKey: 'b1', orderIndex: 1, placeholder: '...' },
    });
    await prismaA.questionFillAnswer.create({
      data: { questionId: qA1_fill.id, blankKey: 'b1', answerText: 'عمّان', isPrimary: true },
    });

    const aDraft = await createSchoolLesson({
      schoolId: schoolA.id,
      teacherId: teacherAUser.id,
      subjectId: subjectA.id,
      unitId: unitA.id,
      yearId: yearA.id,
      termId: termA.id,
      title: 'درس مسودة غير منشور',
      orderIndex: 2,
      sectionId: secA1.id,
      publishedAt: null,
    });
    lessonA_draft = aDraft.lesson;
    qA_draft = await prismaA.question.create({
      data: { templateId: aDraft.tpl.id, type: 'MCQ', orderIndex: 1, questionText: 'مسودة', score: 2 },
    });
    await prismaA.questionOption.create({
      data: { questionId: qA_draft.id, optionText: 'نعم', isCorrect: true, orderIndex: 1 },
    });

    const aSec2 = await createSchoolLesson({
      schoolId: schoolA.id,
      teacherId: teacherAUser.id,
      subjectId: subjectA.id,
      unitId: unitA.id,
      yearId: yearA.id,
      termId: termA.id,
      title: 'درس شعبة ٢ فقط',
      orderIndex: 3,
      sectionId: secA2.id,
      publishedAt: new Date('2026-10-15T10:00:00Z'),
    });
    lessonA_sec2 = aSec2.lesson;

    const aPost = await createSchoolLesson({
      schoolId: schoolA.id,
      teacherId: teacherAUser.id,
      subjectId: subjectA.id,
      unitId: unitA.id,
      yearId: yearA.id,
      termId: termA.id,
      title: 'درس نشر بعد انتهاء اشتراك الطالب',
      orderIndex: 4,
      sectionId: secA1.id,
      publishedAt: new Date('2026-11-15T10:00:00Z'), // AFTER 2026-11-01 cutoff
    });
    lessonA_postExpiry = aPost.lesson;

    const aNoQuiz = await createSchoolLesson({
      schoolId: schoolA.id,
      teacherId: teacherAUser.id,
      subjectId: subjectA.id,
      unitId: unitA.id,
      yearId: yearA.id,
      termId: termA.id,
      title: 'درس قرائي بدون أسئلة',
      orderIndex: 5,
      sectionId: secA1.id,
      publishedAt: new Date('2026-10-15T10:00:00Z'),
    });
    lessonA_noQuiz = aNoQuiz.lesson;

    const b1 = await createSchoolLesson({
      schoolId: schoolB.id,
      teacherId: teacherBUser.id,
      subjectId: subjectB.id,
      unitId: unitB.id,
      yearId: yearB.id,
      termId: termB.id,
      title: 'درس المدرسة ب',
      orderIndex: 1,
      sectionId: secB1.id,
      publishedAt: new Date('2026-10-15T10:00:00Z'),
    });
    lessonB1 = b1.lesson;
    qB1_mcq = await prismaA.question.create({
      data: { templateId: b1.tpl.id, type: 'MCQ', orderIndex: 1, questionText: 'سؤال ب', score: 5 },
    });
    const bOpt = await prismaA.questionOption.create({
      data: { questionId: qB1_mcq.id, optionText: 'صح ب', isCorrect: true, orderIndex: 1 },
    });
    const resB = await prismaA.studentLessonResult.create({
      data: {
        studentId: studentBUser.id,
        lessonId: lessonB1.id,
        totalQuestions: 1,
        correctQuestions: 1,
        totalPoints: 5,
        earnedPoints: 5,
        percent: 100,
        gradeLabel: 'ممتاز',
        calculatedAt: new Date(),
        version: 1,
        questionsRevisionAtSubmit: 1,
      },
    });
    studentBResultUuid = resB.uuid;
    await prismaA.studentAnswer.create({
      data: {
        studentId: studentBUser.id,
        questionId: qB1_mcq.id,
        resultId: resB.id,
        answerValue: JSON.stringify({ selectedOptionUuid: bOpt.uuid }),
        correctness: 'CORRECT',
        isCorrect: true,
        scoreAwarded: 5,
      },
    });
  });

  afterAll(async () => {
    try {
      if (prismaA) await prismaA.$disconnect();
      if (prismaB) await prismaB.$disconnect();
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

  it('SEC-SYNC-01 & SEC-SYNC-02: rejects cross-school/draft/wrong-section entities, forged lesson_result, and forged answer scores in sync/push', async () => {
    const chgSchoolB = `chg-${crypto.randomUUID()}`;
    const chgDraft = `chg-${crypto.randomUUID()}`;
    const chgSec2 = `chg-${crypto.randomUUID()}`;
    const chgForeignQ = `chg-${crypto.randomUUID()}`;
    const chgDraftQ = `chg-${crypto.randomUUID()}`;
    const chgForgedResult = `chg-${crypto.randomUUID()}`;

    const res = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: chgSchoolB,
          entityType: 'lesson_progress',
          entityUuid: 'prog-b',
          operation: 'upsert',
          payload: { lessonUuid: lessonB1.uuid, status: 'COMPLETED' },
        },
        {
          clientChangeUuid: chgDraft,
          entityType: 'lesson_progress',
          entityUuid: 'prog-draft',
          operation: 'upsert',
          payload: { lessonUuid: lessonA_draft.uuid, status: 'COMPLETED' },
        },
        {
          clientChangeUuid: chgSec2,
          entityType: 'lesson_progress',
          entityUuid: 'prog-sec2',
          operation: 'upsert',
          payload: { lessonUuid: lessonA_sec2.uuid, status: 'COMPLETED' },
        },
        {
          clientChangeUuid: chgForeignQ,
          entityType: 'student_answer',
          entityUuid: qB1_mcq.uuid,
          operation: 'upsert',
          payload: {
            questionUuid: qB1_mcq.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: 'any' }),
            isCorrect: true,
            scoreAwarded: 100,
            correctness: 'CORRECT',
            resultUuid: studentBResultUuid,
          },
        },
        {
          clientChangeUuid: chgDraftQ,
          entityType: 'student_answer',
          entityUuid: qA_draft.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA_draft.uuid,
            questionUuid: qA_draft.uuid,
            answerValue: { selectedOptionUuid: 'any' },
            isCorrect: true,
          },
        },
        {
          clientChangeUuid: chgForgedResult,
          entityType: 'lesson_result',
          entityUuid: crypto.randomUUID(),
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            totalQuestions: 1,
            correctQuestions: 1,
            totalPoints: 10,
            earnedPoints: 10,
            percent: 100,
            gradeLabel: 'ممتاز',
          },
        },
      ],
    });

    expect(res.results.every((r) => r.status === 'ERROR')).toBe(true);

    // Failed transactions rolled back processedClientChange entries -> retries won't get ALREADY_PROCESSED
    const recordedFailed = await prismaA.processedClientChange.count({
      where: {
        clientChangeUuid: {
          in: [chgSchoolB, chgDraft, chgSec2, chgForeignQ, chgDraftQ, chgForgedResult],
        },
      },
    });
    expect(recordedFailed).toBe(0);

    // ZERO progress or answers persisted for unowned lessons/questions
    expect(
      await prismaA.studentLessonProgress.count({
        where: {
          studentId: studentA1User.id,
          lessonId: { in: [lessonB1.id, lessonA_draft.id, lessonA_sec2.id] },
        },
      }),
    ).toBe(0);
    expect(
      await prismaA.studentAnswer.count({
        where: {
          studentId: studentA1User.id,
          questionId: { in: [qB1_mcq.id, qA_draft.id] },
        },
      }),
    ).toBe(0);

    // Forged student_answer on own lesson A1 (WRONG option + foreign resultUuid + forged isCorrect:true/scoreAwarded:999)
    const chgWrongAns = `chg-${crypto.randomUUID()}`;
    const resValid = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: chgWrongAns,
          entityType: 'student_answer',
          entityUuid: qA1_mcq.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_mcq.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: qA1_mcq_wrongOpt.uuid }),
            isCorrect: true,
            correctness: 'CORRECT',
            scoreAwarded: 999,
            resultUuid: studentBResultUuid, // Foreign School B resultUuid -> must be ignored!
          },
        },
      ],
    });
    expect(resValid.results[0]).toEqual({ clientChangeUuid: chgWrongAns, status: 'OK' });

    const storedAns = await prismaA.studentAnswer.findUniqueOrThrow({
      where: {
        studentId_questionId: { studentId: studentA1User.id, questionId: qA1_mcq.id },
      },
    });
    expect(storedAns.isCorrect).toBe(false);
    expect(storedAns.correctness).toBe('WRONG');
    expect(storedAns.scoreAwarded).toBe(0);
    expect(storedAns.resultId).toBeNull();
  });

  it('SEC-R3-04 + OBS-W2-01: handles Outbox ordering (COMPLETED before answers), questionless 100%, and edited answer re-sync', async () => {
    // 1. Offline COMPLETED arrives BEFORE all answers on lessonA1 -> NO premature 0% result!
    const chgComp = `chg-${crypto.randomUUID()}`;
    const resComp = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: chgComp,
          entityType: 'lesson_progress',
          entityUuid: 'prog-a1',
          operation: 'upsert',
          payload: { lessonUuid: lessonA1.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(resComp.results[0].status).toBe('OK');

    // Monotonic COMPLETED guard: subsequent IN_PROGRESS must NOT downgrade progress
    await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: `chg-${crypto.randomUUID()}`,
          entityType: 'lesson_progress',
          entityUuid: 'prog-a1',
          operation: 'upsert',
          payload: { lessonUuid: lessonA1.uuid, status: 'IN_PROGRESS' },
        },
      ],
    });
    const progRow = await prismaA.studentLessonProgress.findUniqueOrThrow({
      where: { studentId_lessonId: { studentId: studentA1User.id, lessonId: lessonA1.id } },
    });
    expect(progRow.status).toBe('COMPLETED');

    // Currently only qA1_mcq has an answer (1/2) -> ZERO 0% result created yet!
    expect(
      await prismaA.studentLessonResult.count({
        where: { studentId: studentA1User.id, lessonId: lessonA1.id },
      }),
    ).toBe(0);

    // 2. OBS-W2-01: Edit synced wrong answer (qA1_mcq -> RIGHT option) using a NEW clientChangeUuid
    // + verify retry of old clientChangeUuid returns ALREADY_PROCESSED and does NOT overwrite!
    const chgEditMcq = `resync_answer_${crypto.randomUUID()}`;
    const resEdit = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: chgEditMcq,
          entityType: 'student_answer',
          entityUuid: qA1_mcq.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_mcq.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: qA1_mcq_rightOpt.uuid }),
            isCorrect: false, // Even if client stale-flagged false, server evaluates true
          },
        },
      ],
    });
    expect(resEdit.results[0].status).toBe('OK');

    // Retry after network blip with same chgEditMcq -> ALREADY_PROCESSED
    const resRetry = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: chgEditMcq,
          entityType: 'student_answer',
          entityUuid: qA1_mcq.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_mcq.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: qA1_mcq_wrongOpt.uuid }),
          },
        },
      ],
    });
    expect(resRetry.results[0].status).toBe('ALREADY_PROCESSED');

    const updatedMcqAns = await prismaA.studentAnswer.findUniqueOrThrow({
      where: { studentId_questionId: { studentId: studentA1User.id, questionId: qA1_mcq.id } },
    });
    expect(updatedMcqAns.isCorrect).toBe(true);
    expect(updatedMcqAns.scoreAwarded).toBe(5);

    // 3. Second answer (qA1_fill) arrives AFTER COMPLETED -> automatically derives 100% result!
    const resFill = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: `chg-${crypto.randomUUID()}`,
          entityType: 'student_answer',
          entityUuid: qA1_fill.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_fill.uuid,
            answerValue: JSON.stringify({ blanks: [{ blankKey: 'b1', answer: ' عمّان ' }] }),
          },
        },
      ],
    });
    expect(resFill.results[0].status).toBe('OK');

    const derivedResults = await prismaA.studentLessonResult.findMany({
      where: { studentId: studentA1User.id, lessonId: lessonA1.id },
    });
    expect(derivedResults).toHaveLength(1);
    expect(derivedResults[0].percent).toBe(100);
    expect(derivedResults[0].earnedPoints).toBe(10);

    // 4. Questionless accessible lesson -> auto 100% (Decision #5)
    const resNoQuiz = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: `chg-${crypto.randomUUID()}`,
          entityType: 'lesson_progress',
          entityUuid: 'prog-noquiz',
          operation: 'upsert',
          payload: { lessonUuid: lessonA_noQuiz.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(resNoQuiz.results[0].status).toBe('OK');
    const noQuizRes = await prismaA.studentLessonResult.findFirstOrThrow({
      where: { studentId: studentA1User.id, lessonId: lessonA_noQuiz.id },
    });
    expect(noQuizRes.percent).toBe(100);
    expect(noQuizRes.gradeLabel).toBe('تمت القراءة');
  });

  it('SEC-R3-03 (PostgreSQL 2 connections): concurrent identical clientChangeUuid processes once and blocks cross-student collision', async () => {
    const sharedChangeUuid = `race-${crypto.randomUUID()}`;
    const payload = {
      changes: [
        {
          clientChangeUuid: sharedChangeUuid,
          entityType: 'student_answer',
          entityUuid: qA1_mcq.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_mcq.uuid,
            answerValue: { selectedOptionUuid: qA1_mcq_rightOpt.uuid },
          },
        },
      ],
    };

    const [r1, r2] = await Promise.all([
      syncServiceA.push(schoolA.id, studentA1User.uuid, payload),
      syncServiceB.push(schoolA.id, studentA1User.uuid, payload),
    ]);

    const statuses = [r1.results[0].status, r2.results[0].status].sort();
    expect(statuses).toEqual(['ALREADY_PROCESSED', 'OK']);

    // Cross-student replay of another student's clientChangeUuid -> ERROR CLIENT_CHANGE_CONFLICT
    const crossRes = await syncServiceA.push(schoolB.id, studentBUser.uuid, {
      changes: [
        {
          clientChangeUuid: sharedChangeUuid,
          entityType: 'lesson_progress',
          entityUuid: 'prog-b',
          operation: 'upsert',
          payload: { lessonUuid: lessonB1.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(crossRes.results[0].status).toBe('ERROR');
    expect(crossRes.results[0].error).toBe('CLIENT_CHANGE_CONFLICT');
  });

  it('SEC-QUIZ-01, SEC-QUIZ-02, SEC-R3-01 & SEC-R3-02 (PostgreSQL 2 connections): server re-grading, duplicate rejection, concurrent submitQuiz & 5x concurrent markLessonRead', async () => {
    // 1. Forged isCorrect + empty FILL bypass blocked
    await expect(
      quizServiceA.submitQuiz(schoolA.id, studentA1User.uuid, lessonA1.uuid, {
        answers: [
          { questionUuid: qA1_mcq.uuid, answerValue: { selectedOptionUuid: qA1_mcq_rightOpt.uuid }, isCorrect: true },
          { questionUuid: qA1_mcq.uuid, answerValue: { selectedOptionUuid: qA1_mcq_rightOpt.uuid }, isCorrect: true },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    // 2. Concurrent submitQuiz on fresh attempt (lessonA_sec2? No, make dedicated student in secA1 or reset)
    const countBefore = await prismaA.studentLessonResult.count({
      where: { studentId: studentA1User.id, lessonId: lessonA1.id },
    });

    const quizPayloadWrongFill = {
      questionsRevision: 777, // forged client revision ignored
      answers: [
        {
          questionUuid: qA1_mcq.uuid,
          answerValue: { selectedOptionUuid: qA1_mcq_rightOpt.uuid },
          isCorrect: false,
        },
        {
          questionUuid: qA1_fill.uuid,
          answerValue: { blanks: [] }, // empty blanks -> must fail FILL
          isCorrect: true, // forged!
        },
      ],
    };

    const [sub1, sub2] = await Promise.all([
      quizServiceA.submitQuiz(schoolA.id, studentA1User.uuid, lessonA1.uuid, quizPayloadWrongFill),
      quizServiceB.submitQuiz(schoolA.id, studentA1User.uuid, lessonA1.uuid, quizPayloadWrongFill),
    ]);

    expect(sub1.earnedPoints).toBe(5); // Only 5/10, NOT 10/10
    expect(sub2.earnedPoints).toBe(5);
    expect(sub1.percent).toBe(50);
    expect(sub2.percent).toBe(50);

    const resultsAfter = await prismaA.studentLessonResult.findMany({
      where: { studentId: studentA1User.id, lessonId: lessonA1.id },
      orderBy: { version: 'asc' },
    });
    expect(resultsAfter).toHaveLength(countBefore + 2);
    const versions = resultsAfter.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length); // Strictly unique monotonic versions
    expect(resultsAfter.every((r) => r.questionsRevisionAtSubmit === 1)).toBe(true); // Server template revision, NOT 777

    // 3. Idempotent quiz retry with clientAttemptUuid across 2 concurrent connections -> ONLY 1 new row
    const attemptUuid = `attempt-${crypto.randomUUID()}`;
    const [idem1, idem2] = await Promise.all([
      quizServiceA.submitQuiz(schoolA.id, studentA1User.uuid, lessonA1.uuid, {
        ...quizPayloadWrongFill,
        clientAttemptUuid: attemptUuid,
      }),
      quizServiceB.submitQuiz(schoolA.id, studentA1User.uuid, lessonA1.uuid, {
        ...quizPayloadWrongFill,
        clientAttemptUuid: attemptUuid,
      }),
    ]);
    expect(idem1.resultUuid).toBe(idem2.resultUuid);
    const countAfterIdem = await prismaA.studentLessonResult.count({
      where: { studentId: studentA1User.id, lessonId: lessonA1.id },
    });
    expect(countAfterIdem).toBe(countBefore + 3);

    // 4. 5x concurrent markLessonRead on a fresh questionless lesson -> zero P2002, exactly 1 result!
    const freshTpl = await prismaA.lessonTemplate.create({
      data: { schoolId: schoolA.id, title: 'قراءة متزامنة', orderIndex: 99, status: 'READY' },
    });
    const freshNoQuiz = await prismaA.lesson.create({
      data: {
        templateId: freshTpl.id,
        schoolId: schoolA.id,
        teacherId: teacherAUser.id,
        subjectId: lessonA1.subjectId,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
      },
    });
    await prismaA.lessonTarget.create({
      data: { lessonId: freshNoQuiz.id, sectionId: secA1.id, publishedAt: new Date('2026-10-15T10:00:00Z') },
    });

    const markCalls = await Promise.all([
      quizServiceA.markLessonRead(schoolA.id, studentA1User.uuid, freshNoQuiz.uuid),
      quizServiceB.markLessonRead(schoolA.id, studentA1User.uuid, freshNoQuiz.uuid),
      quizServiceA.markLessonRead(schoolA.id, studentA1User.uuid, freshNoQuiz.uuid),
      quizServiceB.markLessonRead(schoolA.id, studentA1User.uuid, freshNoQuiz.uuid),
      quizServiceA.markLessonRead(schoolA.id, studentA1User.uuid, freshNoQuiz.uuid),
    ]);
    expect(markCalls.filter((m) => !m.alreadyCompleted)).toHaveLength(1);
    expect(markCalls.filter((m) => m.alreadyCompleted)).toHaveLength(4);
    expect(
      await prismaA.studentLessonResult.count({
        where: { studentId: studentA1User.id, lessonId: freshNoQuiz.id },
      }),
    ).toBe(1);

    // 5. checkAnswer must reject foreign School B or draft question UUID
    await expect(
      quizServiceA.checkAnswer(schoolA.id, studentA1User.uuid, lessonA1.uuid, qB1_mcq.uuid, {
        selectedOptionUuid: 'any',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('SEC-SUB-01 & SEC-R3-07: enforces subscription window on sync/push (allows offline pre-expiry, blocks unsub/post-expiry), parent review, and questionsRevision', async () => {
    // 1. Never-subscribed student blocked in sync/push
    const unsubPush = await syncServiceA.push(schoolA.id, studentA_unsubUser.uuid, {
      changes: [
        {
          clientChangeUuid: `unsub-${crypto.randomUUID()}`,
          entityType: 'lesson_progress',
          entityUuid: 'prog-u',
          operation: 'upsert',
          payload: { lessonUuid: lessonA1.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(unsubPush.results[0].status).toBe('ERROR');
    expect(unsubPush.results[0].error).toBe('SUBSCRIPTION_REQUIRED');

    // 2. Expired student syncing offline progress for pre-expiry published lesson -> ALLOWED (Decision #3)
    const expPrePush = await syncServiceA.push(schoolA.id, studentA_expiredUser.uuid, {
      changes: [
        {
          clientChangeUuid: `exp-pre-${crypto.randomUUID()}`,
          entityType: 'lesson_progress',
          entityUuid: 'prog-exp-pre',
          operation: 'upsert',
          payload: { lessonUuid: lessonA_noQuiz.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(expPrePush.results[0].status).toBe('OK');

    // 3. Expired student syncing post-expiry published lesson -> BLOCKED (SUBSCRIPTION_EXPIRED)
    const expPostPush = await syncServiceA.push(schoolA.id, studentA_expiredUser.uuid, {
      changes: [
        {
          clientChangeUuid: `exp-post-${crypto.randomUUID()}`,
          entityType: 'lesson_progress',
          entityUuid: 'prog-exp-post',
          operation: 'upsert',
          payload: { lessonUuid: lessonA_postExpiry.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(expPostPush.results[0].status).toBe('ERROR');
    expect(expPostPush.results[0].error).toBe('SUBSCRIPTION_EXPIRED');

    // 4. ParentChildrenService.getChildLessonReview:
    //    (a) expired child blocked by subscription check (SEC-SUB-01)
    await expect(
      parentChildrenService.getChildLessonReview(
        schoolA.id,
        parentAUser.uuid,
        studentA_expiredUser.uuid,
        lessonA_noQuiz.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    //    (b) active child accessing un-targeted lesson (even if a stale result exists) -> NotFoundException
    const staleResult = await prismaA.studentLessonResult.create({
      data: {
        studentId: studentA1User.id,
        lessonId: lessonA_sec2.id,
        totalQuestions: 1,
        correctQuestions: 1,
        totalPoints: 5,
        earnedPoints: 5,
        percent: 100,
        gradeLabel: 'ممتاز',
        calculatedAt: new Date(),
        version: 1,
      },
    });
    expect(staleResult).toBeDefined();
    await expect(
      parentChildrenService.getChildLessonReview(
        schoolA.id,
        parentAUser.uuid,
        studentA1User.uuid,
        lessonA_sec2.uuid,
      ),
    ).rejects.toThrow(NotFoundException);

    //    (c) questionsRevision mismatch -> both ParentChildrenService and ReportsService return reviewAvailable: false & questions: []
    const revBeforeParent = await parentChildrenService.getChildLessonReview(
      schoolA.id,
      parentAUser.uuid,
      studentA1User.uuid,
      lessonA1.uuid,
    );
    expect(revBeforeParent.reviewAvailable).toBe(true);
    expect(revBeforeParent.questions.length).toBeGreaterThan(0);

    // Teacher bumps questionsRevision on tplA1 (simulating question edit after attempt)
    await prismaA.lessonTemplate.update({
      where: { id: tplA1.id },
      data: { questionsRevision: 2 },
    });

    const revAfterParent = await parentChildrenService.getChildLessonReview(
      schoolA.id,
      parentAUser.uuid,
      studentA1User.uuid,
      lessonA1.uuid,
    );
    expect(revAfterParent.reviewAvailable).toBe(false);
    expect(revAfterParent.questions).toEqual([]);

    const revAfterReport = await reportsService.getStudentLessonReview(
      schoolA.id,
      studentA1User.uuid,
      lessonA1.uuid,
    );
    expect(revAfterReport.reviewAvailable).toBe(false);
    expect(revAfterReport.questions).toEqual([]);
  });

  it('T6 (B-1, B-2, B-3): post-result answer edits derive updated result version, cross-student/cross-lesson clientAttemptUuid fails cleanly (no P2002), and questionless submitQuiz is rejected', async () => {
    // 1. B-1: Fresh quiz lesson with 2 MCQ questions (5 pts each)
    const subjectA = await prismaA.subject.findFirstOrThrow({ where: { schoolId: schoolA.id } });
    const unitA = await prismaA.unit.findFirstOrThrow({ where: { schoolId: schoolA.id } });

    const postEditTpl = await prismaA.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA.id,
        unitId: unitA.id,
        title: 'درس تعديل بعد النتيجة',
        orderIndex: 20,
        status: 'READY',
        questionsRevision: 1,
      },
    });
    const lessonPostEdit = await prismaA.lesson.create({
      data: {
        templateId: postEditTpl.id,
        schoolId: schoolA.id,
        teacherId: teacherAUser.id,
        subjectId: subjectA.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-10-15T10:00:00Z'),
      },
    });
    await prismaA.lessonTarget.create({
      data: {
        lessonId: lessonPostEdit.id,
        sectionId: secA1.id,
        publishedAt: new Date('2026-10-15T10:00:00Z'),
      },
    });

    const peQ1 = await prismaA.question.create({
      data: { templateId: postEditTpl.id, type: 'MCQ', orderIndex: 1, questionText: 'س1', score: 5 },
    });
    const peQ1Right = await prismaA.questionOption.create({
      data: { questionId: peQ1.id, optionText: 'ص1', isCorrect: true, orderIndex: 1 },
    });
    const peQ1Wrong = await prismaA.questionOption.create({
      data: { questionId: peQ1.id, optionText: 'خ1', isCorrect: false, orderIndex: 2 },
    });
    const peQ2 = await prismaA.question.create({
      data: { templateId: postEditTpl.id, type: 'MCQ', orderIndex: 2, questionText: 'س2', score: 5 },
    });
    const peQ2Right = await prismaA.questionOption.create({
      data: { questionId: peQ2.id, optionText: 'ص2', isCorrect: true, orderIndex: 1 },
    });

    // Initial offline sync: Q1 WRONG + Q2 RIGHT + COMPLETED -> v1 = 50%
    const initialPush = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: `pe-q1-init-${crypto.randomUUID()}`,
          entityType: 'student_answer',
          entityUuid: peQ1.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonPostEdit.uuid,
            questionUuid: peQ1.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: peQ1Wrong.uuid }),
          },
        },
        {
          clientChangeUuid: `pe-q2-init-${crypto.randomUUID()}`,
          entityType: 'student_answer',
          entityUuid: peQ2.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonPostEdit.uuid,
            questionUuid: peQ2.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: peQ2Right.uuid }),
          },
        },
        {
          clientChangeUuid: `pe-prog-init-${crypto.randomUUID()}`,
          entityType: 'lesson_progress',
          entityUuid: 'prog-pe',
          operation: 'upsert',
          payload: { lessonUuid: lessonPostEdit.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(initialPush.results.every((r) => r.status === 'OK')).toBe(true);

    const v1 = await prismaA.studentLessonResult.findFirstOrThrow({
      where: { studentId: studentA1User.id, lessonId: lessonPostEdit.id },
      orderBy: [{ calculatedAt: 'desc' }, { version: 'desc' }],
    });
    expect(v1.version).toBe(1);
    expect(v1.percent).toBe(50);

    // Offline edit after v1 was already synced (enabled by OBS-W2-01): Q1 -> RIGHT with new clientChangeUuid
    const editPush = await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: `pe-q1-edit-${crypto.randomUUID()}`,
          entityType: 'student_answer',
          entityUuid: peQ1.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonPostEdit.uuid,
            questionUuid: peQ1.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: peQ1Right.uuid }),
          },
        },
      ],
    });
    expect(editPush.results[0].status).toBe('OK');

    const v2 = await prismaA.studentLessonResult.findFirstOrThrow({
      where: { studentId: studentA1User.id, lessonId: lessonPostEdit.id },
      orderBy: [{ calculatedAt: 'desc' }, { version: 'desc' }],
    });
    expect(v2.version).toBe(2);
    expect(v2.percent).toBe(100);
    expect(v2.earnedPoints).toBe(10);

    const relinkedAnswers = await prismaA.studentAnswer.findMany({
      where: { studentId: studentA1User.id, questionId: { in: [peQ1.id, peQ2.id] } },
    });
    expect(relinkedAnswers.every((a) => a.resultId === v2.id)).toBe(true);

    // Same score re-push must NOT create a noisy v3 row
    await syncServiceA.push(schoolA.id, studentA1User.uuid, {
      changes: [
        {
          clientChangeUuid: `pe-q1-noop-${crypto.randomUUID()}`,
          entityType: 'student_answer',
          entityUuid: peQ1.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonPostEdit.uuid,
            questionUuid: peQ1.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: peQ1Right.uuid }),
          },
        },
      ],
    });
    expect(
      await prismaA.studentLessonResult.count({
        where: { studentId: studentA1User.id, lessonId: lessonPostEdit.id },
      }),
    ).toBe(2);

    // 2. B-2: Cross-student concurrent race with identical clientAttemptUuid + sequential cross-lesson reuse
    const sharedAttemptUuid = `shared-attempt-${crypto.randomUUID()}`;
    const settled = await Promise.allSettled([
      quizServiceA.submitQuiz(schoolA.id, studentA1User.uuid, lessonPostEdit.uuid, {
        clientAttemptUuid: sharedAttemptUuid,
        answers: [{ questionUuid: peQ1.uuid, answerValue: { selectedOptionUuid: peQ1Right.uuid } }],
      }),
      quizServiceB.submitQuiz(schoolB.id, studentBUser.uuid, lessonB1.uuid, {
        clientAttemptUuid: sharedAttemptUuid,
        answers: [{ questionUuid: qB1_mcq.uuid, answerValue: { selectedOptionUuid: 'any' } }],
      }),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.message).toBe('CLIENT_ATTEMPT_CONFLICT');

    // Sequential reuse on another lesson of the SAME student who owns sharedAttemptUuid -> ConflictException (NOT P2002!)
    const ownerIsA1 = settled[0].status === 'fulfilled';
    if (ownerIsA1) {
      await expect(
        quizServiceA.submitQuiz(schoolA.id, studentA1User.uuid, lessonA1.uuid, {
          clientAttemptUuid: sharedAttemptUuid,
          answers: [{ questionUuid: qA1_mcq.uuid, answerValue: { selectedOptionUuid: qA1_mcq_rightOpt.uuid } }],
        }),
      ).rejects.toThrow(ConflictException);
    }

    // 3. B-3: submitQuiz on questionless lesson must fail with LESSON_HAS_NO_QUESTIONS and leave markLessonRead clean
    const noQTpl = await prismaA.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA.id,
        unitId: unitA.id,
        title: 'درس قرائي رفض submitQuiz',
        orderIndex: 21,
        status: 'READY',
      },
    });
    const lessonNoQGuard = await prismaA.lesson.create({
      data: {
        templateId: noQTpl.id,
        schoolId: schoolA.id,
        teacherId: teacherAUser.id,
        subjectId: subjectA.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-10-15T10:00:00Z'),
      },
    });
    await prismaA.lessonTarget.create({
      data: {
        lessonId: lessonNoQGuard.id,
        sectionId: secA1.id,
        publishedAt: new Date('2026-10-15T10:00:00Z'),
      },
    });

    await expect(
      quizServiceA.submitQuiz(schoolA.id, studentA1User.uuid, lessonNoQGuard.uuid, {
        answers: [],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(
      await prismaA.studentLessonResult.count({
        where: { studentId: studentA1User.id, lessonId: lessonNoQGuard.id },
      }),
    ).toBe(0);

    const readRes = await quizServiceA.markLessonRead(
      schoolA.id,
      studentA1User.uuid,
      lessonNoQGuard.uuid,
    );
    expect(readRes.alreadyCompleted).toBe(false);
    const readRow = await prismaA.studentLessonResult.findFirstOrThrow({
      where: { studentId: studentA1User.id, lessonId: lessonNoQGuard.id },
    });
    expect(readRow.percent).toBe(100);
    expect(readRow.gradeLabel).toBe('تمت القراءة');
  });

  it('T7 (B-4, Mixed-Batch Expired Sync, NB-1): deterministic shared-template subscription enforcement, mixed offline batch preservation, and DROPPED child review block', async () => {
    const subjectA = await prismaA.subject.findFirstOrThrow({ where: { schoolId: schoolA.id } });
    const unitA = await prismaA.unit.findFirstOrThrow({ where: { schoolId: schoolA.id } });
    const gradeA = await prismaA.schoolGrade.findFirstOrThrow({ where: { schoolId: schoolA.id } });

    // 1. B-4: Shared template across older pre-expiry lesson (Oct 15) and newer post-expiry lesson (Nov 15)
    const sharedTpl = await prismaA.lessonTemplate.create({
      data: {
        schoolId: schoolA.id,
        subjectId: subjectA.id,
        unitId: unitA.id,
        title: 'قالب مشترك زمنياً',
        orderIndex: 30,
        status: 'READY',
      },
    });
    const qShared = await prismaA.question.create({
      data: { templateId: sharedTpl.id, type: 'MCQ', orderIndex: 1, questionText: 'س مشترك', score: 5 },
    });
    const qSharedRight = await prismaA.questionOption.create({
      data: { questionId: qShared.id, optionText: 'صح', isCorrect: true, orderIndex: 1 },
    });

    const lessonSharedOld = await prismaA.lesson.create({
      data: {
        templateId: sharedTpl.id,
        schoolId: schoolA.id,
        teacherId: teacherAUser.id,
        subjectId: subjectA.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-10-15T10:00:00Z'),
      },
    });
    await prismaA.lessonTarget.create({
      data: {
        lessonId: lessonSharedOld.id,
        sectionId: secA1.id,
        publishedAt: new Date('2026-10-15T10:00:00Z'),
      },
    });

    const lessonSharedNew = await prismaA.lesson.create({
      data: {
        templateId: sharedTpl.id,
        schoolId: schoolA.id,
        teacherId: teacherAUser.id,
        subjectId: subjectA.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-11-15T10:00:00Z'),
      },
    });
    await prismaA.lessonTarget.create({
      data: {
        lessonId: lessonSharedNew.id,
        sectionId: secA1.id,
        publishedAt: new Date('2026-11-15T10:00:00Z'),
      },
    });

    // Omitted lessonUuid resolves deterministically to newest published (lessonSharedNew) -> SUBSCRIPTION_EXPIRED
    // Empty-string lessonUuid fails strictly with QUESTION_NOT_ACCESSIBLE (no silent fallback)
    const chgOmit = `b4-omit-${crypto.randomUUID()}`;
    const chgEmpty = `b4-empty-${crypto.randomUUID()}`;
    const b4Push = await syncServiceA.push(schoolA.id, studentA_expiredUser.uuid, {
      changes: [
        {
          clientChangeUuid: chgOmit,
          entityType: 'student_answer',
          entityUuid: qShared.uuid,
          operation: 'upsert',
          payload: {
            questionUuid: qShared.uuid,
            answerValue: { selectedOptionUuid: qSharedRight.uuid },
          },
        },
        {
          clientChangeUuid: chgEmpty,
          entityType: 'student_answer',
          entityUuid: qShared.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: '',
            questionUuid: qShared.uuid,
            answerValue: { selectedOptionUuid: qSharedRight.uuid },
          },
        },
      ],
    });
    expect(b4Push.results[0]).toEqual({
      clientChangeUuid: chgOmit,
      status: 'ERROR',
      error: 'SUBSCRIPTION_EXPIRED',
    });
    expect(b4Push.results[1]).toEqual({
      clientChangeUuid: chgEmpty,
      status: 'ERROR',
      error: 'QUESTION_NOT_ACCESSIBLE',
    });

    // Explicit pre-expiry lessonUuid on the shared template -> ALLOWED
    const explicitOldPush = await syncServiceA.push(schoolA.id, studentA_expiredUser.uuid, {
      changes: [
        {
          clientChangeUuid: `b4-old-${crypto.randomUUID()}`,
          entityType: 'student_answer',
          entityUuid: qShared.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonSharedOld.uuid,
            questionUuid: qShared.uuid,
            answerValue: { selectedOptionUuid: qSharedRight.uuid },
          },
        },
      ],
    });
    expect(explicitOldPush.results[0].status).toBe('OK');

    // 2. Mixed-batch expired subscription: pre-expiry quiz answers + COMPLETED accepted alongside rejected post-expiry item
    const preExpMcq = `mix-mcq-${crypto.randomUUID()}`;
    const preExpFill = `mix-fill-${crypto.randomUUID()}`;
    const preExpProg = `mix-prog-${crypto.randomUUID()}`;
    const postExpProg = `mix-post-${crypto.randomUUID()}`;

    const mixedRes = await syncServiceA.push(schoolA.id, studentA_expiredUser.uuid, {
      changes: [
        {
          clientChangeUuid: preExpMcq,
          entityType: 'student_answer',
          entityUuid: qA1_mcq.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_mcq.uuid,
            answerValue: JSON.stringify({ selectedOptionUuid: qA1_mcq_rightOpt.uuid }),
          },
        },
        {
          clientChangeUuid: preExpFill,
          entityType: 'student_answer',
          entityUuid: qA1_fill.uuid,
          operation: 'upsert',
          payload: {
            lessonUuid: lessonA1.uuid,
            questionUuid: qA1_fill.uuid,
            answerValue: JSON.stringify({ blanks: [{ blankKey: 'b1', answer: 'عمّان' }] }),
          },
        },
        {
          clientChangeUuid: preExpProg,
          entityType: 'lesson_progress',
          entityUuid: 'prog-mix-pre',
          operation: 'upsert',
          payload: { lessonUuid: lessonA1.uuid, status: 'COMPLETED' },
        },
        {
          clientChangeUuid: postExpProg,
          entityType: 'lesson_progress',
          entityUuid: 'prog-mix-post',
          operation: 'upsert',
          payload: { lessonUuid: lessonA_postExpiry.uuid, status: 'COMPLETED' },
        },
      ],
    });
    expect(mixedRes.results[0].status).toBe('OK');
    expect(mixedRes.results[1].status).toBe('OK');
    expect(mixedRes.results[2].status).toBe('OK');
    expect(mixedRes.results[3]).toEqual({
      clientChangeUuid: postExpProg,
      status: 'ERROR',
      error: 'SUBSCRIPTION_EXPIRED',
    });

    const expA1Result = await prismaA.studentLessonResult.findFirstOrThrow({
      where: { studentId: studentA_expiredUser.id, lessonId: lessonA1.id },
    });
    expect(expA1Result.percent).toBe(100);
    expect(
      await prismaA.studentLessonProgress.count({
        where: { studentId: studentA_expiredUser.id, lessonId: lessonA_postExpiry.id },
      }),
    ).toBe(0);

    // 3. NB-1: ParentChildrenService.getChildLessonReview rejects child with non-ACTIVE (DROPPED) enrollment
    const droppedUser = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: 2302099,
        name: 'طالب منسحب',
        passwordHash: await bcrypt.hash('Wave2Pass#1', 10),
        isActive: true,
      },
    });
    await prismaA.student.create({ data: { userId: droppedUser.id } });
    await prismaA.studentEnrollment.create({
      data: {
        studentId: droppedUser.id,
        yearId: yearA.id,
        gradeId: gradeA.id,
        sectionId: secA1.id,
        isCurrent: true,
        status: EnrollmentStatus.DROPPED,
      },
    });
    await prismaA.studentAccessPeriod.create({
      data: {
        schoolId: schoolA.id,
        studentUserId: droppedUser.id,
        periodType: AccessPeriodType.TRIAL,
        startedAt: new Date('2026-09-01T00:00:00Z'),
        expiresAt: new Date('2027-06-01T00:00:00Z'),
      },
    });
    await prismaA.parentStudent.create({
      data: { parentId: parentAUser.id, studentId: droppedUser.id },
    });
    await prismaA.studentLessonResult.create({
      data: {
        studentId: droppedUser.id,
        lessonId: lessonA1.id,
        totalQuestions: 2,
        correctQuestions: 2,
        totalPoints: 10,
        earnedPoints: 10,
        percent: 100,
        gradeLabel: 'ممتاز',
        calculatedAt: new Date(),
        version: 1,
        questionsRevisionAtSubmit: 1,
      },
    });

    await expect(
      parentChildrenService.getChildLessonReview(
        schoolA.id,
        parentAUser.uuid,
        droppedUser.uuid,
        lessonA1.uuid,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
