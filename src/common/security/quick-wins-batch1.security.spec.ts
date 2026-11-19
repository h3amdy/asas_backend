import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { SchoolAuthController } from '../../school/auth/school-auth.controller';
import { SchoolAuthService } from '../../school/auth/school-auth.service';
import { SchoolJwtAuthGuard } from '../../school/auth/guards/school-jwt-auth.guard';
import { PlatformAuthController } from '../../platform/auth/platform-auth.controller';
import { PlatformAuthService } from '../../platform/auth/platform-auth.service';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { StudentRegistrationController } from '../../public/student-registration/student-registration.controller';
import { StudentRegistrationService } from '../../public/student-registration/student-registration.service';
import { OtpBypassGuard } from '../../public/student-registration/guards/otp-bypass.guard';
import { OtpService } from '../../shared/otp/otp.service';
import { PlatformBooksController } from '../../platform/books/platform-books.controller';
import { PlatformBooksService } from '../../platform/books/platform-books.service';
import { BookSemester } from '../../platform/books/dto/create-book.dto';
import { ImportsService } from '../../owner/imports/imports.service';
import { TeachersService } from '../../school/manager/teachers/teachers.service';
import { ParentsService } from '../../school/manager/parents/parents.service';
import { PlatformUsersService } from '../../platform/users/platform-users.service';

describe('Quick Wins Batch 1 (SEC-AUTH-01, SEC-OTP-03, SEC-PLT-01, SEC-IMP-02)', () => {
  describe('SEC-AUTH-01 & SEC-OTP-03 — HTTP Rate Limiting (ThrottlerGuard)', () => {
    let app: INestApplication;

    const schoolAuthServiceMock = {
      login: jest.fn().mockResolvedValue({ ok: true }),
      refresh: jest.fn().mockResolvedValue({ ok: true }),
      logout: jest.fn().mockResolvedValue({ success: true }),
    };

    const platformAuthServiceMock = {
      login: jest.fn().mockResolvedValue({ ok: true }),
      refresh: jest.fn().mockResolvedValue({ ok: true }),
      logout: jest.fn().mockResolvedValue({ message: 'ok' }),
    };

    const otpServiceMock = {
      requestOtp: jest.fn().mockResolvedValue({ sent: true }),
      verifyOtp: jest.fn().mockResolvedValue({ verified: true }),
    };

    const registrationServiceMock = {
      checkPhoneRegistration: jest.fn().mockResolvedValue({ exists: false }),
      completeRegistration: jest.fn().mockResolvedValue({ ok: true }),
      getRegistrationConfig: jest.fn().mockResolvedValue({ otpEnabled: true }),
      completeRegistrationWithoutOtp: jest.fn().mockResolvedValue({ ok: true }),
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'short', ttl: 60000, limit: 5 },
            { name: 'long', ttl: 3600000, limit: 20 },
          ]),
        ],
        controllers: [
          SchoolAuthController,
          PlatformAuthController,
          StudentRegistrationController,
        ],
        providers: [
          { provide: SchoolAuthService, useValue: schoolAuthServiceMock },
          { provide: PlatformAuthService, useValue: platformAuthServiceMock },
          { provide: OtpService, useValue: otpServiceMock },
          {
            provide: StudentRegistrationService,
            useValue: registrationServiceMock,
          },
        ],
      })
        .overrideGuard(SchoolJwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PlatformJwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(OtpBypassGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = moduleRef.createNestApplication();
      app.getHttpAdapter().getInstance().set('trust proxy', true);
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('throttles POST /school/auth/login after 10 requests and POST /school/auth/refresh after 20 requests', async () => {
      const loginPayload = {
        identifier: '2200001',
        password: 'Password123',
        deviceFingerprint: 'fp-1',
        deviceType: 'ANDROID',
      };

      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/school/auth/login')
          .set('X-Forwarded-For', '10.10.1.1')
          .send(loginPayload)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/school/auth/login')
        .set('X-Forwarded-For', '10.10.1.1')
        .send(loginPayload)
        .expect(429);

      const refreshPayload = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        refreshToken: 'refresh-token-plain',
        deviceFingerprint: 'fp-1',
        deviceType: 'ANDROID',
      };

      for (let i = 0; i < 20; i++) {
        await request(app.getHttpServer())
          .post('/school/auth/refresh')
          .set('X-Forwarded-For', '10.10.1.2')
          .send(refreshPayload)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/school/auth/refresh')
        .set('X-Forwarded-For', '10.10.1.2')
        .send(refreshPayload)
        .expect(429);
    });

    it('throttles POST /auth/platform/login after 10 requests and POST /auth/platform/refresh after 20 requests', async () => {
      const loginPayload = {
        login: 'admin@mafhooom.com',
        password: 'Password123',
      };

      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/auth/platform/login')
          .set('X-Forwarded-For', '10.10.2.1')
          .send(loginPayload)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/auth/platform/login')
        .set('X-Forwarded-For', '10.10.2.1')
        .send(loginPayload)
        .expect(429);

      const refreshPayload = {
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        refreshToken: 'platform-refresh-plain',
      };

      for (let i = 0; i < 20; i++) {
        await request(app.getHttpServer())
          .post('/auth/platform/refresh')
          .set('X-Forwarded-For', '10.10.2.2')
          .send(refreshPayload)
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/auth/platform/refresh')
        .set('X-Forwarded-For', '10.10.2.2')
        .send(refreshPayload)
        .expect(429);
    });

    it('SEC-OTP-03: throttles request-otp and verify-otp after 5 requests per minute', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/public/student-registration/request-otp')
          .set('X-Forwarded-For', '10.10.3.1')
          .send({ phone: '770000001' })
          .expect(200);
      }

      await request(app.getHttpServer())
        .post('/public/student-registration/request-otp')
        .set('X-Forwarded-For', '10.10.3.1')
        .send({ phone: '770000001' })
        .expect(429);

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/public/student-registration/verify-otp')
          .set('X-Forwarded-For', '10.10.3.2')
          .send({ registrationRequestId: 'req-1', code: '123456' })
          .expect(200);
      }

      await request(app.getHttpServer())
        .post('/public/student-registration/verify-otp')
        .set('X-Forwarded-For', '10.10.3.2')
        .send({ registrationRequestId: 'req-1', code: '123456' })
        .expect(429);
    });
  });

  describe('SEC-PLT-01 — PlatformAdminGuard on PlatformBooksController write routes', () => {
    let app: INestApplication;

    const booksServiceMock = {
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: 1, title: 'Math' }),
      create: jest.fn().mockResolvedValue({ id: 2, title: 'Science' }),
      update: jest.fn().mockResolvedValue({ id: 1, title: 'Updated' }),
      toggle: jest.fn().mockResolvedValue({ id: 1, isActive: false }),
      softDelete: jest.fn().mockResolvedValue({ success: true }),
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [PlatformBooksController],
        providers: [
          { provide: PlatformBooksService, useValue: booksServiceMock },
        ],
      })
        .overrideGuard(PlatformJwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            const req = ctx.switchToHttp().getRequest();
            req.user = {
              sub: 'user-uuid-1',
              role: req.headers['x-test-role'] || 'PLATFORM_TEACHER',
            };
            return true;
          },
        })
        .compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('allows PLATFORM_TEACHER to read books but rejects POST/PATCH/DELETE with 403', async () => {
      await request(app.getHttpServer())
        .get('/platform/books')
        .set('x-test-role', 'PLATFORM_TEACHER')
        .expect(200);

      await request(app.getHttpServer())
        .get('/platform/books/1')
        .set('x-test-role', 'PLATFORM_TEACHER')
        .expect(200);

      await request(app.getHttpServer())
        .post('/platform/books')
        .set('x-test-role', 'PLATFORM_TEACHER')
        .send({
          title: 'كتاب جديد',
          subjectDictionaryId: 1,
          gradeDictionaryId: 1,
          semester: BookSemester.FIRST,
        })
        .expect(403);

      await request(app.getHttpServer())
        .patch('/platform/books/1')
        .set('x-test-role', 'PLATFORM_TEACHER')
        .send({ title: 'تعديل' })
        .expect(403);

      await request(app.getHttpServer())
        .patch('/platform/books/1/toggle')
        .set('x-test-role', 'PLATFORM_TEACHER')
        .expect(403);

      await request(app.getHttpServer())
        .delete('/platform/books/1')
        .set('x-test-role', 'PLATFORM_TEACHER')
        .expect(403);

      expect(booksServiceMock.create).not.toHaveBeenCalled();
      expect(booksServiceMock.update).not.toHaveBeenCalled();
      expect(booksServiceMock.toggle).not.toHaveBeenCalled();
      expect(booksServiceMock.softDelete).not.toHaveBeenCalled();
    });

    it('allows PLATFORM_ADMIN to execute POST/PATCH/DELETE on books', async () => {
      await request(app.getHttpServer())
        .post('/platform/books')
        .set('x-test-role', 'PLATFORM_ADMIN')
        .send({
          title: 'كتاب جديد',
          subjectDictionaryId: 1,
          gradeDictionaryId: 1,
          semester: BookSemester.FIRST,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/platform/books/1')
        .set('x-test-role', 'PLATFORM_ADMIN')
        .send({ title: 'تعديل' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/platform/books/1/toggle')
        .set('x-test-role', 'PLATFORM_ADMIN')
        .expect(200);

      await request(app.getHttpServer())
        .delete('/platform/books/1')
        .set('x-test-role', 'PLATFORM_ADMIN')
        .expect(200);

      expect(booksServiceMock.create).toHaveBeenCalledTimes(1);
      expect(booksServiceMock.update).toHaveBeenCalledTimes(1);
      expect(booksServiceMock.toggle).toHaveBeenCalledTimes(1);
      expect(booksServiceMock.softDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('SEC-IMP-02 — CSPRNG password generation without Math.random()', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('generates passwords in ImportsService, TeachersService, ParentsService, and PlatformUsersService without Math.random()', async () => {
      const mathRandomSpy = jest.spyOn(Math, 'random');

      const importsService = new ImportsService(
        {} as any,
        {} as any,
        {} as any,
      );
      for (let i = 0; i < 20; i++) {
        const pwd = (importsService as any).generatePassword(1001);
        expect(pwd).toMatch(/^\d{6}$/);
      }

      const teachersService = new TeachersService({} as any, {} as any);
      for (let i = 0; i < 20; i++) {
        const pwd = (teachersService as any).generatePassword();
        expect(pwd).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      }

      const parentsService = new ParentsService({} as any, {} as any);
      for (let i = 0; i < 20; i++) {
        const pwd = (parentsService as any).generatePassword();
        expect(pwd).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      }

      const platformUsersPrisma: any = {
        platformUser: {
          findFirst: jest.fn().mockResolvedValue({
            id: 7,
            uuid: 'platform-user-1',
            name: 'معلم منصة',
            username: 'platform_teacher_1',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const sessionsMock: any = {
        revokeAllUserSessions: jest.fn().mockResolvedValue({ success: true }),
      };
      const platformUsersService = new PlatformUsersService(
        platformUsersPrisma,
        sessionsMock,
      );
      const resetResult = await platformUsersService.resetPassword(
        'platform-user-1',
      );
      expect(resetResult.uuid).toBe('platform-user-1');
      expect(platformUsersPrisma.platformUser.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { passwordHash: expect.stringMatching(/^\$2[aby]\$/) },
      });
      expect(sessionsMock.revokeAllUserSessions).toHaveBeenCalledWith({
        platformUserId: 7,
        reason: 'PASSWORD_CHANGED',
      });

      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });
});
