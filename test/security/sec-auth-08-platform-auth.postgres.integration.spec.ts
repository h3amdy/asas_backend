/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PlatformRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { PLATFORM_AUTH_ERRORS, PLATFORM_AUTH_JWT } from '../../src/platform/auth/constants';
import { PlatformAuthService } from '../../src/platform/auth/platform-auth.service';
import { PlatformSessionsService } from '../../src/platform/sessions/platform-sessions.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  LoginLockoutException,
  LoginLockoutService,
} from '../../src/school/auth/login-lockout.service';
import { sha256 } from '../../src/school/auth/utils/crypto.util';

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
  if (!/^asas_sec_auth_08_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-AUTH-08 & Platform Lockout — Real PostgreSQL 2-Connection Integration', () => {
  jest.setTimeout(120_000);

  const originalEnv = { ...process.env };
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let sessionsA: PlatformSessionsService;
  let sessionsB: PlatformSessionsService;
  let lockoutA: LoginLockoutService;
  let lockoutB: LoginLockoutService;
  let authA: PlatformAuthService;
  let authB: PlatformAuthService;

  const VALID_OWNER_EMAIL = 'owner@mafhooom.test';
  const VALID_OWNER_PASS = 'OwnerStrongPass#2026';
  const DISABLED_EMAIL = 'disabled.owner@mafhooom.test';
  const DISABLED_PASS = 'DisabledOwnerPass#2026';

  let ownerUserId = 0;
  let disabledUserId = 0;

  beforeAll(async () => {
    process.env.APP_ENV = 'local';
    process.env.JWT_SECRET =
      'sec-auth-08-pg-jwt-secret-key-at-least-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'sec-auth-08-pg-hmac-secret-key-at-least-32-chars!!';

    tempDbName = `asas_sec_auth_08_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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
    await prismaA.onModuleInit();
    await prismaB.onModuleInit();

    const rows: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(`ISOLATION FAILURE: connected to "${rows[0]?.db}"`);
    }

    sessionsA = new PlatformSessionsService(prismaA);
    sessionsB = new PlatformSessionsService(prismaB);
    lockoutA = new LoginLockoutService(prismaA);
    lockoutB = new LoginLockoutService(prismaB);

    const jwtA = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: PLATFORM_AUTH_JWT.accessTokenTtlSec,
        issuer: PLATFORM_AUTH_JWT.issuer,
        audience: PLATFORM_AUTH_JWT.audience,
      },
    });
    const jwtB = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: PLATFORM_AUTH_JWT.accessTokenTtlSec,
        issuer: PLATFORM_AUTH_JWT.issuer,
        audience: PLATFORM_AUTH_JWT.audience,
      },
    });

    authA = new PlatformAuthService(prismaA, jwtA, sessionsA, lockoutA);
    authB = new PlatformAuthService(prismaB, jwtB, sessionsB, lockoutB);

    const ownerHash = await bcrypt.hash(VALID_OWNER_PASS, 10);
    const owner = await prismaA.platformUser.create({
      data: {
        email: VALID_OWNER_EMAIL,
        username: 'platform_owner_test',
        passwordHash: ownerHash,
        name: 'مالك المنصة الاختباري',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });
    ownerUserId = owner.id;

    const disabledHash = await bcrypt.hash(DISABLED_PASS, 10);
    const disabled = await prismaA.platformUser.create({
      data: {
        email: DISABLED_EMAIL,
        username: 'disabled_owner_test',
        passwordHash: disabledHash,
        name: 'مستخدم معطل',
        role: PlatformRole.PLATFORM_TEACHER,
        isActive: false,
      },
    });
    disabledUserId = disabled.id;
  });

  beforeEach(async () => {
    await prismaA.platformAuthSession.deleteMany({});
    await prismaA.loginAttemptState.deleteMany({});
    await prismaA.platformUser.update({
      where: { id: ownerUserId },
      data: { isActive: true, isDeleted: false },
    });
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    try {
      if (prismaA) await prismaA.onModuleDestroy();
    } finally {
      try {
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
    }
  });

  it('1. SEC-AUTH-08 TOCTOU Race (2 independent DB connections): exactly 1 refresh wins, loser triggers immediate COMMITTED session revocation killing RT_2', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const loginRes = await authA.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: '203.0.113.10' },
    );

    const rt1 = loginRes.refreshToken;
    const sessionId = loginRes.sessionId;

    const [resA, resB] = await Promise.allSettled([
      authA.refresh({ sessionId, refreshToken: rt1 }),
      authB.refresh({ sessionId, refreshToken: rt1 }),
    ]);

    const fulfilled = [resA, resB].filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<PlatformAuthService['refresh']>>> =>
        r.status === 'fulfilled',
    );
    const rejected = [resA, resB].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ForbiddenException);
    expect(rejected[0].reason.message).toBe(
      PLATFORM_AUTH_ERRORS.SESSION_REVOKED,
    );

    const sessionRow = await prismaA.platformAuthSession.findUnique({
      where: { uuid: sessionId },
    });
    expect(sessionRow).not.toBeNull();
    expect(sessionRow!.revokedAt).not.toBeNull();
    expect(sessionRow!.revokeReason).toBe('ADMIN_REVOKE');

    const rt2 = fulfilled[0].value.refreshToken;
    expect(rt2).not.toBe(rt1);

    // RT_2 الصادر للفائز يُرفض فوراً لأن سباق المحاولتين أبطل الجلسة
    await expect(
      authA.refresh({ sessionId, refreshToken: rt2 }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );

    const logOutput = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logOutput).toContain('SEC-AUTH-08');
    expect(logOutput).not.toContain(rt1);
    expect(logOutput).not.toContain(rt2);
  });

  it('2. SEC-AUTH-08 Sequential Reuse Detection: replaying rotated RT_1 commits ADMIN_REVOKE on Session A, kills RT_2, and leaves sibling Session B unaffected', async () => {
    const loginA = await authA.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: '203.0.113.11' },
    );
    const loginB = await authA.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: '203.0.113.19' },
    );
    const rt1 = loginA.refreshToken;
    const sessionId = loginA.sessionId;
    const siblingSessionId = loginB.sessionId;
    const siblingRt1 = loginB.refreshToken;

    const rotated = await authA.refresh({ sessionId, refreshToken: rt1 });
    const rt2 = rotated.refreshToken;
    expect(rt2).not.toBe(rt1);

    // إعادة إرسال التوكن القديم RT_1 للجلسة A
    await expect(
      authB.refresh({ sessionId, refreshToken: rt1 }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );

    const revokedRow = await prismaA.platformAuthSession.findUnique({
      where: { uuid: sessionId },
    });
    expect(revokedRow!.revokedAt).not.toBeNull();
    expect(revokedRow!.revokeReason).toBe('ADMIN_REVOKE');

    // حتى التوكن الشرعي الأحدث RT_2 للجلسة A يصبح مرفوضاً بعد اكتشاف الاختراق
    await expect(
      authA.refresh({ sessionId, refreshToken: rt2 }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );

    // الجلسة الشقيقة B لنفس المستخدم لا تُبطل دون مبرر وتواصل التجديد بنجاح
    const siblingRowBefore = await prismaA.platformAuthSession.findUnique({
      where: { uuid: siblingSessionId },
    });
    expect(siblingRowBefore!.revokedAt).toBeNull();

    const siblingRotated = await authB.refresh({
      sessionId: siblingSessionId,
      refreshToken: siblingRt1,
    });
    expect(siblingRotated.refreshToken).not.toBe(siblingRt1);
  });

  it('3. Wrong refresh token on active session (same length or different length) revokes session immediately', async () => {
    const loginRes = await authA.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: '203.0.113.12' },
    );
    const rt1 = loginRes.refreshToken;
    const sessionId = loginRes.sessionId;

    const tamperedSameLength =
      (rt1[0] === 'a' ? 'b' : 'a') + rt1.slice(1);

    await expect(
      authB.refresh({ sessionId, refreshToken: tamperedSameLength }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );

    const row = await prismaA.platformAuthSession.findUnique({
      where: { uuid: sessionId },
    });
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokeReason).toBe('ADMIN_REVOKE');

    // حتى RT_1 الصحيح مرفوض بعد الإبطال
    await expect(
      authA.refresh({ sessionId, refreshToken: rt1 }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );
  });

  it('4. Inactive / Soft-Deleted PlatformUser checked BEFORE rotation: rejects 401, revokes session, does NOT rotate hash or extend expiresAt', async () => {
    const originalExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const rt1 = 'valid-token-for-disabled-user-test-' + 'x'.repeat(32);
    const session = await prismaA.platformAuthSession.create({
      data: {
        platformUserId: ownerUserId,
        refreshTokenHash: sha256(rt1),
        expiresAt: originalExpiry,
      },
    });

    await prismaA.platformUser.update({
      where: { id: ownerUserId },
      data: { isActive: false },
    });

    await expect(
      authB.refresh({ sessionId: session.uuid, refreshToken: rt1 }),
    ).rejects.toThrow(
      new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED),
    );

    const afterDisabled = await prismaA.platformAuthSession.findUnique({
      where: { id: session.id },
    });
    expect(afterDisabled!.refreshTokenHash).toBe(sha256(rt1));
    expect(afterDisabled!.expiresAt.getTime()).toBe(originalExpiry.getTime());
    expect(afterDisabled!.revokedAt).not.toBeNull();
    expect(afterDisabled!.revokeReason).toBe('ADMIN_REVOKE');

    // نفس السلوك عند الحذف الناعم isDeleted = true
    const rtDeleted = 'valid-token-for-deleted-user-test-' + 'y'.repeat(32);
    const session2 = await prismaA.platformAuthSession.create({
      data: {
        platformUserId: ownerUserId,
        refreshTokenHash: sha256(rtDeleted),
        expiresAt: originalExpiry,
      },
    });
    await prismaA.platformUser.update({
      where: { id: ownerUserId },
      data: { isActive: true, isDeleted: true },
    });

    await expect(
      authA.refresh({ sessionId: session2.uuid, refreshToken: rtDeleted }),
    ).rejects.toThrow(
      new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED),
    );

    const afterDeleted = await prismaA.platformAuthSession.findUnique({
      where: { id: session2.id },
    });
    expect(afterDeleted!.refreshTokenHash).toBe(sha256(rtDeleted));
    expect(afterDeleted!.expiresAt.getTime()).toBe(originalExpiry.getTime());
    expect(afterDeleted!.revokedAt).not.toBeNull();
  });

  it('5. Enforces PostgreSQL Platform Lockout (CODE_IP + case normalization + anti-DoS + CODE_GLOBAL_REARM_STEP=5) without colliding with School codes', async () => {
    const attackerIp = '203.0.113.50';
    const legitIp = '203.0.113.60';

    // 5 محاولات خاطئة بتنويعات حالة أحرف مختلفة من نفس الـ IP -> تقفل نفس العداد
    for (let i = 0; i < 5; i++) {
      const variant = i % 2 === 0 ? VALID_OWNER_EMAIL : VALID_OWNER_EMAIL.toUpperCase();
      await expect(
        authA.login(
          { login: variant, password: 'WrongPassword#1' },
          { clientIp: attackerIp },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );
    }

    // المحاولة السادسة من IP المهاجم مرفوضة بـ LoginLockoutException سواء بالبريد أو باسم المستخدم حتى مع كلمة المرور الصحيحة
    await expect(
      authB.login(
        { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
        { clientIp: attackerIp },
      ),
    ).rejects.toThrow(LoginLockoutException);
    await expect(
      authB.login(
        { login: 'platform_owner_test', password: VALID_OWNER_PASS },
        { clientIp: attackerIp },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // IP المستخدم الشرعي غير متأثر (حماية ضد Account Lockout DoS من IP واحد)
    const legitSuccess = await authB.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: legitIp },
    );
    expect(legitSuccess.accessToken).toBeTruthy();

    // التحقق من أن IP المهاجم ما زال مقفلاً على البريد واسم المستخدم حتى بعد نجاح دخول المستخدم الشرعي من IP آخر
    await expect(
      authB.login(
        { login: 'platform_owner_test', password: VALID_OWNER_PASS },
        { clientIp: attackerIp },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // منع تجاوز القفل بالتقسيم (3 فشل بالبريد + 2 فشل باسم المستخدم من نفس IP => قفل لكليهما)
    const splitIp = '203.0.113.51';
    for (let i = 0; i < 3; i++) {
      await expect(
        authA.login(
          { login: VALID_OWNER_EMAIL, password: 'WrongPassword#1' },
          { clientIp: splitIp },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );
    }
    for (let i = 0; i < 2; i++) {
      await expect(
        authA.login(
          { login: 'platform_owner_test', password: 'WrongPassword#1' },
          { clientIp: splitIp },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );
    }
    await expect(
      authB.login(
        { login: 'platform_owner_test', password: VALID_OWNER_PASS },
        { clientIp: splitIp },
      ),
    ).rejects.toThrow(LoginLockoutException);
    await expect(
      authB.login(
        { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
        { clientIp: splitIp },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // التحقق من عزل النطاق عن أرقام المدارس الموحدة حتى مع نفس السلسلة '2261431'
    for (let i = 0; i < 5; i++) {
      await expect(
        authA.login(
          { login: '2261431', password: 'WrongPassword#1' },
          { clientIp: '203.0.113.70' },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );
    }
    // قفل منصة المحتوى لـ '2261431' مفعّل، بينما رمز المدرسة 2261431 لم يُقفل!
    await expect(
      lockoutA.assertPlatformNotLocked('2261431', '203.0.113.70'),
    ).rejects.toThrow(LoginLockoutException);
    await expect(
      lockoutA.assertNotLocked(2261431, '203.0.113.70'),
    ).resolves.toBeUndefined();

    // التحقق من القفل العالمي الموحد عند تقسيم الهجوم الموزع (5 IP بالبريد + 5 IP باسم المستخدم => قفل عالمي للاثنين)
    await prismaA.loginAttemptState.deleteMany({});
    for (let i = 1; i <= 5; i++) {
      await expect(
        authA.login(
          { login: VALID_OWNER_EMAIL, password: 'WrongPassword#1' },
          { clientIp: `198.19.1.${i}` },
        ),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        authA.login(
          { login: 'platform_owner_test', password: 'WrongPassword#1' },
          { clientIp: `198.19.2.${i}` },
        ),
      ).rejects.toThrow(UnauthorizedException);
    }
    await expect(
      authB.login(
        { login: 'platform_owner_test', password: VALID_OWNER_PASS },
        { clientIp: '198.19.9.99' },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // محاكاة هجوم موزع (25 IP) عبر المستويات 10/15/20/25 ثم التحقق من نافذة rearm=5
    await prismaA.loginAttemptState.deleteMany({});
    const loginHash = lockoutA.hashPlatformLogin(VALID_OWNER_EMAIL);
    const accountHash = lockoutA.hashPlatformAccount(ownerUserId);
    for (let i = 1; i <= 25; i++) {
      await expect(
        authA.login(
          { login: VALID_OWNER_EMAIL, password: 'WrongPassword#1' },
          { clientIp: `198.18.1.${i}` },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );
      // عند بلوغ عتبة كل مستوى (10، 15، 20) يتحفز القفل المؤقت ثم ينتهي بمرور الزمن قبل الموجة التالية
      if (i === 10 || i === 15 || i === 20) {
        await expect(
          authB.login(
            { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
            { clientIp: '198.18.2.98' },
          ),
        ).rejects.toThrow(LoginLockoutException);

        await prismaA.$executeRaw`
          UPDATE "login_attempt_states"
          SET "locked_until" = NOW() - INTERVAL '1 second'
          WHERE "code_hash" IN (${loginHash}, ${accountHash})
            AND "ip_hash" = ''
        `;
      }
    }

    // الحساب مقفل عالمياً عند 25 محاولة حتى من IP جديد تماماً
    await expect(
      authB.login(
        { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
        { clientIp: '198.18.2.99' },
      ),
    ).rejects.toThrow(LoginLockoutException);

    // انتهاء قفل الـ 30 دقيقة بينما العداد لا يزال >= 25
    await prismaA.$executeRaw`
      UPDATE "login_attempt_states"
      SET "locked_until" = NOW() - INTERVAL '1 second'
      WHERE "code_hash" IN (${loginHash}, ${accountHash})
        AND "ip_hash" = ''
    `;

    // هجوم متواصل من IP جديد (محاولة واحدة فقط) -> لا يعيد القفل فوراً بسبب CODE_GLOBAL_REARM_STEP=5
    await expect(
      authA.login(
        { login: VALID_OWNER_EMAIL, password: 'WrongPassword#1' },
        { clientIp: '198.18.3.1' },
      ),
    ).rejects.toThrow(UnauthorizedException);

    // المالك الشرعي يستطيع الدخول الآن ضمن نافذة الأمان وتصفير العداد!
    const recoveredLogin = await authB.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: '198.18.4.1' },
    );
    expect(recoveredLogin.sessionId).toBeTruthy();

    // أيضاً: الحساب المعطل بكلمة مرور خاطئة يعامل تماماً كالحساب غير الموجود (لا كشف + نفس القفل)
    expect(disabledUserId).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      await expect(
        authA.login(
          { login: DISABLED_EMAIL, password: 'WrongPassword#1' },
          { clientIp: '203.0.113.88' },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );
    }
    await expect(
      authA.login(
        { login: DISABLED_EMAIL, password: DISABLED_PASS },
        { clientIp: '203.0.113.88' },
      ),
    ).rejects.toThrow(LoginLockoutException);
  });

  it('6. Regression: normal multi-step refresh, expired session (SESSION_EXPIRED), logout ownership check, and idempotent revokeSession', async () => {
    const loginRes = await authA.login(
      { login: VALID_OWNER_EMAIL, password: VALID_OWNER_PASS },
      { clientIp: '203.0.113.90' },
    );
    const rt1 = loginRes.refreshToken;
    const sessionId = loginRes.sessionId;
    const ownerUuid = loginRes.user.uuid;

    // 1) تدوير متتابع طبيعي: RT_1 -> RT_2 -> RT_3
    const rot2 = await authA.refresh({ sessionId, refreshToken: rt1 });
    expect(rot2.refreshToken).toBeTruthy();
    expect(rot2.refreshToken).not.toBe(rt1);

    const rot3 = await authB.refresh({
      sessionId,
      refreshToken: rot2.refreshToken,
    });
    expect(rot3.refreshToken).toBeTruthy();
    expect(rot3.refreshToken).not.toBe(rot2.refreshToken);

    // 2) تجاهل logout عندما لا تخص الجلسة المستخدم المرسل
    await expect(
      authA.logout(sessionId, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toEqual({ message: 'تم تسجيل الخروج بنجاح' });
    const stillActiveRow = await prismaA.platformAuthSession.findUnique({
      where: { uuid: sessionId },
    });
    expect(stillActiveRow!.revokedAt).toBeNull();

    // 3) logout الصحيح يبطل الجلسة بـ LOGOUT وrevokeSession مكرر idempotent
    await expect(authA.logout(sessionId, ownerUuid)).resolves.toEqual({
      message: 'تم تسجيل الخروج بنجاح',
    });
    const loggedOutRow = await prismaA.platformAuthSession.findUnique({
      where: { uuid: sessionId },
    });
    expect(loggedOutRow!.revokedAt).not.toBeNull();
    expect(loggedOutRow!.revokeReason).toBe('LOGOUT');

    await expect(
      sessionsA.revokeSession({ sessionUuid: sessionId, reason: 'LOGOUT' }),
    ).resolves.toEqual({ success: true });

    await expect(
      authB.refresh({ sessionId, refreshToken: rot3.refreshToken }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );

    // 4) جلسة منتهية الصلاحية ترجع SESSION_EXPIRED دون تعديل hash أو تعيين revokedAt
    const expiredToken = 'expired-valid-token-' + 'z'.repeat(40);
    const expiredSession = await prismaA.platformAuthSession.create({
      data: {
        platformUserId: ownerUserId,
        refreshTokenHash: sha256(expiredToken),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(
      authA.refresh({
        sessionId: expiredSession.uuid,
        refreshToken: expiredToken,
      }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_EXPIRED),
    );
    const afterExpiredRow = await prismaA.platformAuthSession.findUnique({
      where: { id: expiredSession.id },
    });
    expect(afterExpiredRow!.revokedAt).toBeNull();
    expect(afterExpiredRow!.refreshTokenHash).toBe(sha256(expiredToken));
  });
});
