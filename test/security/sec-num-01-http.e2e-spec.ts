/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppType, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { promisify } from 'util';
import { UserCodeGeneratorService } from '../../src/common/user-code/user-code-generator.service';
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
  if (!/^asas_sec_num_01_http_e2e_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-NUM-01 — Real HTTP E2E (AppModule + ThrottlerGuard + ValidationPipe + trust proxy + Lockout Parity)', () => {
  jest.setTimeout(120_000);

  const originalEnv = { ...process.env };
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let app: INestApplication;
  let prisma: PrismaService;

  let schoolA: { id: number; uuid: string };
  let schoolB: { id: number; uuid: string };
  const EXISTING_CODE = 2261431;
  const SECOND_EXISTING_CODE = 2228871;
  const NON_EXISTENT_CODE = 2299998;
  const VALID_PASS = 'HttpE2ePass#2026';

  beforeAll(async () => {
    tempDbName = `asas_sec_num_01_http_e2e_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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
      'sec-num-01-http-e2e-jwt-secret-key-min-32-chars!!';
    process.env.PLATFORM_JWT_SECRET =
      'sec-num-01-http-e2e-platform-jwt-secret-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'sec-num-01-http-e2e-independent-hmac-key-32-chars!!';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // مطابقة src/main.ts الحقيقية
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

    const passwordHash = await bcrypt.hash(VALID_PASS, 10);
    schoolA = await prisma.school.create({
      data: {
        name: 'E2E School A',
        displayName: 'مدرسة A',
        schoolCode: 97001,
        appType: AppType.PUBLIC,
        isActive: true,
      },
      select: { id: true, uuid: true },
    });
    schoolB = await prisma.school.create({
      data: {
        name: 'E2E School B',
        displayName: 'مدرسة B',
        schoolCode: 97002,
        appType: AppType.PRIVATE,
        isActive: true,
      },
      select: { id: true, uuid: true },
    });

    const gen = new UserCodeGeneratorService();
    const [c1, c2] = await prisma.$transaction((tx) =>
      gen.allocateCodes(2, tx),
    );
    expect(c1).toBe(EXISTING_CODE);
    expect(c2).toBe(SECOND_EXISTING_CODE);

    await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: c1,
        name: 'طالب E2E الأول',
        displayName: 'طالب E2E الأول',
        passwordHash,
        isActive: true,
      },
    });
    await prisma.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: c2,
        name: 'طالب E2E الثاني',
        displayName: 'طالب E2E الثاني',
        passwordHash,
        isActive: true,
      },
    });
  });

  beforeEach(async () => {
    await prisma.loginAttemptState.deleteMany({});
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

  it('1. enforces identical HTTP 401 and 429 RATE_LIMITED + Retry-After responses between existing and non-existent codes (no enumeration)', async () => {
    const server = app.getHttpServer();
    const ipExisting = '198.51.100.1';
    const ipNonExistent = '198.51.100.2';

    const existing401Statuses: number[] = [];
    const nonExistent401Statuses: number[] = [];
    const existingBodies: unknown[] = [];
    const nonExistentBodies: unknown[] = [];

    for (let i = 0; i < 5; i++) {
      const resExist = await request(server)
        .post('/api/v1/school/auth/login')
        .set('X-Forwarded-For', ipExisting)
        .send({
          identifier: String(EXISTING_CODE),
          password: 'WrongPassword#1',
          deviceFingerprint: 'e2e-fp-1',
          deviceType: 'ANDROID',
        });
      existing401Statuses.push(resExist.status);
      existingBodies.push(resExist.body);

      const resNonExist = await request(server)
        .post('/api/v1/school/auth/login')
        .set('X-Forwarded-For', ipNonExistent)
        .send({
          identifier: String(NON_EXISTENT_CODE),
          password: 'WrongPassword#1',
          deviceFingerprint: 'e2e-fp-1',
          deviceType: 'ANDROID',
        });
      nonExistent401Statuses.push(resNonExist.status);
      nonExistentBodies.push(resNonExist.body);
    }

    expect(existing401Statuses).toEqual([401, 401, 401, 401, 401]);
    expect(nonExistent401Statuses).toEqual([401, 401, 401, 401, 401]);
    expect(existingBodies).toEqual(nonExistentBodies);

    // المحاولة السادسة: كلاهما محظور بـ 429 RATE_LIMITED بنفس الهيكل وترويسة Retry-After
    const lockedExist = await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', ipExisting)
      .send({
        identifier: String(EXISTING_CODE),
        password: VALID_PASS,
        deviceFingerprint: 'e2e-fp-1',
        deviceType: 'ANDROID',
      });
    const lockedNonExist = await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', ipNonExistent)
      .send({
        identifier: String(NON_EXISTENT_CODE),
        password: VALID_PASS,
        deviceFingerprint: 'e2e-fp-1',
        deviceType: 'ANDROID',
      });

    expect(lockedExist.status).toBe(429);
    expect(lockedNonExist.status).toBe(429);
    expect(lockedExist.body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'RATE_LIMITED',
    });
    expect(lockedNonExist.body).toEqual(lockedExist.body);

    const retryExist = Number(lockedExist.headers['retry-after']);
    const retryNonExist = Number(lockedNonExist.headers['retry-after']);
    expect(retryExist).toBeGreaterThanOrEqual(60);
    expect(retryExist).toBeLessThanOrEqual(120);
    expect(Math.abs(retryExist - retryNonExist)).toBeLessThanOrEqual(2);
  });

  it('2. resolves req.ip accurately behind Nginx loopback proxy and isolates attacker IP vs legitimate IP; rejects non-loopback spoofed X-Forwarded-For', async () => {
    const server = app.getHttpServer();
    const attackerIp = '198.51.100.10';
    const legitIp = '198.51.100.20';

    // قفل attackerIp عبر X-Forwarded-For (الاتصال من 127.0.0.1 loopback)
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/v1/school/auth/login')
        .set('X-Forwarded-For', attackerIp)
        .send({
          identifier: String(EXISTING_CODE),
          password: 'WrongPassword',
          deviceFingerprint: 'fp-att',
          deviceType: 'ANDROID',
        })
        .expect(401);
    }

    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', attackerIp)
      .send({
        identifier: String(EXISTING_CODE),
        password: VALID_PASS,
        deviceFingerprint: 'fp-att',
        deviceType: 'ANDROID',
      })
      .expect(429);

    // المستخدم الشرعي على IP آخر عبر نفس البوابة ينجح بـ 201
    const legitRes = await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', legitIp)
      .send({
        identifier: String(EXISTING_CODE),
        password: VALID_PASS,
        deviceFingerprint: 'fp-legit',
        deviceType: 'ANDROID',
      })
      .expect(201);
    expect(legitRes.body.accessToken).toBeTruthy();

    // ويبقى attackerIp مقفولاً حتى بعد دخول الشرعي
    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', attackerIp)
      .send({
        identifier: String(EXISTING_CODE),
        password: VALID_PASS,
        deviceFingerprint: 'fp-att',
        deviceType: 'ANDROID',
      })
      .expect(429);

    // التحقق من سلوك trust proxy: 'loopback' عند وصول طلب من عنوان غير loopback مع X-Forwarded-For مزور
    const isolatedApp = express();
    isolatedApp.set('trust proxy', 'loopback');
    isolatedApp.get('/ip-check', (req, res) => {
      res.json({ ip: req.ip });
    });

    // محاكاة socket.remoteAddress = '203.0.113.99' (خارج نطاق loopback)
    isolatedApp.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', {
        value: '203.0.113.99',
        configurable: true,
      });
      next();
    });

    // مع الطلب عبر loopback الحقيقي يُقبل X-Forwarded-For، أما عند فحص trust('203.0.113.99', 0) مباشرة:
    const trustFn = isolatedApp.get('trust proxy fn') as (
      addr: string,
      distance: number,
    ) => boolean;
    expect(trustFn('127.0.0.1', 0)).toBe(true);
    expect(trustFn('::1', 0)).toBe(true);
    expect(trustFn('203.0.113.99', 0)).toBe(false);
  });

  it('3. treats White-Label schoolUuid mismatch as failed attempt without clearing lock even with valid password', async () => {
    const server = app.getHttpServer();
    const wlIp = '198.51.100.33';

    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/v1/school/auth/login')
        .set('X-Forwarded-For', wlIp)
        .send({
          schoolUuid: schoolB.uuid,
          identifier: String(EXISTING_CODE),
          password: VALID_PASS, // كلمة مرور صحيحة لكن لمدرسة أخرى!
          deviceFingerprint: 'fp-wl',
          deviceType: 'IOS',
        })
        .expect(401);
    }

    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', wlIp)
      .send({
        schoolUuid: schoolB.uuid,
        identifier: String(EXISTING_CODE),
        password: VALID_PASS,
        deviceFingerprint: 'fp-wl',
        deviceType: 'IOS',
      })
      .expect(429);
  });

  it('4. enforces @MaxLength(72) and @MaxUtf8Bytes(72) over HTTP without writing lockout rows on 400 rejections', async () => {
    const server = app.getHttpServer();
    const dtoIp = '198.51.100.44';

    // 72 بايت ASCII و36 محرفاً عربياً (72 بايت UTF-8) يعبران DTO (ويعودان 401 على كلمة مرور خاطئة)
    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', dtoIp)
      .send({
        identifier: String(SECOND_EXISTING_CODE),
        password: 'A'.repeat(72),
        deviceFingerprint: 'fp-dto',
        deviceType: 'ANDROID',
      })
      .expect(401);

    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', dtoIp)
      .send({
        identifier: String(SECOND_EXISTING_CODE),
        password: 'أ'.repeat(36),
        deviceFingerprint: 'fp-dto',
        deviceType: 'ANDROID',
      })
      .expect(401);

    const rowsBeforeReject = await prisma.loginAttemptState.count();

    // 73 ASCII bytes و37 محرفاً عربياً (74 بايت UTF-8 رغم length=37) يُرفضان بـ 400 ولا يكتبان صفاً
    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', dtoIp)
      .send({
        identifier: String(SECOND_EXISTING_CODE),
        password: 'A'.repeat(73),
        deviceFingerprint: 'fp-dto',
        deviceType: 'ANDROID',
      })
      .expect(400);

    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', dtoIp)
      .send({
        identifier: String(SECOND_EXISTING_CODE),
        password: 'أ'.repeat(37),
        deviceFingerprint: 'fp-dto',
        deviceType: 'ANDROID',
      })
      .expect(400);

    expect(await prisma.loginAttemptState.count()).toBe(rowsBeforeReject);
  });

  it('5. applies IP ThrottlerGuard across distinct codes after 10 requests/min and never logs passwords', async () => {
    const server = app.getHttpServer();
    const sprayIp = '198.51.100.55';
    const secretProbePassword = 'SuperSecretSprayProbe#999';

    const logSpy = jest.spyOn(Logger.prototype, 'log');
    const errSpy = jest.spyOn(Logger.prototype, 'error');

    for (let i = 0; i < 10; i++) {
      await request(server)
        .post('/api/v1/school/auth/login')
        .set('X-Forwarded-For', sprayIp)
        .send({
          identifier: String(2299900 + i),
          password: secretProbePassword,
          deviceFingerprint: 'fp-spray',
          deviceType: 'WEB',
        })
        .expect(401);
    }

    // الطلب 11 من نفس IP عبر أي رقم آخر يوقفه ThrottlerGuard بـ 429 قبل لمس قاعدة البيانات
    const countBeforeThrottled = await prisma.loginAttemptState.count();
    await request(server)
      .post('/api/v1/school/auth/login')
      .set('X-Forwarded-For', sprayIp)
      .send({
        identifier: '2299990',
        password: secretProbePassword,
        deviceFingerprint: 'fp-spray',
        deviceType: 'WEB',
      })
      .expect(429);
    expect(await prisma.loginAttemptState.count()).toBe(countBeforeThrottled);

    const allLogs = [
      ...logSpy.mock.calls.flat(),
      ...errSpy.mock.calls.flat(),
    ].join('\n');
    expect(allLogs).not.toContain(secretProbePassword);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});

