// src/public/student-registration/student-registration.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from '../../shared/otp/otp.service';
import { REGISTRATION_ERRORS, REGISTRATION_CONFIG } from './registration.constants';
import { SCHOOL_AUTH_JWT } from '../../school/auth/constants';
import { SessionsService } from '../../school/sessions/sessions.service';
import { createHmac } from 'crypto';
import { OTP_DEFAULTS } from '../../shared/otp/otp.constants';
import { OtpStatus } from '@prisma/client';
import { randomToken } from '../../school/auth/utils/crypto.util';
import { CheckPhoneDto } from './dto/check-phone.dto';
import { CompleteWithoutOtpDto } from './dto/complete-without-otp.dto';
import { PhoneRateLimiterService } from './phone-rate-limiter.service';
import { SubscriptionTrialService } from '../../school/common/subscription/subscription-trial.service';

// ─── Internal shared types ────────────────────────────────────

/**
 * الحقول المشتركة بين مساري complete و complete-without-otp
 */
interface RegistrationPayload {
  phone: string;          // رقم مُعيَّر (normalized)
  name: string;
  gender: string;
  provinceId: number;
  districtId: number;
  gradeId: number;
  password: string;
  externalSchoolName?: string | null; // URS-REG-005: اسم المدرسة الفعلية (اختياري)
}

/**
 * URS-REG-005: تنظيف اسم المدرسة — نص فارغ أو مسافات فقط ← null
 */
function normalizeExternalSchoolName(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed.slice(0, 150) : null;
}

/**
 * نتيجة الخطوة داخل المعاملة قبل إنشاء الـ Session
 */
interface TransactionResult {
  userId: number;
  userUuid: string;
  code: number;
  displayName: string;
  schoolId: number;
  schoolUuid: string;
  schoolDisplayName: string;
  schoolCode: number;
}

@Injectable()
export class StudentRegistrationService {
  private readonly logger = new Logger('StudentRegistrationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
    private readonly phoneRateLimiter: PhoneRateLimiterService,
    private readonly trialService: SubscriptionTrialService,
  ) {}

  // ─── UX Phone Checking ───────────────────────────────────────

  /**
   * فحص سريع مبدئي (UX Optimization) لمعرفة حالة الرقم في مدرسة مفهوم.
   * لا يحل هذا محل الفحص النهائي في completeRegistration.
   *
   * URS-REG-004: لا يمنع التسجيل — يُرجع معلومات تنبيهية فقط.
   * لا يكشف عدد الحسابات المرتبطة بالرقم.
   */
  async checkPhoneRegistration(dto: CheckPhoneDto) {
    const normalizedPhone = this.otpService.normalizePhone(dto.phone);

    const mafhoomSchool = await this.prisma.school.findFirst({
      where: {
        schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
        isDeleted: false,
      },
    });

    if (!mafhoomSchool) {
      throw new InternalServerErrorException(REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND);
    }

    const existingCount = await this.prisma.user.count({
      where: {
        schoolId: mafhoomSchool.id,
        userType: 'STUDENT',
        phone: normalizedPhone,
        isDeleted: false,
      },
    });

    const maxAccounts = REGISTRATION_CONFIG.maxAccountsPerPhone;
    const limitReached = maxAccounts > 0 && existingCount >= maxAccounts;

    return {
      registered: existingCount > 0,
      limitReached,
      school: existingCount > 0
        ? { uuid: mafhoomSchool.uuid, displayName: mafhoomSchool.displayName }
        : undefined,
    };
  }

  // ─── Config ──────────────────────────────────────────────────

  /**
   * إعادة وضع تشغيل OTP في مسار التسجيل الذاتي.
   * يُستخدم من Flutter لاتخاذ قرار عرض/إخفاء شاشة OTP.
   * الافتراضي الآمن: true (OTP مفعّل) عند غياب المتغير.
   *
   * يُرجع أيضاً الهوية العامة لمدرسة مفهوم (بحسب بيئة السيرفر)
   * لاستخدامها في واجهة الترحيب بالتطبيق العام.
   * لا يرمي خطأ عند غياب المدرسة — يُرجع school: null حتى لا يتعطل مسار OTP.
   */
  async getRegistrationConfig() {
    const school = await this.prisma.school.findFirst({
      where: {
        schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
        isDeleted: false,
        isActive: true,
      },
      select: { uuid: true, schoolCode: true, displayName: true },
    });

    return {
      otpEnabled: OTP_DEFAULTS.isStudentRegistrationOtpEnabled,
      school: school ?? null,
    };
  }

  // ─── Token Validation ──────────────────────────────────────

  /**
   * التحقق من Registration Token والحصول على الهاتف المُوثّق
   */
  private async validateRegistrationToken(token: string) {
    const tokenHash = createHmac('sha256', OTP_DEFAULTS.pepper).update(token).digest('hex');

    // ابحث بالـ hash (لا نخزن plaintext)
    // نستخدم raw query لأن Prisma لا يدعم findFirst على حقل non-unique بدون index
    const records = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, phone, status, registration_token_expires_at, registration_request_id
       FROM otp_verifications
       WHERE registration_token_hash = $1
       LIMIT 1`,
      tokenHash,
    );

    if (!records || records.length === 0) {
      throw new BadRequestException(REGISTRATION_ERRORS.TOKEN_INVALID);
    }

    const record = records[0];

    if (record.status !== 'VERIFIED') {
      throw new BadRequestException(REGISTRATION_ERRORS.TOKEN_INVALID);
    }

    const expiresAt = new Date(record.registration_token_expires_at);
    if (new Date() > expiresAt) {
      throw new BadRequestException(REGISTRATION_ERRORS.TOKEN_EXPIRED);
    }

    return {
      otpId: record.id as number,
      phone: record.phone as string,
      registrationRequestId: record.registration_request_id as string,
    };
  }

  // ─── Shared: Pre-transaction Validation ───────────────────

  /**
   * التحقق من المحافظة والمديرية ومدرسة مفهوم (خارج المعاملة — لا تعديل على DB)
   * مشترك بين completeRegistration و completeWithoutOtp
   */
  private async resolvePreconditions(payload: Pick<RegistrationPayload, 'provinceId' | 'districtId'>) {
    const province = await this.prisma.province.findUnique({
      where: { id: payload.provinceId },
    });
    if (!province) throw new NotFoundException(REGISTRATION_ERRORS.PROVINCE_NOT_FOUND);

    const district = await this.prisma.district.findFirst({
      where: { id: payload.districtId, provinceId: payload.provinceId },
    });
    if (!district) throw new NotFoundException(REGISTRATION_ERRORS.DISTRICT_NOT_FOUND);

    const mafhoomSchool = await this.prisma.school.findFirst({
      where: {
        schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
        isDeleted: false,
      },
    });
    if (!mafhoomSchool) {
      throw new InternalServerErrorException(REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND);
    }

    const routing = await this.prisma.mafhoomDistrictRouting.findUnique({
      where: { districtId: payload.districtId },
    });
    if (!routing || !routing.isActive) {
      throw new NotFoundException(REGISTRATION_ERRORS.ROUTING_NOT_FOUND);
    }

    return { province, district, mafhoomSchool, routing };
  }

  // ─── Shared: Atomic Transaction ───────────────────────────

  /**
   * المعاملة الذرية الموحَّدة لإنشاء الحساب والتسجيل المدرسي.
   * تُستخدم من كلا المسارين (OTP + بدون OTP).
   *
   * @param payload   بيانات الطالب (رقم الهاتف مُعيَّر مسبقاً)
   * @param otpId     معرف سجل OTP إذا كان المسار عبر OTP، أو null في المسار المباشر
   */
  private async executeRegistrationTransaction(
    payload: RegistrationPayload,
    preconditions: Awaited<ReturnType<typeof StudentRegistrationService.prototype.resolvePreconditions>>,
    passwordHash: string,
    otpId: number | null,
  ): Promise<TransactionResult> {
    const { province, district, mafhoomSchool, routing } = preconditions;

    return this.prisma.$transaction(async (tx) => {
      // 1. Advisory Lock on (mafhoomSchoolId, normalizedPhone)
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `reg:${mafhoomSchool.id}:${payload.phone}`,
      );

      // 2. Re-validate current year (inside transaction per chat155 requirement)
      const currentYear = await tx.year.findFirst({
        where: { schoolId: mafhoomSchool.id, isCurrent: true, isDeleted: false },
      });
      if (!currentYear) {
        throw new BadRequestException(REGISTRATION_ERRORS.NO_CURRENT_YEAR);
      }

      // 3. Re-validate grade exists for Mafhoom school
      const grade = await tx.schoolGrade.findFirst({
        where: { id: payload.gradeId, schoolId: mafhoomSchool.id, isActive: true, isDeleted: false },
      });
      if (!grade) {
        throw new NotFoundException(REGISTRATION_ERRORS.GRADE_NOT_FOUND);
      }

      // 4. Resolve section by grade + targetSection from routing
      const section = await tx.section.findFirst({
        where: {
          gradeId: payload.gradeId,
          name: routing.targetSection,
          isActive: true,
          isDeleted: false,
        },
      });
      if (!section) {
        throw new NotFoundException(REGISTRATION_ERRORS.SECTION_NOT_FOUND);
      }

      // ──── 5a. منع تكرار الطالب: نفس الهاتف + الاسم + الصف ────
      //      حماية من تسجيل نفس الشخص مرتين ومن إعادة إرسال الطلب (network retry).
      //      ملاحظة: هذا ليس idempotency كامل (لا يُرجع النتيجة السابقة).
      const duplicateStudent = await tx.user.findFirst({
        where: {
          schoolId: mafhoomSchool.id,
          userType: 'STUDENT',
          phone: payload.phone,
          name: payload.name,
          isDeleted: false,
          student: {
            enrollments: {
              some: {
                gradeId: payload.gradeId,
                isCurrent: true,
                isDeleted: false,
              },
            },
          },
        },
        select: { id: true },
      });
      if (duplicateStudent) {
        throw new ForbiddenException(REGISTRATION_ERRORS.DUPLICATE_STUDENT_DETECTED);
      }

      // ──── 5b. حد أقصى لعدد الحسابات لكل رقم هاتف ────
      const maxAccounts = REGISTRATION_CONFIG.maxAccountsPerPhone;
      if (maxAccounts > 0) {
        const phoneAccountsCount = await tx.user.count({
          where: {
            schoolId: mafhoomSchool.id,
            userType: 'STUDENT',
            phone: payload.phone,
            isDeleted: false,
          },
        });
        if (phoneAccountsCount >= maxAccounts) {
          throw new ForbiddenException(REGISTRATION_ERRORS.PHONE_ACCOUNTS_LIMIT_REACHED);
        }
      }

      // 6. Generate school number (atomic increment)
      const updatedSchool = await tx.school.update({
        where: { id: mafhoomSchool.id },
        data: { nextUserCode: { increment: 1 } },
        select: { nextUserCode: true },
      });
      const code = updatedSchool.nextUserCode - 1;

      // 7. Create User
      const user = await tx.user.create({
        data: {
          schoolId: mafhoomSchool.id,
          userType: 'STUDENT',
          code,
          name: payload.name,
          displayName: payload.name,
          gender: payload.gender,
          phone: payload.phone,
          province: province.name,
          district: district.name,
          passwordHash,
          isActive: true,
        },
      });

      // 8. Create Student
      await tx.student.create({
        data: {
          userId: user.id,
          externalSchoolName: normalizeExternalSchoolName(payload.externalSchoolName),
        },
      });

      // 9. Create Enrollment
      await tx.studentEnrollment.create({
        data: {
          studentId: user.id,
          yearId: currentYear.id,
          gradeId: payload.gradeId,
          sectionId: section.id,
          status: 'ACTIVE',
          isCurrent: true,
          joinedAt: new Date(),
        },
      });

      // 9.5 فترة تجربة الاشتراك — خطة التنفيذ §2.3.1
      //     صف المدرسة مقفل مسبقاً (tx.school.update في الخطوة 6).
      //     لا يفعل شيئاً إن لم تفعّل المدرسة الاشتراك أو كانت التجربة معطّلة.
      await this.trialService.createTrialForNewStudentTx(tx, mafhoomSchool.id, user.id, new Date());

      // 10. Consume OTP if applicable (mark as CONSUMED)
      if (otpId !== null) {
        await tx.otpVerification.updateMany({
          where: { id: otpId, status: OtpStatus.VERIFIED },
          data: { status: OtpStatus.CONSUMED, consumedAt: new Date() },
        });
      }

      this.logger.log(
        `Student registered: ${user.uuid} [code=${code}] phone=${payload.phone} via=${otpId !== null ? 'otp' : 'direct'}`,
      );

      return {
        userId: user.id,
        userUuid: user.uuid,
        code,
        displayName: user.displayName ?? user.name,
        schoolId: mafhoomSchool.id,
        schoolUuid: mafhoomSchool.uuid,
        schoolDisplayName: (mafhoomSchool as any).displayName ?? mafhoomSchool.name,
        schoolCode: mafhoomSchool.schoolCode,
      };
    });
  }

  // ─── Shared: Session & JWT ────────────────────────────────

  /**
   * إنشاء Session وتوليد JWT بعد نجاح التسجيل.
   * مشترك بين المسارين. عند فشل Session لا نُلغي التسجيل.
   */
  private async buildRegistrationResponse(result: TransactionResult) {
    try {
      const refreshPlain = randomToken(48);

      const device = await this.sessions.upsertDevice({
        userId: result.userId,
        deviceFingerprint: `self-reg-${result.userUuid}`,
        deviceType: 'ANDROID',
      });

      const session = await this.sessions.createSession({
        userId: result.userId,
        schoolId: result.schoolId,
        deviceId: device.id,
        refreshTokenPlain: refreshPlain,
      });

      const accessToken = this.jwt.sign(
        {
          sub: result.userUuid,
          ut: 'STUDENT',
          sc: result.schoolUuid,
          sid: session.uuid,
          uc: result.code,
        },
        {
          expiresIn: SCHOOL_AUTH_JWT.accessTokenTtlSec,
          issuer: SCHOOL_AUTH_JWT.issuer,
          audience: SCHOOL_AUTH_JWT.audience,
        },
      );

      const refreshExpiresAt = new Date(
        Date.now() + SCHOOL_AUTH_JWT.refreshTokenTtlSec * 1000,
      );

      return {
        registered: true,
        autoLoginSuccess: true,
        user: {
          uuid: result.userUuid,
          code: result.code,
          displayName: result.displayName,
        },
        school: {
          uuid: result.schoolUuid,
          displayName: result.schoolDisplayName,
          schoolCode: result.schoolCode,
        },
        accessToken,
        refreshToken: refreshPlain,
        refreshExpiresAt: refreshExpiresAt.toISOString(),
        sessionId: session.uuid,
      };
    } catch (error) {
      // التسجيل نجح لكن إنشاء Session فشل
      this.logger.error(
        `Registration succeeded but AuthSession failed for ${result.userUuid}: ${error}`,
      );

      return {
        registered: true,
        autoLoginSuccess: false,
        user: {
          uuid: result.userUuid,
          code: result.code,
          displayName: result.displayName,
        },
        school: {
          uuid: result.schoolUuid,
          displayName: result.schoolDisplayName,
          schoolCode: result.schoolCode,
        },
        message: 'تم إنشاء الحساب بنجاح. يرجى تسجيل الدخول يدويًا.',
      };
    }
  }

  // ─── Complete Registration (OTP path — unchanged contract) ──

  async completeRegistration(dto: {
    registrationToken: string;
    name: string;
    gender: string;
    provinceId: number;
    districtId: number;
    gradeId: number;
    password: string;
    externalSchoolName?: string;
  }) {
    // ── Step 1: Validate token (outside transaction) ──
    const { otpId, phone } = await this.validateRegistrationToken(dto.registrationToken);
    const normalizedPhone = this.otpService.normalizePhone(phone);

    // ── Step 2: Validate province + district + school + routing ──
    const preconditions = await this.resolvePreconditions({
      provinceId: dto.provinceId,
      districtId: dto.districtId,
    });

    // ── Step 3: Password hash (CPU intensive — outside transaction) ──
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // ── Step 4: Atomic transaction ──
    const registrationResult = await this.executeRegistrationTransaction(
      {
        phone: normalizedPhone,
        name: dto.name,
        gender: dto.gender,
        provinceId: dto.provinceId,
        districtId: dto.districtId,
        gradeId: dto.gradeId,
        password: dto.password,
        externalSchoolName: dto.externalSchoolName,
      },
      preconditions,
      passwordHash,
      otpId,
    );

    // ── Step 5: Build response with Session ──
    return this.buildRegistrationResponse(registrationResult);
  }

  // ─── Complete Registration Without OTP ───────────────────

  /**
   * مسار التسجيل المباشر بدون OTP.
   *
   * ⚠️  يرفض الطلب بـ 403 OTP_BYPASS_NOT_ALLOWED إذا كان OTP مفعّلاً.
   * ⚠️  Rate Limiting حسب IP وحسب رقم الهاتف يُطبَّق على مستوى Controller.
   */
  async completeRegistrationWithoutOtp(dto: CompleteWithoutOtpDto) {
    // ── Guard: تحقق أن OTP معطّل فعلاً ──
    if (OTP_DEFAULTS.isStudentRegistrationOtpEnabled) {
      throw new ForbiddenException(REGISTRATION_ERRORS.OTP_BYPASS_NOT_ALLOWED);
    }

    const normalizedPhone = this.otpService.normalizePhone(dto.phone);

    // ── Check Rate Limit by Phone (قبل فحص الشروط المسبقة وقبل الـ transaction) ──
    await this.phoneRateLimiter.checkRateLimit(normalizedPhone);

    // ── Validate preconditions (outside transaction) ──
    const preconditions = await this.resolvePreconditions({
      provinceId: dto.provinceId,
      districtId: dto.districtId,
    });

    // ── Password hash (outside transaction) ──
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // ── Atomic transaction (بدون otpId) ──
    const registrationResult = await this.executeRegistrationTransaction(
      {
        phone: normalizedPhone,
        name: dto.name,
        gender: dto.gender,
        provinceId: dto.provinceId,
        districtId: dto.districtId,
        gradeId: dto.gradeId,
        password: dto.password,
        externalSchoolName: dto.externalSchoolName,
      },
      preconditions,
      passwordHash,
      null, // لا OTP للاستهلاك
    );

    return this.buildRegistrationResponse(registrationResult);
  }
}
