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
import { createHash } from 'crypto';
import { OtpStatus } from '@prisma/client';
import { randomToken } from '../../school/auth/utils/crypto.util';

@Injectable()
export class StudentRegistrationService {
  private readonly logger = new Logger('StudentRegistrationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
  ) {}

  // ─── Token Validation ──────────────────────────────────────

  /**
   * التحقق من Registration Token والحصول على الهاتف المُوثّق
   */
  private async validateRegistrationToken(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');

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

  // ─── Complete Registration ─────────────────────────────────

  async completeRegistration(dto: {
    registrationToken: string;
    name: string;
    gender: string;
    provinceId: number;
    districtId: number;
    gradeId: number;
    password: string;
  }) {
    // ── Step 1: Validate token (outside transaction) ──
    const { otpId, phone } = await this.validateRegistrationToken(dto.registrationToken);
    const normalizedPhone = this.otpService.normalizePhone(phone);

    // ── Step 2: Validate province + district (outside transaction) ──
    const province = await this.prisma.province.findUnique({
      where: { id: dto.provinceId },
    });
    if (!province) throw new NotFoundException(REGISTRATION_ERRORS.PROVINCE_NOT_FOUND);

    const district = await this.prisma.district.findFirst({
      where: { id: dto.districtId, provinceId: dto.provinceId },
    });
    if (!district) throw new NotFoundException(REGISTRATION_ERRORS.DISTRICT_NOT_FOUND);

    // ── Step 3: Resolve Mafhoom school ──
    const mafhoomSchool = await this.prisma.school.findFirst({
      where: {
        schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
        isDeleted: false,
      },
    });
    if (!mafhoomSchool) {
      throw new InternalServerErrorException(REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND);
    }

    // ── Step 4: Resolve routing (district → section target) ──
    const routing = await this.prisma.mafhoomDistrictRouting.findUnique({
      where: { districtId: dto.districtId },
    });
    if (!routing || !routing.isActive) {
      throw new NotFoundException(REGISTRATION_ERRORS.ROUTING_NOT_FOUND);
    }

    // ── Step 5: Password hash (outside transaction — CPU intensive) ──
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // ══════════════════════════════════════════════════════════
    // ══ TRANSACTION: All critical operations inside ══════════
    // ══════════════════════════════════════════════════════════
    const registrationResult = await this.prisma.$transaction(async (tx) => {
      // 1. Advisory Lock on (mafhoomSchoolId, normalizedPhone)
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `reg:${mafhoomSchool.id}:${normalizedPhone}`,
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
        where: { id: dto.gradeId, schoolId: mafhoomSchool.id, isActive: true, isDeleted: false },
      });
      if (!grade) {
        throw new NotFoundException(REGISTRATION_ERRORS.GRADE_NOT_FOUND);
      }

      // 4. Resolve section by grade + targetSection from routing
      const section = await tx.section.findFirst({
        where: {
          gradeId: dto.gradeId,
          name: routing.targetSection, // "أ" or "ب"
          isActive: true,
          isDeleted: false,
        },
      });
      if (!section) {
        throw new NotFoundException(REGISTRATION_ERRORS.SECTION_NOT_FOUND);
      }

      // 5. Check: phone not already used by active STUDENT in Mafhoom
      const existingStudent = await tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM users
         WHERE school_id = $1
           AND user_type = 'STUDENT'
           AND phone = $2
           AND is_deleted = false
         LIMIT 1`,
        mafhoomSchool.id,
        normalizedPhone,
      );

      if (existingStudent && existingStudent.length > 0) {
        throw new ForbiddenException(REGISTRATION_ERRORS.PHONE_ALREADY_REGISTERED);
      }

      // 6. Generate school number (same mechanism as existing)
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
          name: dto.name,
          displayName: dto.name,
          gender: dto.gender,
          phone: normalizedPhone,
          province: province.name,
          district: district.name,
          passwordHash,
          isActive: true,
        },
      });

      // 8. Create Student
      await tx.student.create({
        data: { userId: user.id },
      });

      // 9. Create Enrollment
      await tx.studentEnrollment.create({
        data: {
          studentId: user.id,
          yearId: currentYear.id,
          gradeId: dto.gradeId,
          sectionId: section.id,
          status: 'ACTIVE',
          isCurrent: true,
          joinedAt: new Date(),
        },
      });

      // 10. Consume OTP (mark as CONSUMED)
      await tx.otpVerification.updateMany({
        where: { id: otpId, status: OtpStatus.VERIFIED },
        data: { status: OtpStatus.CONSUMED, consumedAt: new Date() },
      });

      this.logger.log(
        `Student registered: ${user.uuid} [code=${code}] phone=${normalizedPhone}`,
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

    // ══════════════════════════════════════════════════════════
    // ══ AuthSession: Outside transaction (per chat155) ═══════
    // ══════════════════════════════════════════════════════════
    try {
      const refreshPlain = randomToken(48);

      const device = await this.sessions.upsertDevice({
        userId: registrationResult.userId,
        deviceFingerprint: `self-reg-${registrationResult.userUuid}`,
        deviceType: 'ANDROID',
      });

      const session = await this.sessions.createSession({
        userId: registrationResult.userId,
        schoolId: registrationResult.schoolId,
        deviceId: device.id,
        refreshTokenPlain: refreshPlain,
      });

      const accessToken = this.jwt.sign(
        {
          sub: registrationResult.userUuid,
          ut: 'STUDENT',
          sc: registrationResult.schoolUuid,
          sid: session.uuid,
          uc: registrationResult.code,
        },
        {
          expiresIn: SCHOOL_AUTH_JWT.accessTokenTtlSec,
          issuer: SCHOOL_AUTH_JWT.issuer,
          audience: SCHOOL_AUTH_JWT.audience,
        },
      );

      return {
        registered: true,
        autoLoginSuccess: true,
        user: {
          uuid: registrationResult.userUuid,
          code: registrationResult.code,
          displayName: registrationResult.displayName,
        },
        school: {
          uuid: registrationResult.schoolUuid,
          displayName: registrationResult.schoolDisplayName,
          schoolCode: registrationResult.schoolCode,
        },
        accessToken,
        refreshToken: refreshPlain,
        sessionId: session.uuid,
      };
    } catch (error) {
      // التسجيل نجح لكن إنشاء Session فشل
      // لا نريد أن يظن المستخدم أن التسجيل فشل
      this.logger.error(
        `Registration succeeded but AuthSession failed for ${registrationResult.userUuid}: ${error}`,
      );

      return {
        registered: true,
        autoLoginSuccess: false,
        user: {
          uuid: registrationResult.userUuid,
          code: registrationResult.code,
          displayName: registrationResult.displayName,
        },
        school: {
          uuid: registrationResult.schoolUuid,
          displayName: registrationResult.schoolDisplayName,
          schoolCode: registrationResult.schoolCode,
        },
        message: 'تم إنشاء الحساب بنجاح. يرجى تسجيل الدخول يدويًا.',
      };
    }
  }
}
