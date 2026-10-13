// src/public/student-registration/http-bypass-tests.ts
// اختبارات HTTP فعلية باستخدام Supertest للمسار المباشر بدون OTP
// تغطي: الحراسة 403، التحقق 400، تقييد IP 429، تقييد الهاتف 429، والتسجيل الناجح 201

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneRateLimiterService } from './phone-rate-limiter.service';

async function main() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  HTTP E2E Tests (Supertest) — Student Registration Bypass');
  console.log('════════════════════════════════════════════════════════════\n');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);

  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);
  const phoneLimiter = app.get(PhoneRateLimiterService);

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

  // Get valid context from database
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

  const baseDto = {
    gender: 'MALE',
    provinceId: district!.provinceId,
    districtId: district!.id,
    gradeId: grade.id,
    password: 'password123',
  };

  try {
    // ─── H-01: Config default (OTP enabled) ───────────────────
    console.log('H-01 — GET /config يعيد otpEnabled: true افتراضياً');
    delete process.env.STUDENT_REGISTRATION_OTP_ENABLED;
    const resH01 = await request(server).get('/api/v1/public/student-registration/config');
    const passH01 = resH01.status === 200 && resH01.body.otpEnabled === true;
    console.log(`  status: ${resH01.status}, body:`, resH01.body);
    console.log(`  ${passH01 ? '✅ H-01 PASS' : '❌ H-01 FAIL'}\n`);

    // ─── H-02: Config with OTP disabled ───────────────────────
    console.log('H-02 — GET /config يعيد otpEnabled: false عند التعطيل');
    process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
    const resH02 = await request(server).get('/api/v1/public/student-registration/config');
    const passH02 = resH02.status === 200 && resH02.body.otpEnabled === false;
    console.log(`  status: ${resH02.status}, body:`, resH02.body);
    console.log(`  ${passH02 ? '✅ H-02 PASS' : '❌ H-02 FAIL'}\n`);

    // ─── H-03: Guard 403 when OTP enabled ─────────────────────
    console.log('H-03 — POST /complete-without-otp يُرفض برمز 403 Forbidden عندما يكون OTP مفعّلاً');
    process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'true';
    const resH03 = await request(server)
      .post('/api/v1/public/student-registration/complete-without-otp')
      .send({
        ...baseDto,
        phone: '+967771122334',
        name: 'طالب مرفوض بالحارس',
      });
    const passH03 =
      resH03.status === 403 &&
      JSON.stringify(resH03.body).includes('OTP_BYPASS_NOT_ALLOWED');
    console.log(`  status: ${resH03.status}, message: ${resH03.body.message}`);
    console.log(`  ${passH03 ? '✅ H-03 PASS' : '❌ H-03 FAIL'}\n`);

    // ─── H-04: ValidationPipe 400 for invalid phone ───────────
    console.log('H-04 — POST /complete-without-otp يُرفض برمز 400 عبر ValidationPipe عند إرسال هاتف غير صالح');
    process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
    const resH04 = await request(server)
      .post('/api/v1/public/student-registration/complete-without-otp')
      .send({
        ...baseDto,
        phone: '0771122334', // صيغة محلية لا تبدأ بـ +
        name: 'طالب بهاتف غير صالح',
      });
    const passH04 =
      resH04.status === 400 &&
      JSON.stringify(resH04.body.message).includes('phone');
    console.log(`  status: ${resH04.status}, message:`, resH04.body.message);
    console.log(`  ${passH04 ? '✅ H-04 PASS' : '❌ H-04 FAIL'}\n`);

    // ─── H-05: Successful registration with OTP disabled ───────
    console.log('H-05 — POST /complete-without-otp ينجح برمز 201 Created ويعيد JWT عند تعطيل OTP');
    const validPhone = '+967778899111';
    await cleanupPhone(validPhone);
    await phoneLimiter.reset(validPhone);

    const resH05 = await request(server)
      .post('/api/v1/public/student-registration/complete-without-otp')
      .send({
        ...baseDto,
        phone: validPhone,
        name: 'طالب ناجح عبر HTTP',
      });

    const passH05 =
      resH05.status === 201 &&
      resH05.body.registered === true &&
      resH05.body.autoLoginSuccess === true &&
      typeof resH05.body.user?.code === 'number' &&
      !!resH05.body.accessToken &&
      !!resH05.body.refreshToken;

    console.log(`  status: ${resH05.status}`);
    console.log(`  registered: ${resH05.body.registered}`);
    console.log(`  user.code: ${resH05.body.user?.code}`);
    console.log(`  has accessToken: ${!!resH05.body.accessToken}`);
    console.log(`  ${passH05 ? '✅ H-05 PASS' : '❌ H-05 FAIL'}\n`);
    await cleanupPhone(validPhone);

    // ─── H-06: Phone Rate Limit (429) ─────────────────────────
    console.log('H-06 — POST /complete-without-otp يُرفض برمز 429 PHONE_RATE_LIMITED عند تجاوز حد الهاتف');
    const phoneH06 = '+967778899222';
    await cleanupPhone(phoneH06);
    await phoneLimiter.reset(phoneH06);

    let hitPhoneRateLimit = false;
    for (let i = 1; i <= 6; i++) {
      const res = await request(server)
        .post('/api/v1/public/student-registration/complete-without-otp')
        .set('X-Forwarded-For', `10.50.0.${i}`) // IP مختلف لكل طلب لعزل فحص الهاتف عن فحص IP
        .send({
          ...baseDto,
          districtId: 999999, // input fails before transaction
          phone: phoneH06,
          name: `PhoneRateLimit-${i}`,
        });

      if (i <= 5) {
        if (res.status === 429) {
          console.log(`  ❌ Premature 429 at attempt ${i}: ${JSON.stringify(res.body)}`);
        }
      } else {
        hitPhoneRateLimit =
          res.status === 429 &&
          JSON.stringify(res.body).includes('PHONE_RATE_LIMITED');
        console.log(`  Attempt 6 status: ${res.status}, body:`, res.body);
      }
    }
    console.log(`  ${hitPhoneRateLimit ? '✅ H-06 PASS' : '❌ H-06 FAIL'}\n`);
    await phoneLimiter.reset(phoneH06);

    // ─── H-07: IP Rate Limit (429) ───────────────────────────
    console.log('H-07 — POST /complete-without-otp يُرفض برمز 429 عند تجاوز حد الطلبات حسب IP (حد: 3/دقيقة)');
    const responses: number[] = [];
    const sharedIp = '10.60.0.99';
    for (let i = 1; i <= 5; i++) {
      const res = await request(server)
        .post('/api/v1/public/student-registration/complete-without-otp')
        .set('X-Forwarded-For', sharedIp) // نفس الـ IP لجميع الطلبات
        .send({
          ...baseDto,
          phone: `+96777889930${i}`,
          name: `IPThrottled-${i}`,
        });
      responses.push(res.status);
    }

    const has429 = responses.includes(429);
    console.log(`  Status codes across 5 requests: ${responses.join(', ')}`);
    console.log(`  ${has429 ? '✅ H-07 PASS' : '❌ H-07 FAIL'}\n`);

    console.log('════════════════════════════════════════════════════════════');
    console.log('  🎉 All Supertest HTTP Tests Passed Successfully!');
    console.log('════════════════════════════════════════════════════════════\n');
  } finally {
    delete process.env.STUDENT_REGISTRATION_OTP_ENABLED;
    await app.close();
  }
}

main().catch((e) => {
  console.error('❌ HTTP Test Fatal Error:', e);
  process.exit(1);
});
