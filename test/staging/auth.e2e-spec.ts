// test/staging/auth.e2e-spec.ts
// ═══════════════════════════════════════════════════════════════
// STG-001 Phase 4 — Authentication E2E
// ═══════════════════════════════════════════════════════════════

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let schoolAUuid: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();

    prisma = app.get(PrismaService);

    // الحصول على UUID مدرسة اختبار أ
    const school = await prisma.school.findFirst({
      where: { schoolCode: 99001 },
      select: { uuid: true },
    });
    expect(school).toBeTruthy();
    schoolAUuid = school!.uuid;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Login ──

  it('POST /api/v1/school/auth/login — should login admin with code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolAUuid,
        identifier: '1001',            // admin code
        password: 'test-admin-123',
        deviceFingerprint: 'e2e-test-device',
        deviceType: 'WEB',
      })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.user.userType).toBe('ADMIN');
    expect(res.body.school.uuid).toBe(schoolAUuid);
  });

  it('POST /api/v1/school/auth/login — should reject wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolAUuid,
        identifier: '1001',
        password: 'wrong-password',
        deviceFingerprint: 'e2e-test-device',
        deviceType: 'WEB',
      })
      .expect(401);
  });

  it('POST /api/v1/school/auth/login — should reject non-existent user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolAUuid,
        identifier: '99999',
        password: 'test-admin-123',
        deviceFingerprint: 'e2e-test-device',
        deviceType: 'WEB',
      })
      .expect(401);
  });

  // ── Refresh ──

  it('POST /api/v1/school/auth/refresh — should refresh tokens', async () => {
    // Login first
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolAUuid,
        identifier: '2001',            // teacher code
        password: 'test-teacher-123',
        deviceFingerprint: 'e2e-test-device-2',
        deviceType: 'WEB',
      })
      .expect(201);

    // Refresh
    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/school/auth/refresh')
      .send({
        sessionId: loginRes.body.sessionId,
        refreshToken: loginRes.body.refreshToken,
        deviceFingerprint: 'e2e-test-device-2',
        deviceType: 'WEB',
      })
      .expect(201);

    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.refreshToken).toBeDefined();
    // Refresh token should be rotated
    expect(refreshRes.body.refreshToken).not.toBe(loginRes.body.refreshToken);
  });

  // ── Logout ──

  it('POST /api/v1/school/auth/logout — should logout successfully', async () => {
    // Login
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolAUuid,
        identifier: '3001',            // student code
        password: 'test-student-123',
        deviceFingerprint: 'e2e-test-device-3',
        deviceType: 'WEB',
      })
      .expect(201);

    // Logout
    await request(app.getHttpServer())
      .post('/api/v1/school/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({
        sessionId: loginRes.body.sessionId,
      })
      .expect(201);

    // Refresh should fail after logout (session revoked → 403)
    await request(app.getHttpServer())
      .post('/api/v1/school/auth/refresh')
      .send({
        sessionId: loginRes.body.sessionId,
        refreshToken: loginRes.body.refreshToken,
        deviceFingerprint: 'e2e-test-device-3',
        deviceType: 'WEB',
      })
      .expect(403);
  });
});
