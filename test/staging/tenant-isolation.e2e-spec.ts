// test/staging/tenant-isolation.e2e-spec.ts
// ═══════════════════════════════════════════════════════════════
// STG-001 Phase 4 — Tenant Isolation E2E
// ═══════════════════════════════════════════════════════════════
//
// يثبت أن:
// 1. Login يربط المستخدم بمدرسته فقط
// 2. /status/me يرجع بيانات المدرسة الصحيحة فقط
// 3. Admin A لا يستطيع الوصول لبيانات مدرسة ب عبر JWT
// ═══════════════════════════════════════════════════════════════

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let schoolAUuid: string;
  let schoolBUuid: string;
  let adminAToken: string;
  let adminASessionId: string;
  let adminBToken: string;

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

    // الحصول على UUIDs
    const schoolA = await prisma.school.findFirst({
      where: { schoolCode: 99001 },
      select: { uuid: true },
    });
    const schoolB = await prisma.school.findFirst({
      where: { schoolCode: 99002 },
      select: { uuid: true },
    });
    expect(schoolA).toBeTruthy();
    expect(schoolB).toBeTruthy();
    schoolAUuid = schoolA!.uuid;
    schoolBUuid = schoolB!.uuid;

    // Login admin A
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolAUuid,
        identifier: '1001',
        password: 'test-admin-123',
        deviceFingerprint: 'tenant-test-a',
        deviceType: 'WEB',
      });
    adminAToken = loginA.body.accessToken;
    adminASessionId = loginA.body.sessionId;

    // Login admin B
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolBUuid,
        identifier: '1001',
        password: 'test-admin-123',
        deviceFingerprint: 'tenant-test-b',
        deviceType: 'WEB',
      });
    adminBToken = loginB.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 1. JWT Payload يحتوي على المدرسة الصحيحة ──

  it('Admin A JWT contains School A uuid', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/status/me')
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);

    // يجب أن يرجع بيانات مدرسة أ فقط
    expect(res.body.school_uuid).toBeDefined();
    expect(res.body.school_uuid).toBe(schoolAUuid);
    expect(res.body.school_uuid).not.toBe(schoolBUuid);
  });

  it('Admin B JWT contains School B uuid', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/status/me')
      .set('Authorization', `Bearer ${adminBToken}`)
      .expect(200);

    expect(res.body.school_uuid).toBeDefined();
    expect(res.body.school_uuid).toBe(schoolBUuid);
    expect(res.body.school_uuid).not.toBe(schoolAUuid);
  });

  // ── 2. Login scoping: code 1001 في مدرسة ب يعطي admin مدرسة ب ──

  it('Code 1001 in School B returns School B admin (not School A)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/school/auth/login')
      .send({
        schoolUuid: schoolBUuid,
        identifier: '1001',
        password: 'test-admin-123',
        deviceFingerprint: 'cross-school-test',
        deviceType: 'WEB',
      })
      .expect(201);

    // يجب أن يكون المدرسة = ب وليس أ
    expect(res.body.school.uuid).toBe(schoolBUuid);
    expect(res.body.school.uuid).not.toBe(schoolAUuid);
    expect(res.body.user.userType).toBe('ADMIN');
  });

  // ── 3. Protected endpoint يرفض بدون JWT ──

  it('GET /api/v1/status/me — rejected without JWT', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/status/me')
      .expect(401);
  });

  // ── 4. DB-level: مدرسة أ لا تملك بيانات مدرسة ب ──

  it('School A users do not appear in School B scope', async () => {
    const schoolB = await prisma.school.findFirst({
      where: { schoolCode: 99002 },
      select: { id: true },
    });

    // البحث عن admin-a@test.invalid في مدرسة ب — يجب ألا يوجد
    const crossUser = await prisma.user.findFirst({
      where: {
        email: 'admin-a@test.invalid',
        schoolId: schoolB!.id,
      },
    });

    expect(crossUser).toBeNull();
  });

  it('Each school has its own users only', async () => {
    const schoolA = await prisma.school.findFirst({
      where: { schoolCode: 99001 },
      select: { id: true },
    });
    const schoolB = await prisma.school.findFirst({
      where: { schoolCode: 99002 },
      select: { id: true },
    });

    const usersA = await prisma.user.findMany({
      where: { schoolId: schoolA!.id, isDeleted: false },
      select: { email: true },
    });
    const usersB = await prisma.user.findMany({
      where: { schoolId: schoolB!.id, isDeleted: false },
      select: { email: true },
    });

    // مدرسة أ يجب أن تحتوي على *-a@test.invalid فقط
    expect(usersA.every(u => u.email!.includes('-a@'))).toBe(true);
    // مدرسة ب يجب أن تحتوي على *-b@test.invalid فقط
    expect(usersB.every(u => u.email!.includes('-b@'))).toBe(true);
    // لا تقاطع
    const emailsA = usersA.map(u => u.email);
    const emailsB = usersB.map(u => u.email);
    const intersection = emailsA.filter(e => emailsB.includes(e));
    expect(intersection.length).toBe(0);
  });
});
