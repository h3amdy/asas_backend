import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OtpStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { ParentStudentContextGuard } from '../../school/common/guards/parent-student-context.guard';
import {
  SUB_ERROR,
  SubscriptionGuard,
} from '../../school/common/guards/subscription.guard';
import { StudentRegistrationService } from '../../public/student-registration/student-registration.service';
import { RegistrationDataService } from '../../public/student-registration/registration-data.service';
import {
  REGISTRATION_CONFIG,
  REGISTRATION_ERRORS,
} from '../../public/student-registration/registration.constants';
import { OTP_DEFAULTS } from '../../shared/otp/otp.constants';
import { RequestLoggerMiddleware } from '../middleware/request-logger.middleware';
import { TeacherUnitsService } from '../../school/teacher/units/teacher-units.service';

function makeHttpContext(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('Quick Wins Batch 2 (SEC-AUTH-04, SEC-LOW-01, SEC-OTP-02, SEC-R3-08, SEC-LOG-01, SEC-TCH-04)', () => {
  describe('SEC-AUTH-04 — ParentStudentContextGuard & SubscriptionGuard enforce isActive and userType', () => {
    it('rejects inactive student or non-student user or inactive parent in ParentStudentContextGuard with 403', async () => {
      const prismaMock = {
        user: { findFirst: jest.fn() },
        parentStudent: { findFirst: jest.fn() },
      };
      const guard = new ParentStudentContextGuard(prismaMock as any);

      // 1) Inactive or missing parent fails with 403 and queries isActive: true
      prismaMock.user.findFirst.mockResolvedValueOnce(null);
      await expect(
        guard.canActivate(
          makeHttpContext({
            headers: { 'x-student-context': 'stu-uuid-1' },
            user: { sub: 'par-uuid-1', ut: 'PARENT' },
            schoolContext: { id: 10 },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          uuid: 'par-uuid-1',
          schoolId: 10,
          userType: 'PARENT',
          isActive: true,
          isDeleted: false,
        },
        include: { parent: { select: { userId: true } } },
      });

      // 2) Active parent, inactive/non-student student target fails with 403 and queries userType: 'STUDENT', isActive: true
      prismaMock.user.findFirst
        .mockResolvedValueOnce({ id: 5, parent: { userId: 5 } })
        .mockResolvedValueOnce(null);

      await expect(
        guard.canActivate(
          makeHttpContext({
            headers: { 'x-student-context': 'stu-suspended-uuid' },
            user: { sub: 'par-uuid-1', ut: 'PARENT' },
            schoolContext: { id: 10 },
          }),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prismaMock.user.findFirst).toHaveBeenNthCalledWith(3, {
        where: {
          uuid: 'stu-suspended-uuid',
          schoolId: 10,
          userType: 'STUDENT',
          isActive: true,
          isDeleted: false,
        },
        include: { student: { select: { userId: true } } },
      });
      expect(prismaMock.parentStudent.findFirst).not.toHaveBeenCalled();

      // 3) Active linked parent and active student pass and switch context
      prismaMock.user.findFirst
        .mockResolvedValueOnce({ id: 5, parent: { userId: 5 } })
        .mockResolvedValueOnce({ id: 9, student: { userId: 9 } });
      prismaMock.parentStudent.findFirst.mockResolvedValueOnce({ id: 1 });

      const req: any = {
        headers: { 'x-student-context': 'stu-active-uuid' },
        user: { sub: 'par-uuid-1', ut: 'PARENT' },
        schoolContext: { id: 10 },
      };
      await expect(guard.canActivate(makeHttpContext(req))).resolves.toBe(true);
      expect(req.effectiveStudentUuid).toBe('stu-active-uuid');
      expect(req.performedByParentUuid).toBe('par-uuid-1');
      expect(req.user.sub).toBe('stu-active-uuid');
      expect(req.user.ut).toBe('STUDENT');
      expect(req.user.originalUt).toBe('PARENT');
    });

    it('rejects suspended student (isActive: false) in SubscriptionGuard with SUBSCRIPTION_REQUIRED', async () => {
      const prismaMock = {
        schoolSubscriptionSettings: {
          findUnique: jest.fn().mockResolvedValue({ isActivated: true }),
        },
        user: { findFirst: jest.fn().mockResolvedValue(null) },
        studentAccessPeriod: { findFirst: jest.fn() },
      };
      const guard = new SubscriptionGuard(prismaMock as any);

      await expect(
        guard.canActivate(
          makeHttpContext({
            user: { sub: 'stu-suspended-uuid', ut: 'STUDENT' },
            schoolContext: { id: 10 },
          }),
        ),
      ).rejects.toThrow(
        new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED),
      );

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          uuid: 'stu-suspended-uuid',
          schoolId: 10,
          userType: 'STUDENT',
          isActive: true,
          isDeleted: false,
        },
        select: { id: true },
      });
      expect(prismaMock.studentAccessPeriod.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('SEC-LOW-01 — SubscriptionGuard Fail-Closed without affecting non-students', () => {
    it('fails closed when req.user or schoolId or studentUuid is missing', async () => {
      const prismaMock = {
        schoolSubscriptionSettings: { findUnique: jest.fn() },
        user: { findFirst: jest.fn() },
        studentAccessPeriod: { findFirst: jest.fn() },
      };
      const guard = new SubscriptionGuard(prismaMock as any);

      await expect(
        guard.canActivate(makeHttpContext({ schoolContext: { id: 10 } })),
      ).rejects.toThrow(
        new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED),
      );

      await expect(
        guard.canActivate(
          makeHttpContext({
            user: { sub: 'stu-1', ut: 'STUDENT' },
          }),
        ),
      ).rejects.toThrow(
        new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED),
      );

      await expect(
        guard.canActivate(
          makeHttpContext({
            user: { ut: 'STUDENT' },
            schoolContext: { id: 10 },
          }),
        ),
      ).rejects.toThrow(
        new ForbiddenException(SUB_ERROR.SUBSCRIPTION_REQUIRED),
      );

      expect(
        prismaMock.schoolSubscriptionSettings.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('continues allowing authenticated non-student roles (TEACHER, MANAGER, PARENT) even without subscription lookup', async () => {
      const prismaMock = {
        schoolSubscriptionSettings: { findUnique: jest.fn() },
      };
      const guard = new SubscriptionGuard(prismaMock as any);

      for (const ut of ['TEACHER', 'MANAGER', 'PARENT']) {
        await expect(
          guard.canActivate(makeHttpContext({ user: { sub: 'u-1', ut } })),
        ).resolves.toBe(true);
      }

      expect(
        prismaMock.schoolSubscriptionSettings.findUnique,
      ).not.toHaveBeenCalled();
    });
  });

  describe('SEC-OTP-02 & SEC-R3-08 — Atomic OTP consumption and active Mafhoom school enforcement', () => {
    const originalOtpEnv = process.env.STUDENT_REGISTRATION_OTP_ENABLED;

    afterEach(() => {
      if (originalOtpEnv === undefined) {
        delete process.env.STUDENT_REGISTRATION_OTP_ENABLED;
      } else {
        process.env.STUDENT_REGISTRATION_OTP_ENABLED = originalOtpEnv;
      }
    });

    it('aborts transaction immediately when atomic otpVerification updateMany count !== 1', async () => {
      const token = 'race-token-123';
      const tokenHash = createHmac('sha256', OTP_DEFAULTS.pepper)
        .update(token)
        .digest('hex');

      const txMock = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        school: { findFirst: jest.fn().mockResolvedValue({ id: 100 }) },
        otpVerification: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        year: { findFirst: jest.fn() },
        user: { create: jest.fn() },
        student: { create: jest.fn() },
        studentEnrollment: { create: jest.fn() },
      };

      const prismaMock = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          {
            id: 77,
            phone: '+967771234567',
            status: 'VERIFIED',
            registration_token_expires_at: new Date(Date.now() + 600_000),
            registration_request_id: 'req-1',
            tokenHash,
          },
        ]),
        province: { findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'صنعاء' }) },
        district: { findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'السبعين' }) },
        school: {
          findFirst: jest.fn().mockResolvedValue({
            id: 100,
            uuid: 'sch-uuid',
            name: 'مفهوم',
            displayName: 'مدرسة مفهوم',
            schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
            isActive: true,
          }),
        },
        mafhoomDistrictRouting: {
          findUnique: jest.fn().mockResolvedValue({ targetSection: 'A', isActive: true }),
        },
        $transaction: jest.fn((cb: any) => cb(txMock)),
      };

      const userCodeGeneratorMock = { generateUserCode: jest.fn() };
      const trialServiceMock = { createTrialForNewStudentTx: jest.fn() };
      const service = new StudentRegistrationService(
        prismaMock as any,
        { normalizePhone: (p: string) => p } as any,
        {} as any,
        {} as any,
        { checkRateLimit: jest.fn() } as any,
        trialServiceMock as any,
        userCodeGeneratorMock as any,
      );

      await expect(
        service.completeRegistration({
          registrationToken: token,
          name: 'طالب تجريبي',
          gender: 'MALE',
          provinceId: 1,
          districtId: 2,
          gradeId: 3,
          password: 'Password123',
        }),
      ).rejects.toThrow(
        new BadRequestException(REGISTRATION_ERRORS.TOKEN_INVALID),
      );

      expect(txMock.otpVerification.updateMany).toHaveBeenCalledWith({
        where: {
          id: 77,
          status: OtpStatus.VERIFIED,
          registrationTokenExpiresAt: { gt: expect.any(Date) },
        },
        data: {
          status: OtpStatus.CONSUMED,
          consumedAt: expect.any(Date),
        },
      });
      expect(userCodeGeneratorMock.generateUserCode).not.toHaveBeenCalled();
      expect(txMock.user.create).not.toHaveBeenCalled();
      expect(txMock.student.create).not.toHaveBeenCalled();
      expect(txMock.studentEnrollment.create).not.toHaveBeenCalled();
      expect(trialServiceMock.createTrialForNewStudentTx).not.toHaveBeenCalled();
    });

    it('rejects inactive Mafhoom school across checkPhoneRegistration, getRegistrationGrades, completeRegistration, completeRegistrationWithoutOtp, and mid-tx TOCTOU', async () => {
      const prismaInactive = {
        school: { findFirst: jest.fn().mockResolvedValue(null) },
        province: { findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'صنعاء' }) },
        district: { findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'السبعين' }) },
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          {
            id: 88,
            phone: '+967771234568',
            status: 'VERIFIED',
            registration_token_expires_at: new Date(Date.now() + 600_000),
            registration_request_id: 'req-2',
          },
        ]),
      };

      const dataService = new RegistrationDataService(prismaInactive as any);
      await expect(dataService.getRegistrationGrades()).rejects.toThrow(
        new NotFoundException(REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND),
      );
      expect(prismaInactive.school.findFirst).toHaveBeenCalledWith({
        where: {
          schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
          isActive: true,
          isDeleted: false,
        },
        select: { id: true },
      });

      const phoneRateLimiterMock = { checkRateLimit: jest.fn().mockResolvedValue(undefined) };
      const regService = new StudentRegistrationService(
        prismaInactive as any,
        { normalizePhone: (p: string) => p } as any,
        {} as any,
        {} as any,
        phoneRateLimiterMock as any,
        {} as any,
        {} as any,
      );

      await expect(
        regService.checkPhoneRegistration({ phone: '+967771234568' }),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );
      expect(prismaInactive.school.findFirst).toHaveBeenLastCalledWith({
        where: {
          schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
          isActive: true,
          isDeleted: false,
        },
      });

      await expect(
        regService.completeRegistration({
          registrationToken: 'tok-inactive',
          name: 'طالب مدرسة معطلة',
          gender: 'MALE',
          provinceId: 1,
          districtId: 2,
          gradeId: 3,
          password: 'Password123',
        }),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );

      process.env.STUDENT_REGISTRATION_OTP_ENABLED = 'false';
      await expect(
        regService.completeRegistrationWithoutOtp({
          phone: '+967771234568',
          name: 'طالب مباشر',
          gender: 'MALE',
          provinceId: 1,
          districtId: 2,
          gradeId: 3,
          password: 'Password123',
        } as any),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );

      // Mid-transaction TOCTOU: resolvePreconditions succeeds while active, school deactivated before tx runs
      const txToctouMock = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        school: { findFirst: jest.fn().mockResolvedValue(null) },
        otpVerification: { updateMany: jest.fn() },
        user: { create: jest.fn() },
      };
      const prismaToctou = {
        ...prismaInactive,
        school: {
          findFirst: jest.fn().mockResolvedValue({
            id: 100,
            uuid: 'sch-uuid',
            name: 'مفهوم',
            displayName: 'مدرسة مفهوم',
            schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
          }),
        },
        mafhoomDistrictRouting: {
          findUnique: jest.fn().mockResolvedValue({ targetSection: 'A', isActive: true }),
        },
        $transaction: jest.fn((cb: any) => cb(txToctouMock)),
      };
      const toctouService = new StudentRegistrationService(
        prismaToctou as any,
        { normalizePhone: (p: string) => p } as any,
        {} as any,
        {} as any,
        phoneRateLimiterMock as any,
        {} as any,
        { generateUserCode: jest.fn() } as any,
      );

      await expect(
        toctouService.completeRegistration({
          registrationToken: 'tok-toctou',
          name: 'طالب سباق',
          gender: 'MALE',
          provinceId: 1,
          districtId: 2,
          gradeId: 3,
          password: 'Password123',
        }),
      ).rejects.toThrow(
        new InternalServerErrorException(
          REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND,
        ),
      );
      expect(txToctouMock.school.findFirst).toHaveBeenCalledWith({
        where: { id: 100, isActive: true, isDeleted: false },
        select: { id: true },
      });
      expect(txToctouMock.otpVerification.updateMany).not.toHaveBeenCalled();
      expect(txToctouMock.user.create).not.toHaveBeenCalled();
    });
  });

  describe('SEC-LOG-01 — RequestLoggerMiddleware CRLF / Control-Char / Math.random hardening', () => {
    it('replaces CRLF / control-char / invalid X-Request-ID using crypto.randomBytes and preserves valid Flutter IDs', () => {
      const middleware = new RequestLoggerMiddleware();
      const loggerSpy = jest
        .spyOn((middleware as any).logger, 'log')
        .mockImplementation(() => undefined);
      const mathRandomSpy = jest.spyOn(Math, 'random');

      try {
        const invoke = (
          headerVal: any,
          originalUrl = '/api/v1/school/student/lessons',
        ) => {
          let finishCb: (() => void) | undefined;
          const req: any = {
            headers: headerVal === undefined ? {} : { 'x-request-id': headerVal },
            method: 'GET',
            originalUrl,
          };
          const res: any = {
            statusCode: 200,
            on: (event: string, cb: () => void) => {
              if (event === 'finish') finishCb = cb;
            },
          };
          const next = jest.fn();
          middleware.use(req, res, next);
          expect(next).toHaveBeenCalledTimes(1);
          finishCb?.();
          return {
            requestId: req.requestId as string,
            logged: loggerSpy.mock.calls.at(-1)?.[0] as string,
          };
        };

        const maliciousInputs = [
          'abc\r\n[API] forged admin login',
          'abc\nforged-line',
          'abc\rforged-line',
          'ansi\x1b[31mred',
          'space invalid id',
          'a'.repeat(65),
          ['id-1', 'id-2'],
        ];

        for (const payload of maliciousInputs) {
          const { requestId, logged } = invoke(
            payload,
            '/school/auth/login?secret=123\r\n[FORGED]',
          );
          expect(requestId).toMatch(/^[0-9a-f]{8}$/);
          expect(logged).not.toMatch(/[\r\n\x00-\x1f\x7f]/);
          expect(logged).not.toContain('secret=123');
          expect(logged).toContain(`[${requestId}]`);
        }

        // Legitimate Flutter 8-char hex and UUID are preserved
        const flutterRes = invoke('a1b2c3d4');
        expect(flutterRes.requestId).toBe('a1b2c3d4');
        expect(flutterRes.logged).toContain('[a1b2c3d4]');

        const uuidRes = invoke('550e8400-e29b-41d4-a716-446655440000');
        expect(uuidRes.requestId).toBe('550e8400-e29b-41d4-a716-446655440000');

        expect(mathRandomSpy).not.toHaveBeenCalled();
      } finally {
        mathRandomSpy.mockRestore();
        loggerSpy.mockRestore();
      }
    });
  });

  describe('SEC-TCH-04 — TeacherUnitsService.deleteUnit prevents deleting non-empty units', () => {
    function buildService(counts: { templates: number; lessons: number }) {
      const txMock = {
        unit: {
          findFirst: jest.fn().mockResolvedValue({ id: 55, uuid: 'unit-uuid-55' }),
          update: jest.fn().mockResolvedValue({ id: 55, isDeleted: true }),
        },
        lessonTemplate: {
          count: jest.fn().mockResolvedValue(counts.templates),
        },
        lesson: {
          count: jest.fn().mockResolvedValue(counts.lessons),
        },
      };

      const prismaMock = {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 7,
            teacher: { userId: 7 },
          }),
        },
        subject: {
          findFirst: jest.fn().mockResolvedValue({ id: 22 }),
        },
        subjectSectionTeacher: {
          findFirst: jest.fn().mockResolvedValue({ id: 99 }),
        },
        $transaction: jest.fn((cb: any) => cb(txMock)),
      };

      return {
        service: new TeacherUnitsService(prismaMock as any),
        txMock,
      };
    }

    it('throws ConflictException when unit contains active lessonTemplates', async () => {
      const { service, txMock } = buildService({ templates: 2, lessons: 0 });
      await expect(
        service.deleteUnit(10, 'teacher-uuid', 'subject-uuid', 'unit-uuid-55'),
      ).rejects.toThrow(
        new ConflictException('لا يمكن حذف وحدة تحتوي على دروس.'),
      );
      expect(txMock.unit.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when unit contains active lessons even if template count is 0', async () => {
      const { service, txMock } = buildService({ templates: 0, lessons: 1 });
      await expect(
        service.deleteUnit(10, 'teacher-uuid', 'subject-uuid', 'unit-uuid-55'),
      ).rejects.toThrow(
        new ConflictException('لا يمكن حذف وحدة تحتوي على دروس.'),
      );
      expect(txMock.unit.update).not.toHaveBeenCalled();
    });

    it('soft-deletes an empty unit (0 templates and 0 active lessons)', async () => {
      const { service, txMock } = buildService({ templates: 0, lessons: 0 });
      const res = await service.deleteUnit(
        10,
        'teacher-uuid',
        'subject-uuid',
        'unit-uuid-55',
      );
      expect(res).toEqual({ message: 'تم حذف الوحدة بنجاح' });
      expect(txMock.unit.update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: { isDeleted: true, deletedAt: expect.any(Date) },
      });
    });
  });
});
