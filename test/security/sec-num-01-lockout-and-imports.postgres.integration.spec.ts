/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppType, GradeStage, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { UserCodeGeneratorService } from '../../src/common/user-code/user-code-generator.service';
import { ImportsService } from '../../src/owner/imports/imports.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SCHOOL_AUTH_ERRORS, SCHOOL_AUTH_JWT } from '../../src/school/auth/constants';
import {
  LoginLockoutException,
  LoginLockoutService,
} from '../../src/school/auth/login-lockout.service';
import { SchoolAuthService } from '../../src/school/auth/school-auth.service';
import { SessionsService } from '../../src/school/sessions/sessions.service';
import { SubscriptionTrialService } from '../../src/school/common/subscription/subscription-trial.service';

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
  if (!/^asas_sec_num_01_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-NUM-01 — Real PostgreSQL 2-Connection Integration (Lockout, DoS, Decay, Rotation, Cleanup & Imports)', () => {
  jest.setTimeout(120_000);

  const originalEnv = { ...process.env };
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let lockoutA: LoginLockoutService;
  let lockoutB: LoginLockoutService;
  let authServiceA: SchoolAuthService;
  let authServiceB: SchoolAuthService;
  let importsService: ImportsService;

  let schoolA: { id: number; uuid: string };
  let schoolB: { id: number; uuid: string };
  let platformUserUuid = '';

  const VALID_STUDENT_CODE = 2261431; // permuteFiveDigitsV1(0, 22)
  const VALID_STUDENT_PASS = 'SecNum01#Pass';
  const NON_EXISTENT_CODE = 2299998; // صيغة صالحة لكن لا يوجد مستخدم

  beforeAll(async () => {
    process.env.APP_ENV = 'local';
    process.env.JWT_SECRET =
      'sec-num-01-integration-jwt-secret-minimum-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'sec-num-01-integration-independent-hmac-key-32-chars!!';

    tempDbName = `asas_sec_num_01_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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

    prismaA = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaB = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await Promise.all([prismaA.onModuleInit(), prismaB.onModuleInit()]);

    const dbCheck: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (dbCheck[0]?.db !== tempDbName) {
      throw new Error(`Wrong DB connected: ${dbCheck[0]?.db}`);
    }

    lockoutA = new LoginLockoutService(prismaA);
    lockoutB = new LoginLockoutService(prismaB);

    const jwtOpts = {
      secret: process.env.JWT_SECRET,
      signOptions: {
        issuer: SCHOOL_AUTH_JWT.issuer,
        audience: SCHOOL_AUTH_JWT.audience,
      },
    };
    authServiceA = new SchoolAuthService(
      prismaA,
      new JwtService(jwtOpts),
      new SessionsService(prismaA),
      lockoutA,
    );
    authServiceB = new SchoolAuthService(
      prismaB,
      new JwtService(jwtOpts),
      new SessionsService(prismaB),
      lockoutB,
    );
    importsService = new ImportsService(
      prismaA,
      new SubscriptionTrialService(),
      new UserCodeGeneratorService(),
    );

    // تهيئة بيانات المدارس والمستخدمين والهيكل التعليمي للاختبارات
    const passwordHash = await bcrypt.hash(VALID_STUDENT_PASS, 10);

    schoolA = await prismaA.school.create({
      data: {
        name: 'School A SecNum01',
        displayName: 'مدرسة أ',
        schoolCode: 96001,
        appType: AppType.PUBLIC,
        isActive: true,
      },
      select: { id: true, uuid: true },
    });
    schoolB = await prismaA.school.create({
      data: {
        name: 'School B WhiteLabel',
        displayName: 'مدرسة ب',
        schoolCode: 96002,
        appType: AppType.PRIVATE,
        isActive: true,
      },
      select: { id: true, uuid: true },
    });

    // حجز أول رقم من user_code_ranges (سيعطي 2261431)
    const allocatedCode = await prismaA.$transaction((tx) =>
      new UserCodeGeneratorService().generateUserCode(tx, UserType.STUDENT),
    );
    expect(allocatedCode).toBe(VALID_STUDENT_CODE);

    const userA = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: allocatedCode,
        name: 'طالب اختبار القفل',
        displayName: 'طالب اختبار القفل',
        passwordHash,
        isActive: true,
      },
    });
    await prismaA.student.create({ data: { userId: userA.id } });

    const platformAdmin = await prismaA.platformUser.create({
      data: {
        username: 'sec_num_01_importer',
        passwordHash,
        name: 'منسق الاستيراد',
        role: 'PLATFORM_ADMIN',
        isActive: true,
      },
    });
    platformUserUuid = platformAdmin.uuid;

    const yearA = await prismaA.year.create({
      data: {
        schoolId: schoolA.id,
        name: '2026-2027',
        isCurrent: true,
      },
    });
    const dictGrade = await prismaA.gradeDictionary.create({
      data: {
        code: 'G1_SECNUM',
        defaultName: 'الصف الأول',
        stage: GradeStage.PRIMARY,
        sortOrder: 1,
      },
    });
    const schoolGrade = await prismaA.schoolGrade.create({
      data: {
        schoolId: schoolA.id,
        dictionaryId: dictGrade.id,
        displayName: 'الصف الأول',
        sortOrder: 1,
      },
    });
    await prismaA.section.create({
      data: {
        gradeId: schoolGrade.id,
        name: 'أ',
        orderIndex: 1,
      },
    });
    expect(yearA.id).toBeGreaterThan(0);
  });

  beforeEach(async () => {
    process.env.APP_ENV = 'local';
    process.env.JWT_SECRET =
      'sec-num-01-integration-jwt-secret-minimum-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'sec-num-01-integration-independent-hmac-key-32-chars!!';
    await prismaA.loginAttemptState.deleteMany({});
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    await Promise.allSettled([
      prismaA?.onModuleDestroy(),
      prismaB?.onModuleDestroy(),
    ]);
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

  it('1. handles 10 concurrent failures across 2 PostgreSQL connections atomically without lost updates, overshooting, or deadlocks', async () => {
    const ip = '198.51.100.11';
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        (idx % 2 === 0 ? lockoutA : lockoutB).recordFailedAttempt(
          VALID_STUDENT_CODE,
          ip,
        ),
      ),
    );

    const countedRuns = results.filter((r) => r.codeIpCounted);
    expect(countedRuns).toHaveLength(5);

    const codeHash = lockoutA.hashCode(VALID_STUDENT_CODE);
    const ipHash = lockoutA.hashIp(ip);

    const codeIpRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash } },
    });
    const codeGlobalRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash: '' } },
    });

    expect(codeIpRow.failedCount).toBe(5);
    expect(codeIpRow.lockTier).toBe(1);
    expect(codeIpRow.lockedUntil).not.toBeNull();
    // لأن القفل يوقف تمرير المحاولات الزائدة من IP المهاجم، لا يتضخم العداد العالمي فوق 5
    expect(codeGlobalRow.failedCount).toBe(5);
    expect(codeGlobalRow.lockTier).toBe(0);
    expect(codeGlobalRow.lockedUntil).toBeNull();
  });

  it('2. protects against Account Lockout DoS: legitimate IP logs in even when attacker IP is locked, and attacker IP remains locked', async () => {
    const attackerIp = '198.51.100.12';
    const legitimateIp = '198.51.100.50';

    for (let i = 0; i < 5; i++) {
      await expect(
        authServiceA.login(
          {
            identifier: String(VALID_STUDENT_CODE),
            password: 'WrongPassword1',
            deviceFingerprint: 'att-fp',
            deviceType: 'ANDROID',
          },
          { clientIp: attackerIp },
        ),
      ).rejects.toThrow(UnauthorizedException);
    }

    // المهاجم على attackerIp الآن مقفول
    await expect(
      authServiceA.login(
        {
          identifier: String(VALID_STUDENT_CODE),
          password: VALID_STUDENT_PASS,
          deviceFingerprint: 'att-fp',
          deviceType: 'ANDROID',
        },
        { clientIp: attackerIp },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // المستخدم الشرعي على legitimateIp ينجح فوراً عبر الاتصال الثاني prismaB
    const success = await authServiceB.login(
      {
        identifier: String(VALID_STUDENT_CODE),
        password: VALID_STUDENT_PASS,
        deviceFingerprint: 'legit-fp-1',
        deviceType: 'ANDROID',
      },
      { clientIp: legitimateIp },
    );
    expect(success.accessToken).toBeTruthy();
    expect(success.user.code).toBe(VALID_STUDENT_CODE);

    // بعد نجاح الشرعي: صفه وصف CODE مصفّران، بينما يبقى صف attackerIp مقفولاً!
    await expect(
      lockoutB.assertNotLocked(VALID_STUDENT_CODE, attackerIp),
    ).rejects.toThrow(LoginLockoutException);
    await expect(
      lockoutB.assertNotLocked(VALID_STUDENT_CODE, legitimateIp),
    ).resolves.toBeUndefined();
  });

  it('3. strictly prevents extending locked_until or inflating failed_count while locked', async () => {
    const attackerIp = '198.51.100.13';
    for (let i = 0; i < 5; i++) {
      await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, attackerIp);
    }

    const codeHash = lockoutA.hashCode(VALID_STUDENT_CODE);
    const ipHash = lockoutA.hashIp(attackerIp);

    const beforeRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash } },
    });
    expect(beforeRow.failedCount).toBe(5);
    expect(beforeRow.lockedUntil).not.toBeNull();

    // محاولات إضافية أثناء سريان القفل (متتالية ومتزامنة)
    for (let i = 0; i < 5; i++) {
      await expect(
        authServiceB.login(
          {
            identifier: String(VALID_STUDENT_CODE),
            password: 'WrongPassword',
            deviceFingerprint: 'att-fp',
            deviceType: 'WEB',
          },
          { clientIp: attackerIp },
        ),
      ).rejects.toThrow(LoginLockoutException);
    }
    const r = await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, attackerIp);
    expect(r.codeIpCounted).toBe(false);

    const afterRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash } },
    });
    expect(afterRow.failedCount).toBe(5);
    expect(afterRow.lastFailedAt.getTime()).toBe(
      beforeRow.lastFailedAt.getTime(),
    );
    expect(afterRow.lockedUntil!.getTime()).toBe(
      beforeRow.lockedUntil!.getTime(),
    );
  });

  it('4. enforces exact 60m Full Idle Reset decay semantics after lock expiry', async () => {
    const ip = '198.51.100.14';
    for (let i = 0; i < 5; i++) {
      await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, ip);
    }

    const codeHash = lockoutA.hashCode(VALID_STUDENT_CODE);
    const ipHash = lockoutA.hashIp(ip);

    // الحالة أ: انتهى القفل ضمن نافذة 60 دقيقة (last_failed_at منذ 10 دقائق، locked_until انتهى منذ دقيقة)
    await prismaA.$executeRaw`
      UPDATE "login_attempt_states"
      SET "last_failed_at" = NOW() - INTERVAL '10 minutes',
          "locked_until" = NOW() - INTERVAL '1 minute'
      WHERE "code_hash" = ${codeHash}
    `;

    await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, ip);
    const escalatedRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash } },
    });
    expect(escalatedRow.failedCount).toBe(6);
    expect(escalatedRow.lockTier).toBe(1);
    expect(escalatedRow.lockedUntil).not.toBeNull();

    // الحالة ب: خمول أكثر من 60 دقيقة (last_failed_at منذ 61 دقيقة) ← Full Idle Reset عند الفشل التالي
    await prismaA.$executeRaw`
      UPDATE "login_attempt_states"
      SET "last_failed_at" = NOW() - INTERVAL '61 minutes',
          "locked_until" = NOW() - INTERVAL '59 minutes'
      WHERE "code_hash" = ${codeHash}
    `;

    await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, ip);
    const resetIpRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash } },
    });
    const resetGlobalRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash: '' } },
    });

    expect(resetIpRow.failedCount).toBe(1);
    expect(resetIpRow.lockTier).toBe(0);
    expect(resetIpRow.lockedUntil).toBeNull();
    expect(resetGlobalRow.failedCount).toBe(1);
    expect(resetGlobalRow.lockTier).toBe(0);
    expect(resetGlobalRow.lockedUntil).toBeNull();
  });

  it('5. applies progressive tiers up to 30m cap on distributed rotating IPs and equally on non-existent codes', async () => {
    // محاكاة هجوم موزع من 26 IP مختلفة على الرقم غير الموجود NON_EXISTENT_CODE
    for (let i = 1; i <= 25; i++) {
      const rotatingIp = `198.51.101.${i}`;
      await lockoutA.recordFailedAttempt(NON_EXISTENT_CODE, rotatingIp);

      // إذا كان القفل العالمي قد تفعل في الخطوات 10 و15 و20، نصفر locked_until في الاختبار لمحاكاة انتظار المهلة حتى 25
      if (i === 10 || i === 15 || i === 20 || (i > 10 && i < 25)) {
        const gCodeHash = lockoutA.hashCode(NON_EXISTENT_CODE);
        await prismaA.$executeRaw`
          UPDATE "login_attempt_states"
          SET "locked_until" = NULL
          WHERE "code_hash" = ${gCodeHash} AND "ip_hash" = ''
        `;
      }
    }

    const codeHash = lockoutA.hashCode(NON_EXISTENT_CODE);
    const globalRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash: '' } },
    });
    expect(globalRow.failedCount).toBe(25);
    expect(globalRow.lockTier).toBe(4);
    expect(globalRow.lockedUntil).not.toBeNull();

    // الـ IP رقم 26 يُحظر فوراً مع بقاء المهلة قريبة من 30 دقيقة (<= 1800s)
    try {
      await authServiceA.login(
        {
          identifier: String(NON_EXISTENT_CODE),
          password: 'AnyPassword1',
          deviceFingerprint: 'fp-26',
          deviceType: 'ANDROID',
        },
        { clientIp: '198.51.101.26' },
      );
      throw new Error('Expected LoginLockoutException');
    } catch (err) {
      expect(err).toBeInstanceOf(LoginLockoutException);
      expect((err as LoginLockoutException).retryAfterSeconds).toBeGreaterThan(
        1700,
      );
      expect(
        (err as LoginLockoutException).retryAfterSeconds,
      ).toBeLessThanOrEqual(1800);
    }

    // المعرّف غير الصالح الصيغة لا يكتب أي سجل في login_attempt_states
    const rowsBefore = await prismaA.loginAttemptState.count();
    await expect(
      authServiceA.login(
        {
          identifier: 'invalid-non-numeric',
          password: 'Password123',
          deviceFingerprint: 'fp-x',
          deviceType: 'WEB',
        },
        { clientIp: '198.51.102.1' },
      ),
    ).rejects.toThrow(SCHOOL_AUTH_ERRORS.INVALID_CREDENTIALS);
    expect(await prismaA.loginAttemptState.count()).toBe(rowsBefore);
  });

  it('6. verifies key rotation behavior in PostgreSQL: fallback JWT_SECRET rotation invalidates match vs independent LOGIN_LOCKOUT_HMAC_KEY preserves active locks', async () => {
    const ip = '198.51.100.99';

    // السيناريو أ: بدون LOGIN_LOCKOUT_HMAC_KEY (الاعتماد على HKDF(JWT_SECRET))
    delete process.env.LOGIN_LOCKOUT_HMAC_KEY;
    process.env.JWT_SECRET = 'jwt-rotation-secret-phase-1-over-32-chars!!';
    for (let i = 0; i < 5; i++) {
      await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, ip);
    }
    await expect(
      lockoutA.assertNotLocked(VALID_STUDENT_CODE, ip),
    ).rejects.toThrow(LoginLockoutException);

    // تدوير JWT_SECRET: القفل القديم لم يعد يطابق البصمة الجديدة (سلوك موثّق)
    process.env.JWT_SECRET = 'jwt-rotation-secret-phase-2-over-32-chars!!';
    await expect(
      lockoutA.assertNotLocked(VALID_STUDENT_CODE, ip),
    ).resolves.toBeUndefined();

    // تنظيف الجدول واختبار السيناريو ب: مفتاح LOGIN_LOCKOUT_HMAC_KEY مستقل
    await prismaA.loginAttemptState.deleteMany({});
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'independent-lockout-hmac-key-stays-constant-over-32-chars!!';
    process.env.JWT_SECRET = 'jwt-rotation-secret-phase-3-over-32-chars!!';

    for (let i = 0; i < 5; i++) {
      await lockoutA.recordFailedAttempt(VALID_STUDENT_CODE, ip);
    }
    // تدوير JWT_SECRET لا يكسر القفل عندما يكون LOGIN_LOCKOUT_HMAC_KEY مستقلاً
    process.env.JWT_SECRET = 'jwt-rotation-secret-phase-4-over-32-chars!!';
    await expect(
      lockoutA.assertNotLocked(VALID_STUDENT_CODE, ip),
    ).rejects.toThrow(LoginLockoutException);
  });

  it('7. drains distributed attack bloat in multi-batch loop until exhausted while preserving active rows', async () => {
    // زرع 130 سجل CODE_IP منتهي الصلاحية (> 25 ساعة) + 5 سجلات نشطة/مقفولة
    const staleRows = Array.from({ length: 130 }, (_, i) => ({
      codeHash: crypto
        .createHash('sha256')
        .update(`stale-code-${i}`)
        .digest('hex'),
      ipHash: crypto
        .createHash('sha256')
        .update(`stale-ip-${i}`)
        .digest('hex'),
      failedCount: 3,
      lockTier: 0,
      lastFailedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      lockedUntil: null,
    }));
    await prismaA.loginAttemptState.createMany({ data: staleRows });

    const activeRows = Array.from({ length: 5 }, (_, i) => ({
      codeHash: crypto
        .createHash('sha256')
        .update(`active-code-${i}`)
        .digest('hex'),
      ipHash: crypto
        .createHash('sha256')
        .update(`active-ip-${i}`)
        .digest('hex'),
      failedCount: 5,
      lockTier: 1,
      lastFailedAt: new Date(),
      lockedUntil: new Date(Date.now() + 120 * 1000),
    }));
    await prismaA.loginAttemptState.createMany({ data: activeRows });

    // اختبار بلوغ سقف الدفعات أولاً (2 دفعة × 25 = 50)
    const partialDrain = await lockoutA.cleanupExpiredStates({
      batchSize: 25,
      maxBatches: 2,
    });
    expect(partialDrain.skippedDueToLock).toBe(false);
    expect(partialDrain.totalDeleted).toBe(50);
    expect(partialDrain.batchesExecuted).toBe(2);
    expect(partialDrain.reachedBatchCap).toBe(true);
    expect(partialDrain.remainingRows).toBe(85);

    // ثم استنزاف البقية بالكامل في جولة متعددة الدفعات
    const fullDrain = await lockoutA.cleanupExpiredStates({
      batchSize: 25,
      maxBatches: 10,
    });
    expect(fullDrain.skippedDueToLock).toBe(false);
    expect(fullDrain.totalDeleted).toBe(80);
    expect(fullDrain.batchesExecuted).toBe(4); // 25 + 25 + 25 + 5
    expect(fullDrain.reachedBatchCap).toBe(false);
    expect(fullDrain.remainingRows).toBe(5);
  });

  it('8. ImportsService creates 8-digit CSPRNG student password and 12-char alphanumeric parent/teacher passwords, logs nothing sensitive, and allows login', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log');
    const errSpy = jest.spyOn(Logger.prototype, 'error');

    const studentPreview = await importsService.previewStudents(
      schoolA.uuid,
      {
        _schema: 'asas_students_import_v1',
        students: [
          {
            student_name: 'طالب مستورد جديد',
            gender: 'MALE',
            grade_code: 'G1_SECNUM',
            section: 'أ',
            parent: {
              name: 'ولي أمر مستورد جديد',
              phone: '770112233',
              gender: 'MALE',
            },
          },
        ],
      },
      platformUserUuid,
    );
    const studentExec = await importsService.executeImport(
      schoolA.uuid,
      studentPreview.importUuid,
    );

    const teacherPreview = await importsService.previewTeachers(
      schoolA.uuid,
      {
        _schema: 'asas_teachers_import_v1',
        teachers: [
          {
            teacher_name: 'معلم مستورد جديد',
            gender: 'MALE',
            phone: '770445566',
          },
        ],
      },
      platformUserUuid,
    );
    const teacherExec = await importsService.executeImport(
      schoolA.uuid,
      teacherPreview.importUuid,
    );

    const studentCred = studentExec.credentials.find(
      (c) => c.role === 'STUDENT',
    )!;
    const parentCred = studentExec.credentials.find(
      (c) => c.role === 'PARENT',
    )!;
    const teacherCred = teacherExec.credentials.find(
      (c) => c.role === 'TEACHER',
    )!;

    expect(studentCred.password).toMatch(/^[1-9]\d{7}$/);
    expect(studentCred.password).not.toBe(String(studentCred.schoolNumber));

    expect(parentCred.password).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
    expect(teacherCred.password).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);

    // التأكد من عدم تسجيل أي كلمة مرور في Logs
    const allLogs = [
      ...logSpy.mock.calls.flat(),
      ...errSpy.mock.calls.flat(),
    ].join('\n');
    expect(allLogs).not.toContain(studentCred.password);
    expect(allLogs).not.toContain(parentCred.password);
    expect(allLogs).not.toContain(teacherCred.password);
    logSpy.mockRestore();
    errSpy.mockRestore();

    // التحقق من صلاحية تسجيل الدخول الفعلي لكل الحسابات الثلاثة المستوردة
    for (const cred of [studentCred, parentCred, teacherCred]) {
      const loginRes = await authServiceA.login(
        {
          identifier: String(cred.schoolNumber),
          password: cred.password,
          deviceFingerprint: `fp-${cred.role}`,
          deviceType: 'ANDROID',
        },
        { clientIp: '198.51.100.77' },
      );
      expect(loginRes.accessToken).toBeTruthy();
      expect(loginRes.user.code).toBe(cred.schoolNumber);
    }
  });

  it('9. prevents single-failure repeated 30m global CODE re-lock after lock expiry across rotating IPs while preserving re-arm after 5 fresh failures', async () => {
    const codeHash = lockoutA.hashCode(VALID_STUDENT_CODE);

    // 1) إيصال العداد العام CODE إلى المستوى 4 (failedCount = 25, lockedUntil = +30m) عبر 25 IP مختلفة
    for (let i = 1; i <= 25; i++) {
      await lockoutA.recordFailedAttempt(
        VALID_STUDENT_CODE,
        `198.51.104.${i}`,
      );
      if (i >= 10 && i < 25) {
        await prismaA.$executeRaw`
          UPDATE "login_attempt_states"
          SET "locked_until" = NULL
          WHERE "code_hash" = ${codeHash} AND "ip_hash" = ''
        `;
      }
    }

    const tier4Row = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash: '' } },
    });
    expect(tier4Row.failedCount).toBe(25);
    expect(tier4Row.lockTier).toBe(4);
    expect(tier4Row.lockedUntil).not.toBeNull();

    // التحقق من تفعيل الحظر العالمي (30m) على IP رقم 26
    await expect(
      authServiceA.login(
        {
          identifier: String(VALID_STUDENT_CODE),
          password: VALID_STUDENT_PASS,
          deviceFingerprint: 'fp-26',
          deviceType: 'ANDROID',
        },
        { clientIp: '198.51.104.26' },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // 2) انتهاء مهلة الـ 30 دقيقة (مع بقاء last_failed_at داخل نافذة الخمول 60 دقيقة)
    await prismaA.$executeRaw`
      UPDATE "login_attempt_states"
      SET "last_failed_at" = NOW() - INTERVAL '31 minutes',
          "locked_until" = NOW() - INTERVAL '1 minute'
      WHERE "code_hash" = ${codeHash} AND "ip_hash" = ''
    `;

    // 3) يرسل المهاجم محاولة فاشلة واحدة (وحتى 4 محاولات) من IPs جديدة — لا يُعاد القفل الفوري!
    for (let j = 1; j <= 4; j++) {
      await expect(
        authServiceA.login(
          {
            identifier: String(VALID_STUDENT_CODE),
            password: 'WrongPassword#Rotate',
            deviceFingerprint: `fp-rot-${j}`,
            deviceType: 'ANDROID',
          },
          { clientIp: `198.51.105.${j}` },
        ),
      ).rejects.toThrow(UnauthorizedException);

      const afterStrayRow = await prismaA.loginAttemptState.findUniqueOrThrow({
        where: { codeHash_ipHash: { codeHash, ipHash: '' } },
      });
      expect(afterStrayRow.failedCount).toBe(25 + j);
      expect(afterStrayRow.lockTier).toBe(4);
      expect(afterStrayRow.lockedUntil).toBeNull();
    }

    // 4) يتمكن المستخدم الشرعي من تسجيل الدخول بنجاح قبل وصول المهاجم للمحاولة الخامسة الجديدة!
    const legitSuccess = await authServiceB.login(
      {
        identifier: String(VALID_STUDENT_CODE),
        password: VALID_STUDENT_PASS,
        deviceFingerprint: 'fp-legit-reentry',
        deviceType: 'ANDROID',
      },
      { clientIp: '198.51.105.50' },
    );
    expect(legitSuccess.accessToken).toBeTruthy();

    // 5) دورة ثانية: إذا عاد الحساب للمستوى 25 وانتهى القفل ثم أرسل المهاجم 5 محاولات من 5 IPs جديدة، يُعاد القفل 30m عند المحاولة 30
    for (let i = 1; i <= 25; i++) {
      await lockoutA.recordFailedAttempt(
        VALID_STUDENT_CODE,
        `198.51.106.${i}`,
      );
      if (i >= 10 && i < 25) {
        await prismaA.$executeRaw`
          UPDATE "login_attempt_states"
          SET "locked_until" = NULL
          WHERE "code_hash" = ${codeHash} AND "ip_hash" = ''
        `;
      }
    }
    await prismaA.$executeRaw`
      UPDATE "login_attempt_states"
      SET "last_failed_at" = NOW() - INTERVAL '31 minutes',
          "locked_until" = NOW() - INTERVAL '1 minute'
      WHERE "code_hash" = ${codeHash} AND "ip_hash" = ''
    `;

    for (let k = 1; k <= 5; k++) {
      await expect(
        authServiceA.login(
          {
            identifier: String(VALID_STUDENT_CODE),
            password: 'WrongPassword#Cycle2',
            deviceFingerprint: `fp-c2-${k}`,
            deviceType: 'WEB',
          },
          { clientIp: `198.51.107.${k}` },
        ),
      ).rejects.toThrow(UnauthorizedException);
    }

    const rearmedRow = await prismaA.loginAttemptState.findUniqueOrThrow({
      where: { codeHash_ipHash: { codeHash, ipHash: '' } },
    });
    expect(rearmedRow.failedCount).toBe(30);
    expect(rearmedRow.lockTier).toBe(4);
    expect(rearmedRow.lockedUntil).not.toBeNull();

    try {
      await authServiceB.login(
        {
          identifier: String(VALID_STUDENT_CODE),
          password: VALID_STUDENT_PASS,
          deviceFingerprint: 'fp-blocked-30',
          deviceType: 'ANDROID',
        },
        { clientIp: '198.51.107.99' },
      );
      throw new Error('Expected LoginLockoutException after re-arm');
    } catch (err) {
      expect(err).toBeInstanceOf(LoginLockoutException);
      expect((err as LoginLockoutException).retryAfterSeconds).toBeGreaterThan(
        1700,
      );
      expect(
        (err as LoginLockoutException).retryAfterSeconds,
      ).toBeLessThanOrEqual(1800);
    }
  });
});

