/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppType, OtpChannel, OtpPurpose, OtpStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { UserCodeGeneratorService } from '../../src/common/user-code/user-code-generator.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InMemoryRateLimitStorage } from '../../src/public/student-registration/in-memory-rate-limit.storage';
import { PhoneRateLimiterService } from '../../src/public/student-registration/phone-rate-limiter.service';
import { RegistrationDataService } from '../../src/public/student-registration/registration-data.service';
import {
  REGISTRATION_CONFIG,
  REGISTRATION_ERRORS,
} from '../../src/public/student-registration/registration.constants';
import { StudentRegistrationService } from '../../src/public/student-registration/student-registration.service';
import { SCHOOL_AUTH_JWT } from '../../src/school/auth/constants';
import { ParentStudentContextGuard } from '../../src/school/common/guards/parent-student-context.guard';
import {
  SUB_ERROR,
  SubscriptionGuard,
} from '../../src/school/common/guards/subscription.guard';
import { SubscriptionTrialService } from '../../src/school/common/subscription/subscription-trial.service';
import { SessionsService } from '../../src/school/sessions/sessions.service';
import { TeacherUnitsService } from '../../src/school/teacher/units/teacher-units.service';
import { OTP_DEFAULTS } from '../../src/shared/otp/otp.constants';

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
  if (!/^asas_qw_batch2_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

function makeHttpContext(req: any) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any;
}

function normalizeTestPhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('0')) cleaned = '+967' + cleaned.substring(1);
  if (cleaned.startsWith('967') && !cleaned.startsWith('+')) cleaned = '+' + cleaned;
  if (!cleaned.startsWith('+')) cleaned = '+967' + cleaned;
  return cleaned;
}

function buildRegistrationService(prisma: PrismaService): StudentRegistrationService {
  const rateStorage = new InMemoryRateLimitStorage();
  const phoneRateLimiter = new PhoneRateLimiterService(rateStorage);
  const jwtService = new JwtService({
    secret: 'qw-batch2-test-jwt-secret-key-32-chars',
    signOptions: {
      issuer: SCHOOL_AUTH_JWT.issuer,
      audience: SCHOOL_AUTH_JWT.audience,
    },
  });
  return new StudentRegistrationService(
    prisma,
    { normalizePhone: normalizeTestPhone } as any,
    new SessionsService(prisma),
    jwtService,
    phoneRateLimiter,
    new SubscriptionTrialService(),
    new UserCodeGeneratorService(),
  );
}

describe('Quick Wins Batch 2 — Real 2-Connection PostgreSQL Integration Suite', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prismaA: PrismaService;
  let prismaB: PrismaService;

  let regServiceA: StudentRegistrationService;
  let regServiceB: StudentRegistrationService;
  let regDataServiceA: RegistrationDataService;
  let parentContextGuard: ParentStudentContextGuard;
  let subscriptionGuard: SubscriptionGuard;
  let teacherUnitsService: TeacherUnitsService;

  let mafhoomSchool: any;
  let grade1: any;
  let sectionA: any;
  let province: any;
  let district: any;
  let year1: any;
  let term1: any;

  let teacherUser: any;
  let subject1: any;
  let parentUser: any;
  let studentUser: any;

  const originalOtpEnv = process.env.STUDENT_REGISTRATION_OTP_ENABLED;

  beforeAll(async () => {
    tempDbName = `asas_qw_batch2_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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
    await prismaA.onModuleInit();
    await prismaB.onModuleInit();

    const rows: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(`Wrong DB connected: ${rows[0]?.db}`);
    }

    regServiceA = buildRegistrationService(prismaA);
    regServiceB = buildRegistrationService(prismaB);
    regDataServiceA = new RegistrationDataService(prismaA);
    parentContextGuard = new ParentStudentContextGuard(prismaA);
    subscriptionGuard = new SubscriptionGuard(prismaA);
    teacherUnitsService = new TeacherUnitsService(prismaA);

    const passHash = await bcrypt.hash('Batch2Pass#1', 10);

    // 1. Seed Mafhoom school with REGISTRATION_CONFIG.mafhoomSchoolCode
    mafhoomSchool = await prismaA.school.create({
      data: {
        name: 'Mafhoom Public School',
        displayName: 'مدرسة مفهوم الاختبارية',
        schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    await prismaA.schoolSubscriptionSettings.create({
      data: {
        schoolId: mafhoomSchool.id,
        isActivated: true,
        activatedAt: new Date('2026-09-01T00:00:00Z'),
        isTrialEnabled: true,
        trialDurationDays: 7,
        subscriptionPrice: 100,
        contactNumber: '+967770000001',
      },
    });

    year1 = await prismaA.year.create({
      data: {
        schoolId: mafhoomSchool.id,
        name: '2026-2027',
        isCurrent: true,
      },
    });
    term1 = await prismaA.term.create({
      data: {
        yearId: year1.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        isCurrent: true,
      },
    });
    grade1 = await prismaA.schoolGrade.create({
      data: {
        schoolId: mafhoomSchool.id,
        displayName: 'الأول الثانوي',
        sortOrder: 1,
        isActive: true,
      },
    });
    sectionA = await prismaA.section.create({
      data: {
        gradeId: grade1.id,
        name: 'أ',
        orderIndex: 1,
        isActive: true,
      },
    });

    province = await prismaA.province.create({
      data: { name: 'صنعاء الاختبارية', sortOrder: 1 },
    });
    district = await prismaA.district.create({
      data: { provinceId: province.id, name: 'السبعين', sortOrder: 1 },
    });
    await prismaA.mafhoomDistrictRouting.create({
      data: {
        districtId: district.id,
        targetSection: 'أ',
        isActive: true,
      },
    });

    // 2. Seed Teacher, Subject, SubjectSectionTeacher for SEC-TCH-04
    const userCodeGen = new UserCodeGeneratorService();
    const [teacherCode, parentCode, studentCode] = await prismaA.$transaction((tx) =>
      userCodeGen.allocateCodes(3, tx),
    );

    teacherUser = await prismaA.user.create({
      data: {
        schoolId: mafhoomSchool.id,
        userType: UserType.TEACHER,
        code: teacherCode,
        name: 'معلم الاختبار',
        passwordHash: passHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({ data: { userId: teacherUser.id } });

    subject1 = await prismaA.subject.create({
      data: {
        schoolId: mafhoomSchool.id,
        gradeId: grade1.id,
        displayName: 'الرياضيات',
        isActive: true,
      },
    });
    const subjectSection = await prismaA.subjectSection.create({
      data: {
        subjectId: subject1.id,
        sectionId: sectionA.id,
        isActive: true,
      },
    });
    await prismaA.subjectSectionTeacher.create({
      data: {
        subjectSectionId: subjectSection.id,
        teacherId: teacherUser.id,
        isActive: true,
      },
    });

    // 3. Seed Parent + Student + ParentStudent + active Trial for SEC-AUTH-04 & SEC-LOW-01
    parentUser = await prismaA.user.create({
      data: {
        schoolId: mafhoomSchool.id,
        userType: UserType.PARENT,
        code: parentCode,
        name: 'ولي أمر الاختبار',
        passwordHash: passHash,
        isActive: true,
      },
    });
    await prismaA.parent.create({ data: { userId: parentUser.id } });

    studentUser = await prismaA.user.create({
      data: {
        schoolId: mafhoomSchool.id,
        userType: UserType.STUDENT,
        code: studentCode,
        name: 'طالب الاختبار',
        passwordHash: passHash,
        isActive: true,
      },
    });
    await prismaA.student.create({ data: { userId: studentUser.id } });
    await prismaA.parentStudent.create({
      data: {
        parentId: parentUser.id,
        studentId: studentUser.id,
      },
    });
    await prismaA.studentAccessPeriod.create({
      data: {
        schoolId: mafhoomSchool.id,
        studentUserId: studentUser.id,
        periodType: 'TRIAL',
        startedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });
  });

  afterEach(() => {
    if (originalOtpEnv === undefined) {
      delete process.env.STUDENT_REGISTRATION_OTP_ENABLED;
    } else {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = originalOtpEnv;
    }
  });

  afterAll(async () => {
    try {
      if (prismaA) await prismaA.onModuleDestroy();
      if (prismaB) await prismaB.onModuleDestroy();
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

  it('SEC-OTP-02: two independent PostgreSQL connections racing on the same registrationToken allow only 1 registration and preserve rollback on invalid input', async () => {
    const racePhone = '+967771112233';
    const rawToken = `reg-tok-race-${crypto.randomBytes(12).toString('hex')}`;
    const tokenHash = crypto
      .createHmac('sha256', OTP_DEFAULTS.pepper)
      .update(rawToken)
      .digest('hex');

    const seededOtp = await prismaA.otpVerification.create({
      data: {
        phone: racePhone,
        codeHash: 'dummy-code-hash',
        purpose: OtpPurpose.STUDENT_REGISTRATION,
        channel: OtpChannel.WHATSAPP,
        registrationRequestId: `req-race-${crypto.randomUUID()}`,
        registrationTokenHash: tokenHash,
        registrationTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
        status: OtpStatus.VERIFIED,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        verifiedAt: new Date(),
      },
    });

    // Fire concurrently on two separate connections with different student names so duplicateStudent does NOT mask token reuse
    const [resA, resB] = await Promise.allSettled([
      regServiceA.completeRegistration({
        registrationToken: rawToken,
        name: 'طالب التزامن الأول',
        gender: 'MALE',
        provinceId: province.id,
        districtId: district.id,
        gradeId: grade1.id,
        password: 'StrongPassword1!',
      }),
      regServiceB.completeRegistration({
        registrationToken: rawToken,
        name: 'طالب التزامن الثاني',
        gender: 'MALE',
        provinceId: province.id,
        districtId: district.id,
        gradeId: grade1.id,
        password: 'StrongPassword1!',
      }),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
    expect((rejected[0].reason as BadRequestException).message).toBe(
      REGISTRATION_ERRORS.TOKEN_INVALID,
    );

    const createdUsers = await prismaA.user.findMany({
      where: { schoolId: mafhoomSchool.id, phone: racePhone, isDeleted: false },
    });
    expect(createdUsers).toHaveLength(1);

    const enrollments = await prismaA.studentEnrollment.findMany({
      where: { studentId: createdUsers[0].id },
    });
    expect(enrollments).toHaveLength(1);

    const periods = await prismaA.studentAccessPeriod.findMany({
      where: { schoolId: mafhoomSchool.id, studentUserId: createdUsers[0].id },
    });
    expect(periods).toHaveLength(1);

    const otpAfterRace = await prismaB.otpVerification.findUnique({
      where: { id: seededOtp.id },
    });
    expect(otpAfterRace?.status).toBe(OtpStatus.CONSUMED);
    expect(otpAfterRace?.consumedAt).not.toBeNull();

    // Rollback check: failing grade check must roll back OTP consumption so legitimate retry succeeds
    const retryPhone = '+967771112244';
    const retryToken = `reg-tok-retry-${crypto.randomBytes(12).toString('hex')}`;
    const retryHash = crypto
      .createHmac('sha256', OTP_DEFAULTS.pepper)
      .update(retryToken)
      .digest('hex');

    const otpForRollback = await prismaA.otpVerification.create({
      data: {
        phone: retryPhone,
        codeHash: 'dummy-code-hash-2',
        purpose: OtpPurpose.STUDENT_REGISTRATION,
        channel: OtpChannel.WHATSAPP,
        registrationRequestId: `req-retry-${crypto.randomUUID()}`,
        registrationTokenHash: retryHash,
        registrationTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
        status: OtpStatus.VERIFIED,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        verifiedAt: new Date(),
      },
    });

    await expect(
      regServiceA.completeRegistration({
        registrationToken: retryToken,
        name: 'طالب استرجاع المعاملة',
        gender: 'MALE',
        provinceId: province.id,
        districtId: district.id,
        gradeId: 999999,
        password: 'StrongPassword1!',
      }),
    ).rejects.toThrow(new NotFoundException(REGISTRATION_ERRORS.GRADE_NOT_FOUND));

    const otpAfterRollback = await prismaB.otpVerification.findUnique({
      where: { id: otpForRollback.id },
    });
    expect(otpAfterRollback?.status).toBe(OtpStatus.VERIFIED);
    expect(otpAfterRollback?.consumedAt).toBeNull();

    const retryResult = await regServiceA.completeRegistration({
      registrationToken: retryToken,
      name: 'طالب استرجاع المعاملة',
      gender: 'MALE',
      provinceId: province.id,
      districtId: district.id,
      gradeId: grade1.id,
      password: 'StrongPassword1!',
    });
    expect(retryResult.registered).toBe(true);
  });

  it('SEC-R3-08: blocks self-registration and grades lookup when Mafhoom school is deactivated before or mid-registration (TOCTOU)', async () => {
    const blockedPhone = '+967771113300';
    const tokPre = `reg-tok-disabled-${crypto.randomBytes(12).toString('hex')}`;
    const hashPre = crypto
      .createHmac('sha256', OTP_DEFAULTS.pepper)
      .update(tokPre)
      .digest('hex');

    await prismaA.otpVerification.create({
      data: {
        phone: blockedPhone,
        codeHash: 'dummy',
        purpose: OtpPurpose.STUDENT_REGISTRATION,
        channel: OtpChannel.WHATSAPP,
        registrationRequestId: `req-dis-${crypto.randomUUID()}`,
        registrationTokenHash: hashPre,
        registrationTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
        status: OtpStatus.VERIFIED,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        verifiedAt: new Date(),
      },
    });

    await prismaB.school.update({
      where: { id: mafhoomSchool.id },
      data: { isActive: false },
    });

    try {
      await expect(regDataServiceA.getRegistrationGrades()).rejects.toThrow(
        new NotFoundException(REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND),
      );

      await expect(
        regServiceA.checkPhoneRegistration({ phone: blockedPhone }),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );

      await expect(
        regServiceA.completeRegistration({
          registrationToken: tokPre,
          name: 'طالب مدرسة متوقفة',
          gender: 'MALE',
          provinceId: province.id,
          districtId: district.id,
          gradeId: grade1.id,
          password: 'StrongPassword1!',
        }),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );

      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
      await expect(
        regServiceA.completeRegistrationWithoutOtp({
          phone: blockedPhone,
          name: 'طالب مباشر متوقفة',
          gender: 'MALE',
          provinceId: province.id,
          districtId: district.id,
          gradeId: grade1.id,
          password: 'StrongPassword1!',
        } as any),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );

      // Re-enable school and simulate real mid-registration TOCTOU between resolvePreconditions and executeRegistrationTransaction
      await prismaB.school.update({
        where: { id: mafhoomSchool.id },
        data: { isActive: true },
      });

      const tokToctou = `reg-tok-toctou-${crypto.randomBytes(12).toString('hex')}`;
      const hashToctou = crypto
        .createHmac('sha256', OTP_DEFAULTS.pepper)
        .update(tokToctou)
        .digest('hex');

      const otpToctou = await prismaA.otpVerification.create({
        data: {
          phone: blockedPhone,
          codeHash: 'dummy-toctou',
          purpose: OtpPurpose.STUDENT_REGISTRATION,
          channel: OtpChannel.WHATSAPP,
          registrationRequestId: `req-toctou-${crypto.randomUUID()}`,
          registrationTokenHash: hashToctou,
          registrationTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
          status: OtpStatus.VERIFIED,
          expiresAt: new Date(Date.now() + 5 * 60_000),
          verifiedAt: new Date(),
        },
      });

      const preconditions = await (regServiceA as any).resolvePreconditions({
        provinceId: province.id,
        districtId: district.id,
      });

      // Another admin connection deactivates Mafhoom school before tx begins
      await prismaB.school.update({
        where: { id: mafhoomSchool.id },
        data: { isActive: false },
      });

      await expect(
        (regServiceA as any).executeRegistrationTransaction(
          {
            phone: blockedPhone,
            name: 'طالب سباق تعطيل',
            gender: 'MALE',
            provinceId: province.id,
            districtId: district.id,
            gradeId: grade1.id,
            password: 'StrongPassword1!',
          },
          preconditions,
          await bcrypt.hash('StrongPassword1!', 10),
          otpToctou.id,
        ),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );

      const otpAfterAbort = await prismaB.otpVerification.findUnique({
        where: { id: otpToctou.id },
      });
      expect(otpAfterAbort?.status).toBe(OtpStatus.VERIFIED);

      const created = await prismaA.user.count({
        where: { schoolId: mafhoomSchool.id, phone: blockedPhone },
      });
      expect(created).toBe(0);
    } finally {
      await prismaB.school.update({
        where: { id: mafhoomSchool.id },
        data: { isActive: true },
      });
    }
  });

  it('SEC-AUTH-04 & SEC-LOW-01: enforces student/parent isActive and Fail-Closed in PostgreSQL', async () => {
    // Active linked parent & student pass both guards
    const okReq: any = {
      headers: { 'x-student-context': studentUser.uuid },
      user: { sub: parentUser.uuid, ut: 'PARENT' },
      schoolContext: { id: mafhoomSchool.id },
    };
    await expect(
      parentContextGuard.canActivate(makeHttpContext(okReq)),
    ).resolves.toBe(true);
    await expect(
      subscriptionGuard.canActivate(makeHttpContext(okReq)),
    ).resolves.toBe(true);

    // Suspended student blocked by both ParentStudentContextGuard and SubscriptionGuard
    await prismaB.user.update({
      where: { id: studentUser.id },
      data: { isActive: false },
    });

    try {
      await expect(
        parentContextGuard.canActivate(
          makeHttpContext({
            headers: { 'x-student-context': studentUser.uuid },
            user: { sub: parentUser.uuid, ut: 'PARENT' },
            schoolContext: { id: mafhoomSchool.id },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        subscriptionGuard.canActivate(
          makeHttpContext({
            user: { sub: studentUser.uuid, ut: 'STUDENT' },
            schoolContext: { id: mafhoomSchool.id },
          }),
        ),
      ).rejects.toThrow(
        new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED),
      );
    } finally {
      await prismaB.user.update({
        where: { id: studentUser.id },
        data: { isActive: true },
      });
    }

    // Suspended parent blocked by ParentStudentContextGuard
    await prismaB.user.update({
      where: { id: parentUser.id },
      data: { isActive: false },
    });
    try {
      await expect(
        parentContextGuard.canActivate(
          makeHttpContext({
            headers: { 'x-student-context': studentUser.uuid },
            user: { sub: parentUser.uuid, ut: 'PARENT' },
            schoolContext: { id: mafhoomSchool.id },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    } finally {
      await prismaB.user.update({
        where: { id: parentUser.id },
        data: { isActive: true },
      });
    }

    // SEC-LOW-01 Fail-Closed on missing context vs non-student roles
    await expect(
      subscriptionGuard.canActivate(
        makeHttpContext({
          user: { sub: studentUser.uuid, ut: 'STUDENT' },
        }),
      ),
    ).rejects.toThrow(new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED));

    await expect(
      subscriptionGuard.canActivate(
        makeHttpContext({
          user: { sub: teacherUser.uuid, ut: 'TEACHER' },
          schoolContext: { id: mafhoomSchool.id },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('SEC-TCH-04: rejects deleting unit with active lessonTemplate or active lesson, and allows deleting empty unit in PostgreSQL', async () => {
    const emptyUnit = await prismaA.unit.create({
      data: {
        subjectId: subject1.id,
        schoolId: mafhoomSchool.id,
        ownerType: 'SCHOOL',
        title: 'وحدة فارغة',
        orderIndex: 1,
      },
    });

    const unitWithTemplate = await prismaA.unit.create({
      data: {
        subjectId: subject1.id,
        schoolId: mafhoomSchool.id,
        ownerType: 'SCHOOL',
        title: 'وحدة تحتوي قالب درس',
        orderIndex: 2,
      },
    });
    await prismaA.lessonTemplate.create({
      data: {
        schoolId: mafhoomSchool.id,
        subjectId: subject1.id,
        unitId: unitWithTemplate.id,
        orderIndex: 1,
        title: 'درس نشط',
      },
    });

    const unitWithActiveLesson = await prismaA.unit.create({
      data: {
        subjectId: subject1.id,
        schoolId: mafhoomSchool.id,
        ownerType: 'SCHOOL',
        title: 'وحدة بقالب محذوف ودرس حي',
        orderIndex: 3,
      },
    });
    const deletedTemplate = await prismaA.lessonTemplate.create({
      data: {
        schoolId: mafhoomSchool.id,
        subjectId: subject1.id,
        unitId: unitWithActiveLesson.id,
        orderIndex: 1,
        title: 'قالب محذوف منطقياً',
        isDeleted: true,
        deletedAt: new Date(),
      },
    });
    await prismaA.lesson.create({
      data: {
        templateId: deletedTemplate.id,
        schoolId: mafhoomSchool.id,
        teacherId: teacherUser.id,
        subjectId: subject1.id,
        yearId: year1.id,
        termId: term1.id,
        status: 'PUBLISHED',
      },
    });

    // Reject unit with active LessonTemplate
    await expect(
      teacherUnitsService.deleteUnit(
        mafhoomSchool.id,
        teacherUser.uuid,
        subject1.uuid,
        unitWithTemplate.uuid,
      ),
    ).rejects.toThrow(
      new ConflictException('لا يمكن حذف وحدة تحتوي على دروس.'),
    );
    const unitWithTemplateRow = await prismaB.unit.findUnique({
      where: { id: unitWithTemplate.id },
    });
    expect(unitWithTemplateRow?.isDeleted).toBe(false);

    // Reject unit with soft-deleted template but non-deleted published Lesson
    await expect(
      teacherUnitsService.deleteUnit(
        mafhoomSchool.id,
        teacherUser.uuid,
        subject1.uuid,
        unitWithActiveLesson.uuid,
      ),
    ).rejects.toThrow(
      new ConflictException('لا يمكن حذف وحدة تحتوي على دروس.'),
    );
    const unitWithActiveLessonRow = await prismaB.unit.findUnique({
      where: { id: unitWithActiveLesson.id },
    });
    expect(unitWithActiveLessonRow?.isDeleted).toBe(false);

    // Allow empty unit deletion
    const delRes = await teacherUnitsService.deleteUnit(
      mafhoomSchool.id,
      teacherUser.uuid,
      subject1.uuid,
      emptyUnit.uuid,
    );
    expect(delRes).toEqual({ message: 'تم حذف الوحدة بنجاح' });
    const emptyUnitRow = await prismaB.unit.findUnique({
      where: { id: emptyUnit.id },
    });
    expect(emptyUnitRow?.isDeleted).toBe(true);
    expect(emptyUnitRow?.deletedAt).not.toBeNull();
  });
});
