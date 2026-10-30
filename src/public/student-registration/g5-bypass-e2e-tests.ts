// G5-bypass — E2E Service Tests for completeRegistrationWithoutOtp
// يختبر المسار المباشر بدون OTP + حراسة الـ Guard + مشاركة المنطق مع المسار الأصلي

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentRegistrationService } from './student-registration.service';
import { StudentRegistrationModule } from './student-registration.module';
import { createHmac, randomUUID } from 'crypto';
import { OTP_DEFAULTS } from '../../shared/otp/otp.constants';
import { PhoneRateLimiterService } from './phone-rate-limiter.service';
import * as bcrypt from 'bcrypt';

// ─── Helpers (مشتركة مع g4-e2e-tests) ──────────────────────────

async function createVerifiedOtp(prisma: PrismaService, phone: string) {
  const token = randomUUID() + randomUUID();
  const tokenHash = createHmac('sha256', OTP_DEFAULTS.pepper).update(token).digest('hex');
  const requestId = randomUUID();

  await prisma.otpVerification.create({
    data: {
      phone,
      codeHash: 'test-hash',
      purpose: 'STUDENT_REGISTRATION',
      channel: 'WHATSAPP',
      registrationRequestId: requestId,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 300_000),
      status: 'VERIFIED',
      verifiedAt: new Date(),
      registrationTokenHash: tokenHash,
      registrationTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });

  return { token, requestId };
}

async function getTestContext(prisma: PrismaService) {
  const routing = await prisma.mafhoomDistrictRouting.findFirst({ where: { isActive: true } });
  if (!routing) throw new Error('No routing data');

  const district = await prisma.district.findUnique({ where: { id: routing.districtId } });
  const province = await prisma.province.findUnique({ where: { id: district!.provinceId } });

  const schoolCode = parseInt(process.env.MAFHOOM_SCHOOL_CODE || '0', 10);
  const school = await prisma.school.findFirst({ where: { schoolCode, isDeleted: false } });
  if (!school) throw new Error('Mafhoom school not found');

  const grade = await prisma.schoolGrade.findFirst({
    where: { schoolId: school.id, isActive: true, isDeleted: false },
  });
  if (!grade) throw new Error('No grade found');

  return { school, province: province!, district: district!, grade, routing };
}

async function cleanupPhone(prisma: PrismaService, phone: string) {
  const users = await prisma.user.findMany({ where: { phone } });
  for (const u of users) {
    await prisma.authSession.deleteMany({ where: { userId: u.id } });
    await prisma.userDevice.deleteMany({ where: { userId: u.id } });
    await prisma.studentEnrollment.deleteMany({ where: { studentId: u.id } });
    await prisma.student.deleteMany({ where: { userId: u.id } });
  }
  await prisma.user.deleteMany({ where: { phone } });
  await prisma.otpVerification.deleteMany({ where: { phone } });
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  // ── تأكد أن الـ bypass مفعّل في بيئة الاختبار ──
  if (process.env.STUDENT_REGISTRATION_OTP_ENABLED !== 'false') {
    console.error(
      '❌ ABORT: يجب تشغيل هذا الاختبار مع STUDENT_REGISTRATION_OTP_ENABLED=false\n' +
      '   مثال: STUDENT_REGISTRATION_OTP_ENABLED=false npx ts-node src/public/student-registration/g5-bypass-e2e-tests.ts',
    );
    process.exit(1);
  }

  const moduleRef = await Test.createTestingModule({
    imports: [StudentRegistrationModule],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();

  const service = moduleRef.get(StudentRegistrationService);
  const prisma = moduleRef.get(PrismaService);

  const ctx = await getTestContext(prisma);

  const baseDto = {
    gender: 'MALE' as const,
    provinceId: ctx.province.id,
    districtId: ctx.district.id,
    gradeId: ctx.grade.id,
    password: 'test1234',
  };

  console.log('\n════════════════════════════════════════════');
  console.log('  G5-Bypass — E2E Tests (OTP disabled mode)');
  console.log('════════════════════════════════════════════\n');

  // ─── C-01: GET /config returns otpEnabled: false ──────────────

  console.log('C-01 — getRegistrationConfig() يعيد otpEnabled: false');
  const config = await service.getRegistrationConfig();
  const c01pass = config.otpEnabled === false;
  console.log(`  otpEnabled: ${config.otpEnabled} (expected false)`);
  console.log(`  ${c01pass ? '✅ C-01 PASS' : '❌ C-01 FAIL'}`);

  // ─── B-01: Guard — يرفض عند تفعيل OTP ────────────────────────

  console.log('\nB-01 — Guard: يجب أن يرفض OTP_BYPASS_NOT_ALLOWED عند تفعيل OTP ديناميكياً');
  process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'true';
  let b01pass = false;
  try {
    await service.completeRegistrationWithoutOtp({
      ...baseDto,
      phone: '+967777881999',
      name: 'محاولة أثناء تفعيل OTP',
    });
  } catch (e: any) {
    b01pass = e.message?.includes('OTP_BYPASS_NOT_ALLOWED') || e.response?.message === 'OTP_BYPASS_NOT_ALLOWED';
    console.log(`  Caught expected error: ${e.message}`);
  } finally {
    process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
  }
  console.log(`  ${b01pass ? '✅ B-01 PASS' : '❌ B-01 FAIL'}`);

  // ─── B-02: تسجيل ناجح بدون OTP ───────────────────────────────

  console.log('\nB-02 — تسجيل ناجح بدون OTP (بيانات صحيحة)');
  const phone02 = '+967777881001';
  await cleanupPhone(prisma, phone02);

  try {
    const result = await service.completeRegistrationWithoutOtp({
      ...baseDto,
      phone: phone02,
      name: 'طالب مباشر',
    });

    const b02pass =
      result.registered === true &&
      typeof result.user?.code === 'number' &&
      result.user.code > 0 &&
      !!result.school?.uuid;

    console.log(`  registered: ${result.registered} (expected true)`);
    console.log(`  user.code: ${result.user?.code}`);
    console.log(`  autoLoginSuccess: ${result.autoLoginSuccess}`);
    console.log(`  has accessToken: ${!!result.accessToken}`);
    console.log(`  ${b02pass ? '✅ B-02 PASS' : '❌ B-02 FAIL'}`);
  } catch (e: any) {
    console.log(`  ❌ B-02 FAIL: ${e.message}`);
  } finally {
    await cleanupPhone(prisma, phone02);
  }

  // ─── B-03: رقم مسجل مسبقاً ───────────────────────────────────

  console.log('\nB-03 — رقم هاتف مسجل مسبقاً → PHONE_ALREADY_REGISTERED');
  const phone03 = '+967777881002';
  await cleanupPhone(prisma, phone03);

  // أنشئ طالباً بهذا الرقم مسبقاً
  const ph03hash = await bcrypt.hash('test', 10);
  const existing03 = await prisma.user.create({
    data: {
      schoolId: ctx.school.id,
      userType: 'STUDENT',
      code: 88020,
      name: 'موجود مسبقاً',
      passwordHash: ph03hash,
      phone: phone03,
      isActive: true,
    },
  });

  try {
    await service.completeRegistrationWithoutOtp({
      ...baseDto,
      phone: phone03,
      name: 'محاولة تكرار',
    });
    console.log('  ❌ B-03 FAIL: يجب أن يرفض');
  } catch (e: any) {
    const b03pass = e.message?.includes('PHONE_ALREADY_REGISTERED');
    console.log(`  Error: ${e.message?.substring(0, 60)}`);
    console.log(`  ${b03pass ? '✅ B-03 PASS' : '❌ B-03 FAIL (unexpected error)'}`);
  } finally {
    await prisma.authSession.deleteMany({ where: { userId: existing03.id } });
    await prisma.userDevice.deleteMany({ where: { userId: existing03.id } });
    await prisma.studentEnrollment.deleteMany({ where: { studentId: existing03.id } });
    await prisma.student.deleteMany({ where: { userId: existing03.id } });
    await prisma.user.delete({ where: { id: existing03.id } });
    await cleanupPhone(prisma, phone03);
  }

  // ─── B-04: تزامن — نفس الرقم من طلبين متزامنين ──────────────

  console.log('\nB-04 — طلبان متزامنان بنفس الرقم → نجاح واحد فقط');
  const phone04 = '+967777881003';
  await cleanupPhone(prisma, phone04);

  const [r04a, r04b] = await Promise.allSettled([
    service.completeRegistrationWithoutOtp({ ...baseDto, phone: phone04, name: 'Conc-Direct-A' }),
    service.completeRegistrationWithoutOtp({ ...baseDto, phone: phone04, name: 'Conc-Direct-B' }),
  ]);

  const s04 = [r04a, r04b].filter(r => r.status === 'fulfilled');
  const f04 = [r04a, r04b].filter(r => r.status === 'rejected');
  const count04 = await prisma.user.count({
    where: { phone: phone04, schoolId: ctx.school.id, userType: 'STUDENT', isDeleted: false },
  });

  console.log(`  Successes: ${s04.length} (expected 1)`);
  console.log(`  Failures: ${f04.length} (expected 1)`);
  if (f04.length > 0) console.log(`  Failure: ${(f04[0] as any).reason?.message?.substring(0, 60)}`);
  console.log(`  Students created: ${count04} (expected 1)`);
  console.log(`  ${s04.length === 1 && count04 === 1 ? '✅ B-04 PASS' : '❌ B-04 FAIL'}`);

  await cleanupPhone(prisma, phone04);

  // ─── B-05: التوافق مع المسار الأصلي (OTP path لا يتأثر) ──────

  console.log('\nB-05 — المسار الأصلي (OTP) يعمل بجانب المسار الجديد');
  const phone05 = '+967777881004';
  await cleanupPhone(prisma, phone05);

  const otp05 = await createVerifiedOtp(prisma, phone05);
  try {
    const result05 = await service.completeRegistration({
      ...baseDto,
      registrationToken: otp05.token,
      name: 'طالب عبر OTP',
    });

    const b05pass = result05.registered === true && !!result05.user?.code;
    console.log(`  registered: ${result05.registered} (expected true)`);
    console.log(`  user.code: ${result05.user?.code}`);
    console.log(`  ${b05pass ? '✅ B-05 PASS' : '❌ B-05 FAIL'}`);
  } catch (e: any) {
    console.log(`  ❌ B-05 FAIL: ${e.message}`);
  } finally {
    await cleanupPhone(prisma, phone05);
  }

  // ─── B-06: تدقيق هاتف غير صالح ───────────────────────────────

  console.log('\nB-06 — رقم هاتف بصيغة غير صالحة (DTO validation)');
  // لا يمكن اختبار class-validator مباشرة على Service، يُختبر عبر HTTP فقط
  console.log('  ℹ️  يُختبر على مستوى HTTP Controller عبر ValidationPipe');
  console.log('  ℹ️  الصيغة الصالحة: +XXXXXXXXX (E.164 بسيط)');

  // ─── B-07: Phone Rate Limiting ───────────────────────────────

  console.log('\nB-07 — Phone Rate Limiting: تجاوز حد المحاولات لنفس الهاتف → 429 PHONE_RATE_LIMITED');
  const phone07 = '+967777881007';
  await cleanupPhone(prisma, phone07);
  const phoneLimiter = moduleRef.get(PhoneRateLimiterService);
  await phoneLimiter.reset(phone07);

  // نرسل طلبات بمدخلات تفشل (districtId غير موجود) لنثبت أن التقييد يعمل قبل الوصول إلى المعاملة
  let b07Throttled = false;
  for (let i = 1; i <= 6; i++) {
    try {
      await service.completeRegistrationWithoutOtp({
        ...baseDto,
        districtId: 999999, // district غير صالح
        phone: phone07,
        name: `RateLimit-Test-${i}`,
      });
    } catch (e: any) {
      if (i <= 5) {
        // المحاولات الأولى تفشل بسبب DISTRICT_NOT_FOUND
        if (e.message?.includes('PHONE_RATE_LIMITED')) {
          console.log(`  ❌ Premature rate limit at attempt ${i}`);
        }
      } else {
        // المحاولة السادسة تفشل بسبب تجاوز حد الهاتف (PHONE_RATE_LIMITED)
        b07Throttled =
          e.message?.includes('PHONE_RATE_LIMITED') ||
          e.response?.message === 'PHONE_RATE_LIMITED' ||
          e.status === 429;
        console.log(`  Attempt 6 error (expected PHONE_RATE_LIMITED): ${e.message || e.response?.message}`);
      }
    }
  }
  console.log(`  ${b07Throttled ? '✅ B-07 PASS' : '❌ B-07 FAIL'}`);
  await phoneLimiter.reset(phone07);
  await cleanupPhone(prisma, phone07);

  // ─── C-02: config يعيد true عند تفعيل OTP ديناميكياً ──────────

  console.log('\nC-02 — getRegistrationConfig() يعيد otpEnabled: true عند تفعيل OTP');
  process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'true';
  const configActive = await service.getRegistrationConfig();
  const c02pass = configActive.otpEnabled === true;
  console.log(`  otpEnabled: ${configActive.otpEnabled} (expected true)`);
  console.log(`  ${c02pass ? '✅ C-02 PASS' : '❌ C-02 FAIL'}`);
  process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';

  console.log('\n🎉 G5-Bypass E2E tests completed!\n');

  await app.close();
}

main().catch(e => {
  console.error('❌ FATAL:', e);
  process.exit(1);
});
