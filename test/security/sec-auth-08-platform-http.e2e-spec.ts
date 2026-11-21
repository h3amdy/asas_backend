/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlatformRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { promisify } from 'util';
import { PLATFORM_AUTH_ERRORS } from '../../src/platform/auth/constants';
import { PrismaService } from '../../src/prisma/prisma.service';
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
  if (!/^asas_sec_auth_08_http_e2e_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-AUTH-08 & Platform Auth Lockout — Real HTTP E2E (AppModule + trust proxy + ValidationPipe)', () => {
  jest.setTimeout(120_000);

  const originalEnv = { ...process.env };
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let app: INestApplication;
  let prisma: PrismaService;

  const ACTIVE_EMAIL = 'e2e.owner@mafhooom.test';
  const ACTIVE_USERNAME = 'e2e_owner';
  const ACTIVE_PASS = 'PlatformE2eStrong#2026';
  const DISABLED_EMAIL = 'e2e.disabled@mafhooom.test';
  const NON_EXISTENT_EMAIL = 'e2e.missing@mafhooom.test';

  let activeUserId = 0;

  beforeAll(async () => {
    tempDbName = `asas_sec_auth_08_http_e2e_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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
      'sec-auth-08-http-e2e-jwt-secret-key-min-32-chars!!';
    process.env.PLATFORM_JWT_SECRET =
      'sec-auth-08-http-e2e-platform-jwt-secret-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'sec-auth-08-http-e2e-independent-hmac-key-32-chars!!';

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

    const passwordHash = await bcrypt.hash(ACTIVE_PASS, 10);
    const active = await prisma.platformUser.create({
      data: {
        email: ACTIVE_EMAIL,
        username: ACTIVE_USERNAME,
        passwordHash,
        name: 'مالك E2E',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });
    activeUserId = active.id;

    await prisma.platformUser.create({
      data: {
        email: DISABLED_EMAIL,
        username: 'e2e_disabled',
        passwordHash,
        name: 'موقوف E2E',
        role: PlatformRole.PLATFORM_TEACHER,
        isActive: false,
      },
    });
  });

  beforeEach(async () => {
    await prisma.platformAuthSession.deleteMany({});
    await prisma.loginAttemptState.deleteMany({});
    await prisma.platformUser.update({
      where: { id: activeUserId },
      data: { isActive: true, isDeleted: false },
    });
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    if (app) {
      await app.close();
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

  it('1. enforces identical 401 and 429 RATE_LIMITED + Retry-After responses across existing, disabled, and non-existent logins', async () => {
    const server = app.getHttpServer();
    const ipActive = '198.51.100.11';
    const ipDisabled = '198.51.100.12';
    const ipMissing = '198.51.100.13';

    const activeBodies: unknown[] = [];
    const disabledBodies: unknown[] = [];
    const missingBodies: unknown[] = [];

    for (let i = 0; i < 5; i++) {
      const r1 = await request(server)
        .post('/api/v1/auth/platform/login')
        .set('X-Forwarded-For', ipActive)
        .send({ login: ACTIVE_EMAIL, password: 'WrongPassword#1' });
      expect(r1.status).toBe(401);
      activeBodies.push(r1.body);

      const r2 = await request(server)
        .post('/api/v1/auth/platform/login')
        .set('X-Forwarded-For', ipDisabled)
        .send({ login: DISABLED_EMAIL, password: 'WrongPassword#1' });
      expect(r2.status).toBe(401);
      disabledBodies.push(r2.body);

      const r3 = await request(server)
        .post('/api/v1/auth/platform/login')
        .set('X-Forwarded-For', ipMissing)
        .send({ login: NON_EXISTENT_EMAIL, password: 'WrongPassword#1' });
      expect(r3.status).toBe(401);
      missingBodies.push(r3.body);
    }

    expect(activeBodies).toEqual(disabledBodies);
    expect(activeBodies).toEqual(missingBodies);

    // المحاولة السادسة -> 429 موحّدة + Retry-After لجميع الحالات الثلاث
    const lock1 = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', ipActive)
      .send({ login: ACTIVE_EMAIL, password: ACTIVE_PASS });
    const lock2 = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', ipDisabled)
      .send({ login: DISABLED_EMAIL, password: ACTIVE_PASS });
    const lock3 = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', ipMissing)
      .send({ login: NON_EXISTENT_EMAIL, password: ACTIVE_PASS });

    for (const res of [lock1, lock2, lock3]) {
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: PLATFORM_AUTH_ERRORS.RATE_LIMITED,
      });
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(60);
      expect(retryAfter).toBeLessThanOrEqual(120);
    }
  });

  it('2. isolates attacker IP (.10) from legitimate owner IP (.20) supporting both email and username', async () => {
    const server = app.getHttpServer();
    const attackerIp = '198.51.100.10';
    const legitIp = '198.51.100.20';

    for (let i = 0; i < 5; i++) {
      const failRes = await request(server)
        .post('/api/v1/auth/platform/login')
        .set('X-Forwarded-For', attackerIp)
        .send({ login: ACTIVE_EMAIL, password: 'WrongPassword#1' });
      expect(failRes.status).toBe(401);
    }

    const attackerBlocked = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', attackerIp)
      .send({ login: ACTIVE_EMAIL, password: ACTIVE_PASS });
    expect(attackerBlocked.status).toBe(429);
    expect(Number(attackerBlocked.headers['retry-after'])).toBeGreaterThanOrEqual(60);

    // منع تجاوز القفل بتبديل البريد الإلكتروني إلى اسم المستخدم لنفس الحساب من IP المهاجم
    const attackerUsernameSwitchBlocked = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', attackerIp)
      .send({ login: ACTIVE_USERNAME, password: ACTIVE_PASS });
    expect(attackerUsernameSwitchBlocked.status).toBe(429);
    expect(attackerUsernameSwitchBlocked.body.code).toBe('RATE_LIMITED');
    expect(
      Number(attackerUsernameSwitchBlocked.headers['retry-after']),
    ).toBeGreaterThanOrEqual(60);

    // المالك الحقيقي من IP .20 يدخل بنجاح باستخدام اسم المستخدم (PLT-001)
    const legitRes = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', legitIp)
      .send({ login: `  ${ACTIVE_USERNAME} `, password: ACTIVE_PASS });
    expect(legitRes.status).toBe(201);
    expect(legitRes.body.accessToken).toBeTruthy();
    expect(legitRes.body.refreshToken).toBeTruthy();
    expect(legitRes.body.sessionId).toBeTruthy();
    expect(legitRes.body.user.email).toBe(ACTIVE_EMAIL);

    // حتى بعد نجاح المالك الشرعي من .20، يظل IP المهاجم .10 محظوراً عبر اسم المستخدم كذلك
    const attackerStillBlocked = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', attackerIp)
      .send({ login: ACTIVE_USERNAME, password: ACTIVE_PASS });
    expect(attackerStillBlocked.status).toBe(429);
    expect(Number(attackerStillBlocked.headers['retry-after'])).toBeGreaterThanOrEqual(60);
  });

  it('3. enforces DTO validation (trimmed empty login, >200 login, >72 UTF-8 byte password, oversized refreshToken)', async () => {
    const server = app.getHttpServer();

    const blankLogin = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ login: '   ', password: ACTIVE_PASS });
    expect(blankLogin.status).toBe(400);

    const utf8Over72 = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ login: ACTIVE_EMAIL, password: '🔑'.repeat(19) });
    expect(utf8Over72.status).toBe(400);

    const over200Login = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', '198.51.100.32')
      .send({ login: 'a'.repeat(201), password: ACTIVE_PASS });
    expect(over200Login.status).toBe(400);

    const over512Refresh = await request(server)
      .post('/api/v1/auth/platform/refresh')
      .set('X-Forwarded-For', '198.51.100.33')
      .send({
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        refreshToken: 'x'.repeat(513),
      });
    expect(over512Refresh.status).toBe(400);
  });

  it('4. SEC-AUTH-08 HTTP /auth/platform/refresh rotates cleanly, revokes entire session on RT_1 replay, and rejects disabled user pre-rotation', async () => {
    const server = app.getHttpServer();

    const loginRes = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', '198.51.100.40')
      .send({ login: ACTIVE_EMAIL, password: ACTIVE_PASS });
    expect(loginRes.status).toBe(201);

    const rt1 = loginRes.body.refreshToken as string;
    const sessionId = loginRes.body.sessionId as string;

    // 1) تدوير سليم: RT_1 -> RT_2
    const rotateRes = await request(server)
      .post('/api/v1/auth/platform/refresh')
      .set('X-Forwarded-For', '198.51.100.41')
      .send({ sessionId, refreshToken: rt1 });
    expect(rotateRes.status).toBe(201);
    expect(rotateRes.body.refreshToken).toBeTruthy();
    expect(rotateRes.body.refreshToken).not.toBe(rt1);
    const rt2 = rotateRes.body.refreshToken as string;

    // 2) إعادة استخدام RT_1 -> 403 SESSION_REVOKED وإبطال الجلسة فوراً
    const replayRes = await request(server)
      .post('/api/v1/auth/platform/refresh')
      .set('X-Forwarded-For', '198.51.100.42')
      .send({ sessionId, refreshToken: rt1 });
    expect(replayRes.status).toBe(403);
    expect(replayRes.body.message).toBe(PLATFORM_AUTH_ERRORS.SESSION_REVOKED);

    // 3) حتى RT_2 مرفوض لاحقاً بـ 403 SESSION_REVOKED
    const victimRes = await request(server)
      .post('/api/v1/auth/platform/refresh')
      .set('X-Forwarded-For', '198.51.100.43')
      .send({ sessionId, refreshToken: rt2 });
    expect(victimRes.status).toBe(403);
    expect(victimRes.body.message).toBe(PLATFORM_AUTH_ERRORS.SESSION_REVOKED);

    // 4) مستخدم معطل على جلسة قائمة: 401 ACCOUNT_DISABLED بدون تدوير التوكن
    const loginRes2 = await request(server)
      .post('/api/v1/auth/platform/login')
      .set('X-Forwarded-For', '198.51.100.44')
      .send({ login: ACTIVE_EMAIL, password: ACTIVE_PASS });
    expect(loginRes2.status).toBe(201);
    const rtActive2 = loginRes2.body.refreshToken as string;
    const sessionId2 = loginRes2.body.sessionId as string;

    await prisma.platformUser.update({
      where: { id: activeUserId },
      data: { isActive: false },
    });

    const disabledRefresh = await request(server)
      .post('/api/v1/auth/platform/refresh')
      .set('X-Forwarded-For', '198.51.100.45')
      .send({ sessionId: sessionId2, refreshToken: rtActive2 });
    expect(disabledRefresh.status).toBe(401);
    expect(disabledRefresh.body.message).toBe(
      PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED,
    );

    const frozenRow = await prisma.platformAuthSession.findUnique({
      where: { uuid: sessionId2 },
    });
    expect(frozenRow!.refreshTokenHash).toBe(sha256(rtActive2));
    expect(frozenRow!.revokedAt).not.toBeNull();
  });
});

