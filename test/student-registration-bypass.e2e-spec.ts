import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PhoneRateLimiterService } from '../src/public/student-registration/phone-rate-limiter.service';

interface RegistrationResponse {
  registered?: boolean;
  autoLoginSuccess?: boolean;
  user?: { code?: number };
  accessToken?: string;
  refreshToken?: string;
  message?: string | string[];
}

describe('Student Registration Bypass HTTP E2E (supertest)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let phoneLimiter: PhoneRateLimiterService;
  let testContext: {
    provinceId: number;
    districtId: number;
    gradeId: number;
    schoolId: number;
  };

  const cleanupPhone = async (phone: string) => {
    const users = await prisma.user.findMany({ where: { phone } });
    for (const u of users) {
      await prisma.authSession.deleteMany({ where: { userId: u.id } });
      await prisma.userDevice.deleteMany({ where: { userId: u.id } });
      await prisma.studentEnrollment.deleteMany({ where: { studentId: u.id } });
      await prisma.student.deleteMany({ where: { userId: u.id } });
    }
    await prisma.user.deleteMany({ where: { phone } });
    await prisma.otpVerification.deleteMany({ where: { phone } });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const nestApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    nestApp.setGlobalPrefix('api/v1');
    nestApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    nestApp.set('trust proxy', true);

    await nestApp.init();
    app = nestApp;

    prisma = nestApp.get(PrismaService);
    phoneLimiter = nestApp.get(PhoneRateLimiterService);

    const routing = await prisma.mafhoomDistrictRouting.findFirst({
      where: { isActive: true },
    });
    if (!routing) throw new Error('No routing data in DB');

    const district = await prisma.district.findUnique({
      where: { id: routing.districtId },
    });
    const schoolCode = parseInt(process.env.MAFHOOM_SCHOOL_CODE || '0', 10);
    const school = await prisma.school.findFirst({
      where: { schoolCode, isDeleted: false },
    });
    if (!school) throw new Error('Mafhoom school not found');

    const grade = await prisma.schoolGrade.findFirst({
      where: { schoolId: school.id, isActive: true, isDeleted: false },
    });
    if (!grade) throw new Error('No grade found');

    testContext = {
      provinceId: district!.provinceId,
      districtId: district!.id,
      gradeId: grade.id,
      schoolId: school.id,
    };
  }, 30000);

  afterAll(async () => {
    delete process.env.STUDENT_REGISTRATION_OTP_ENABLED;
    if (app) {
      await app.close();
    }
  });

  describe('GET /api/v1/public/student-registration/config', () => {
    it('should return otpEnabled: true by default (when env is unset)', async () => {
      delete process.env.STUDENT_REGISTRATION_OTP_ENABLED;
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/student-registration/config')
        .expect(200);

      expect(res.body).toEqual({ otpEnabled: true });
    });

    it('should return otpEnabled: false when STUDENT_REGISTRATION_OTP_ENABLED=false', async () => {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/student-registration/config')
        .expect(200);

      expect(res.body).toEqual({ otpEnabled: false });
    });
  });

  describe('POST /api/v1/public/student-registration/complete-without-otp', () => {
    it('1. should reject with 403 Forbidden when OTP is enabled', async () => {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'true';

      const res = await request(app.getHttpServer())
        .post('/api/v1/public/student-registration/complete-without-otp')
        .send({
          phone: '+967771122334',
          name: 'طالب مرفوض',
          gender: 'MALE',
          provinceId: testContext.provinceId,
          districtId: testContext.districtId,
          gradeId: testContext.gradeId,
          password: 'password123',
        })
        .expect(403);

      const body = res.body as RegistrationResponse;
      expect(String(body.message)).toContain('OTP_BYPASS_NOT_ALLOWED');
    });

    it('2. should reject with 400 Bad Request via ValidationPipe when phone format is invalid', async () => {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';

      const res = await request(app.getHttpServer())
        .post('/api/v1/public/student-registration/complete-without-otp')
        .send({
          phone: '0771122334', // صيغة محلية غير مطابقة
          name: 'طالب بصيغة خاطئة',
          gender: 'MALE',
          provinceId: testContext.provinceId,
          districtId: testContext.districtId,
          gradeId: testContext.gradeId,
          password: 'password123',
        })
        .expect(400);

      const body = res.body as RegistrationResponse;
      expect(body.message).toBeDefined();
      const messages = Array.isArray(body.message)
        ? body.message.join(' ')
        : String(body.message);
      expect(messages).toContain('phone');
    });

    it('3. should successfully register student when OTP is disabled and payload is valid', async () => {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
      const testPhone = '+967779911001';
      await cleanupPhone(testPhone);
      await phoneLimiter.reset(testPhone);

      try {
        const res = await request(app.getHttpServer())
          .post('/api/v1/public/student-registration/complete-without-otp')
          .send({
            phone: testPhone,
            name: 'طالب مسجل عبر HTTP',
            gender: 'MALE',
            provinceId: testContext.provinceId,
            districtId: testContext.districtId,
            gradeId: testContext.gradeId,
            password: 'validPassword123',
          })
          .expect(201);

        const body = res.body as RegistrationResponse;
        expect(body.registered).toBe(true);
        expect(body.autoLoginSuccess).toBe(true);
        expect(body.user?.code).toBeGreaterThan(0);
        expect(body.accessToken).toBeDefined();
        expect(body.refreshToken).toBeDefined();
      } finally {
        await cleanupPhone(testPhone);
      }
    });

    it('4. should reject with 429 PHONE_RATE_LIMITED when phone rate limit is exceeded', async () => {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
      const phoneTest = '+967779911055';
      await cleanupPhone(phoneTest);
      await phoneLimiter.reset(phoneTest);

      let phoneThrottledRes: request.Response | null = null;
      for (let i = 1; i <= 6; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/public/student-registration/complete-without-otp')
          .set('X-Forwarded-For', `10.80.0.${i}`)
          .send({
            phone: phoneTest,
            name: `Phone Rate Limit ${i}`,
            gender: 'MALE',
            provinceId: testContext.provinceId,
            districtId: 999999, // district غير صالح يفشل قبل الـ transaction
            gradeId: testContext.gradeId,
            password: 'validPassword123',
          });

        if (i === 6) {
          phoneThrottledRes = res;
        }
      }

      expect(phoneThrottledRes).not.toBeNull();
      expect(phoneThrottledRes!.status).toBe(429);
      expect(JSON.stringify(phoneThrottledRes!.body)).toContain(
        'PHONE_RATE_LIMITED',
      );
      await phoneLimiter.reset(phoneTest);
      await cleanupPhone(phoneTest);
    });

    it('5. should reject with 429 Too Many Requests when IP rate limit is exceeded', async () => {
      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';

      const responses: request.Response[] = [];
      const sharedIp = '10.99.1.50';
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/public/student-registration/complete-without-otp')
          .set('X-Forwarded-For', sharedIp)
          .send({
            phone: `+96777991199${i}`,
            name: `Throttled IP ${i}`,
            gender: 'MALE',
            provinceId: testContext.provinceId,
            districtId: testContext.districtId,
            gradeId: testContext.gradeId,
            password: 'validPassword123',
          });
        responses.push(res);
      }

      const throttledResponses = responses.filter((r) => r.status === 429);
      expect(throttledResponses.length).toBeGreaterThanOrEqual(1);
    });
  });
});
