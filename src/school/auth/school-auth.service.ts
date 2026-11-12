// src/school/auth/school-auth.service.ts

import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { SCHOOL_AUTH_JWT, SCHOOL_AUTH_ERRORS } from './constants';
import { randomToken } from './utils/crypto.util';
import { SCHOOL_LOGIN_ROLES, parseUserCode } from '../../common/user-code/user-code.policy';

/**
 * hash ثابت يُقارن به عند عدم وجود المستخدم، حتى يستغرق الرد نفس زمن bcrypt تقريباً
 * (SR-NUM-002 — تقليل كشف وجود الرقم عبر التوقيت). نفس cost المستخدم في إنشاء الحسابات (10).
 */
const TIMING_DUMMY_HASH = bcrypt.hashSync('asas-timing-equalizer', 10);

/**
 * بيانات المدرسة المُرجعة في login/refresh (SRS-SCH-NUM-001 §4.3-3)
 * ليحفظ التطبيق العام المدرسة المستنتجة في Drift فور الدخول.
 * إضافة حقول فقط — متوافق مع النسخ القديمة التي تقرأ uuid/displayName/appType.
 */
const SCHOOL_PAYLOAD_SELECT = {
  id: true,
  uuid: true,
  name: true,
  displayName: true,
  schoolCode: true,
  appType: true,
  phone: true,
  email: true,
  primaryColor: true,
  secondaryColor: true,
  backgroundColor: true,
  deliveryPolicy: true,
  educationType: true,
  logoMediaAssetId: true,
  logoMediaAsset: { select: { uuid: true } },
  province: true,
  district: true,
  addressArea: true,
  address: true,
  isActive: true,
  isDeleted: true,
} satisfies Prisma.SchoolSelect;

type SchoolPayloadRow = Prisma.SchoolGetPayload<{ select: typeof SCHOOL_PAYLOAD_SELECT }>;

function toSchoolPayload(school: SchoolPayloadRow) {
  return {
    uuid: school.uuid,
    name: school.name,
    displayName: school.displayName ?? school.name,
    schoolCode: school.schoolCode,
    appType: school.appType,
    phone: school.phone ?? null,
    email: school.email ?? null,
    primaryColor: school.primaryColor ?? null,
    secondaryColor: school.secondaryColor ?? null,
    backgroundColor: school.backgroundColor ?? null,
    deliveryPolicy: school.deliveryPolicy,
    educationType: school.educationType ?? null,
    logoMediaAssetId: school.logoMediaAssetId ?? null,
    logoMediaAssetUuid: school.logoMediaAsset?.uuid ?? null,
    province: school.province ?? null,
    district: school.district ?? null,
    addressArea: school.addressArea ?? null,
    address: school.address ?? null,
    isActive: school.isActive,
  };
}

type SafeUserPayload = {
  sub: string; // user uuid
  ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  sc: string; // school uuid
  sid: string; // session uuid
  uc: number; // الرقم المدرسي الموحد (إلزامي بعد SRS-SCH-NUM-001)
};

@Injectable()
export class SchoolAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) { }

  private buildAccessToken(payload: SafeUserPayload): string {
    return this.jwt.sign(payload, {
      expiresIn: SCHOOL_AUTH_JWT.accessTokenTtlSec,
      issuer: SCHOOL_AUTH_JWT.issuer,
      audience: SCHOOL_AUTH_JWT.audience,
    });
  }

  /**
   * تسجيل الدخول بالرقم المدرسي الموحد (SRS-SCH-NUM-001 §4.3)
   *
   * - الهوية تُحدَّد من `code` وحده (فريد على مستوى المنصة)، والمدرسة تُستنتج من حساب المستخدم.
   * - `schoolUuid` (التطبيق الخاص) قيد إضافي فقط: مستخدم مدرسة أخرى ← INVALID_CREDENTIALS.
   * - OWNER مستبعد بالدور (SCHOOL_LOGIN_ROLES).
   * - SR-NUM-002: رسالة واحدة لكل حالات «الرقم غير موجود / كلمة مرور خاطئة / مدرسة غير مطابقة»،
   *   و bcrypt يُنفَّذ دائماً (حتى عند عدم وجود المستخدم) لتقليل فرق التوقيت الكاشف.
   *   حالات الحساب/المدرسة (موقوف) لا تُكشف إلا بعد نجاح كلمة المرور.
   */
  async login(input: {
    schoolUuid?: string;
    identifier: string;
    password: string;
    deviceFingerprint: string;
    deviceType: 'ANDROID' | 'IOS' | 'WEB';
    pushToken?: string;
  }) {
    const code = parseUserCode(input.identifier);

    const user = code === null
      ? null
      : await this.prisma.user.findFirst({
        where: {
          code,
          userType: { in: [...SCHOOL_LOGIN_ROLES] },
          isDeleted: false,
        },
        select: {
          id: true,
          uuid: true,
          userType: true,
          code: true,
          displayName: true,
          name: true,
          passwordHash: true,
          isActive: true,
          school: { select: SCHOOL_PAYLOAD_SELECT },
        },
      });

    const school = user?.school && !user.school.isDeleted ? user.school : null;
    const passwordOk = await bcrypt.compare(input.password ?? '', user?.passwordHash ?? TIMING_DUMMY_HASH);
    const schoolScopeOk = !input.schoolUuid || school?.uuid === input.schoolUuid;

    if (!user || !school || !passwordOk || !schoolScopeOk) {
      throw new UnauthorizedException(SCHOOL_AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // بعد نجاح كلمة المرور فقط — رسائل حالة واضحة (UX)
    if (!school.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_INACTIVE);
    if (!user.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.USER_INACTIVE);

    // device upsert
    const device = await this.sessions.upsertDevice({
      userId: user.id,
      deviceFingerprint: input.deviceFingerprint,
      deviceType: input.deviceType,
      pushToken: input.pushToken,
    });

    // session + refresh token — schoolId من حساب المستخدم وليس من العميل
    const refreshPlain = randomToken(48);
    const session = await this.sessions.createSession({
      userId: user.id,
      schoolId: school.id,
      deviceId: device.id,
      refreshTokenPlain: refreshPlain,
    });

    const accessToken = this.buildAccessToken({
      sub: user.uuid,
      ut: user.userType as SafeUserPayload['ut'],
      sc: school.uuid,
      sid: session.uuid,
      uc: user.code,
    });

    return {
      accessToken,
      refreshToken: refreshPlain,
      sessionId: session.uuid,
      refreshExpiresAt: session.expiresAt,

      user: {
        uuid: user.uuid,
        userType: user.userType,
        code: user.code,
        displayName: user.displayName ?? user.name, // ✅ لا نرجّع الاسم الرسمي كحقل مستقل
      },

      school: toSchoolPayload(school),
    };
  }

  async refresh(input: {
    sessionId: string;
    refreshToken: string;
    deviceFingerprint: string;
    deviceType: 'ANDROID' | 'IOS' | 'WEB';
    pushToken?: string;
  }) {
    const rotated = await this.sessions.validateAndRotateRefresh({
      sessionUuid: input.sessionId,
      refreshTokenPlain: input.refreshToken,
      deviceFingerprint: input.deviceFingerprint,
      deviceType: input.deviceType,
      pushToken: input.pushToken,
    });

    // تأكيد وجود المستخدم + المدرسة (مع حالة active)
    const [user, school] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: rotated.userId, isDeleted: false, isActive: true },
        select: { uuid: true, userType: true, code: true, displayName: true, name: true, schoolId: true },
      }),
      rotated.schoolId
        ? this.prisma.school.findFirst({
          where: { id: rotated.schoolId },
          select: SCHOOL_PAYLOAD_SELECT,
        })
        : null,
    ]);

    if (!user) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.USER_INACTIVE);
    if (!school || school.isDeleted) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_NOT_FOUND);
    if (!school.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_INACTIVE);

    // ✅ التحقق من تطابق المدرسة في الجلسة مع المدرسة الفعلية للمستخدم
    if (user.schoolId !== rotated.schoolId) {
      throw new ForbiddenException(SCHOOL_AUTH_ERRORS.INVALID_SESSION);
    }

    const accessToken = this.buildAccessToken({
      sub: user.uuid,
      ut: user.userType as any,
      sc: school.uuid,
      sid: rotated.sessionUuid,
      uc: user.code,
    });

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      sessionId: rotated.sessionUuid,
      refreshExpiresAt: rotated.refreshExpiresAt,
      user: {
        uuid: user.uuid,
        userType: user.userType,
        code: user.code,
        displayName: user.displayName ?? user.name,
      },
      school: toSchoolPayload(school),
    };
  }

  async logout(input: { sessionId: string; logoutAll?: boolean; currentUserUuid: string }) {
    // نحتاج userId/schoolId لو logoutAll
    const session = await this.prisma.authSession.findUnique({
      where: { uuid: input.sessionId },
      select: { uuid: true, userId: true, schoolId: true, revokedAt: true, user: { select: { uuid: true } } },
    });

    if (!session) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);

    // ✅ التحقق من أن الجلسة تخص المستخدم الحالي
    if (session.user.uuid !== input.currentUserUuid) {
      throw new ForbiddenException(SCHOOL_AUTH_ERRORS.NOT_YOUR_SESSION);
    }

    if (input.logoutAll) {
      await this.sessions.revokeAllUserSessions({
        userId: session.userId,
        schoolId: session.schoolId,
        reason: 'LOGOUT',
      });
      return { success: true, logoutAll: true };
    }

    await this.sessions.revokeSession({ sessionUuid: session.uuid, reason: 'LOGOUT' });
    return { success: true, logoutAll: false };
  }
}
