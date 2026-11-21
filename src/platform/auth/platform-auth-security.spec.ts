/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PlatformRole } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import bcrypt = require('bcrypt');
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHmac } from 'node:crypto';
import { LoginLockoutModule } from '../../common/auth/login-lockout.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  deriveLockoutHmacKeys,
  LoginLockoutException,
  LoginLockoutService,
  normalizePlatformLogin,
} from '../../school/auth/login-lockout.service';
import { SchoolAuthModule } from '../../school/auth/school-auth.module';
import { SchoolAuthService } from '../../school/auth/school-auth.service';
import { PLATFORM_AUTH_ERRORS } from './constants';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformRefreshDto } from './dto/platform-refresh.dto';
import { PlatformAuthModule } from './platform-auth.module';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformSessionsService } from '../sessions/platform-sessions.service';

describe('Platform Auth & SEC-AUTH-08 — Unit Security Controls', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('1. 4-Domain HKDF-SHA256 Separation & Login Normalization', () => {
    it('derives four distinct 256-bit keys (codeKey, ipKey, platformLoginKey, platformAccountKey) and isolates namespaces', () => {
      const jwtSecret = 'unit-test-jwt-secret-with-plenty-of-entropy-12345';
      process.env.APP_ENV = 'local';
      process.env.JWT_SECRET = jwtSecret;
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;

      const { codeKey, ipKey, platformLoginKey, platformAccountKey } =
        deriveLockoutHmacKeys(jwtSecret);

      expect(codeKey).toHaveLength(32);
      expect(ipKey).toHaveLength(32);
      expect(platformLoginKey).toHaveLength(32);
      expect(platformAccountKey).toHaveLength(32);
      expect(codeKey.equals(ipKey)).toBe(false);
      expect(codeKey.equals(platformLoginKey)).toBe(false);
      expect(codeKey.equals(platformAccountKey)).toBe(false);
      expect(ipKey.equals(platformLoginKey)).toBe(false);
      expect(ipKey.equals(platformAccountKey)).toBe(false);
      expect(platformLoginKey.equals(platformAccountKey)).toBe(false);

      const lockout = new LoginLockoutService({} as PrismaService);
      const schoolHash = lockout.hashCode(2261431);
      const platformNumericHash = lockout.hashPlatformLogin('2261431');
      const platformAccountHash = lockout.hashPlatformAccount(2261431);
      const ipSameLiteralHash = lockout.hashIp('2261431');
      const directHmac = createHmac('sha256', jwtSecret)
        .update('2261431', 'utf8')
        .digest('hex');

      expect(platformNumericHash).toMatch(/^[a-f0-9]{64}$/);
      expect(platformAccountHash).toMatch(/^[a-f0-9]{64}$/);
      expect(platformNumericHash).not.toBe(schoolHash);
      expect(platformNumericHash).not.toBe(platformAccountHash);
      expect(platformNumericHash).not.toBe(ipSameLiteralHash);
      expect(platformNumericHash).not.toBe(directHmac);
      expect(platformAccountHash).not.toBe(schoolHash);
      expect(platformAccountHash).not.toBe(ipSameLiteralHash);
      expect(platformAccountHash).not.toBe(directHmac);

      expect(normalizePlatformLogin('  Owner@Mafhooom.COM  ')).toBe(
        'owner@mafhooom.com',
      );
      expect(lockout.hashPlatformLogin('  Owner@Mafhooom.COM ')).toBe(
        lockout.hashPlatformLogin('owner@mafhooom.com'),
      );
    });

    it('shares one singleton LoginLockoutService instance across SchoolAuthModule and PlatformAuthModule', async () => {
      process.env.JWT_SECRET = 'unit-test-jwt-secret-with-plenty-of-entropy-12345';
      process.env.PLATFORM_JWT_SECRET =
        'unit-test-platform-jwt-secret-plenty-of-entropy-12345';
      const mockPrisma = {
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
        $executeRaw: jest.fn(),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'short', ttl: 60000, limit: 10 },
            { name: 'long', ttl: 3600000, limit: 60 },
          ]),
          LoginLockoutModule,
          SchoolAuthModule,
          PlatformAuthModule,
        ],
      })
        .overrideProvider(PrismaService)
        .useValue(mockPrisma)
        .compile();

      const fromRoot = moduleRef.get(LoginLockoutService);
      const schoolService = moduleRef.get(SchoolAuthService) as unknown as {
        lockout: LoginLockoutService;
      };
      const platformService = moduleRef.get(PlatformAuthService) as unknown as {
        lockout: LoginLockoutService;
      };
      expect(platformService.lockout).toBe(fromRoot);
      expect(schoolService.lockout).toBe(fromRoot);

      await moduleRef.close();
    });
  });

  describe('2. DTO Boundary Validation (PlatformLoginDto & PlatformRefreshDto)', () => {
    it('trims login, rejects blank/oversized login, and enforces 72 UTF-8 bytes on password', async () => {
      const trimmedValid = plainToInstance(PlatformLoginDto, {
        login: '  owner@asas.com  ',
        password: 'a'.repeat(72),
      });
      expect(trimmedValid.login).toBe('owner@asas.com');
      expect(await validate(trimmedValid)).toHaveLength(0);

      const blankAfterTrim = plainToInstance(PlatformLoginDto, {
        login: '    ',
        password: 'ValidPassword#1',
      });
      expect(await validate(blankAfterTrim)).not.toHaveLength(0);

      const tooLongLogin = plainToInstance(PlatformLoginDto, {
        login: 'a'.repeat(201),
        password: 'ValidPassword#1',
      });
      expect(await validate(tooLongLogin)).not.toHaveLength(0);

      // 19 4-byte emojis: length=38 chars (UTF-16), but 76 UTF-8 bytes > 72 bcrypt limit
      const emoji76Bytes = plainToInstance(PlatformLoginDto, {
        login: 'owner@asas.com',
        password: '🔑'.repeat(19),
      });
      expect(await validate(emoji76Bytes)).not.toHaveLength(0);

      // 37 2-byte Arabic chars: length=37 <= 72, but 74 UTF-8 bytes > 72
      const arabic74Bytes = plainToInstance(PlatformLoginDto, {
        login: 'owner@asas.com',
        password: 'م'.repeat(37),
      });
      expect(await validate(arabic74Bytes)).not.toHaveLength(0);

      // 36 2-byte Arabic chars = 72 UTF-8 bytes (accepted)
      const arabic72Bytes = plainToInstance(PlatformLoginDto, {
        login: 'owner@asas.com',
        password: 'م'.repeat(36),
      });
      expect(await validate(arabic72Bytes)).toHaveLength(0);
    });

    it('rejects empty or oversized sessionId/refreshToken in PlatformRefreshDto', async () => {
      const validDto = plainToInstance(PlatformRefreshDto, {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        refreshToken: 'a'.repeat(96),
      });
      expect(await validate(validDto)).toHaveLength(0);

      const badSession = plainToInstance(PlatformRefreshDto, {
        sessionId: 'x'.repeat(129),
        refreshToken: 'a'.repeat(96),
      });
      expect(await validate(badSession)).not.toHaveLength(0);

      const badToken = plainToInstance(PlatformRefreshDto, {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        refreshToken: 'a'.repeat(513),
      });
      expect(await validate(badToken)).not.toHaveLength(0);
    });
  });

  describe('3. PlatformAuthService Anti-Enumeration & Lockout Ordering', () => {
    function buildServiceMocks() {
      const prisma = {
        platformUser: { findFirst: jest.fn() },
        platformAuthSession: { findUnique: jest.fn() },
      };
      const jwtService = {
        sign: jest.fn().mockReturnValue('signed.jwt.token'),
      };
      const sessions = {
        createSession: jest.fn(),
        validateAndRotateRefresh: jest.fn(),
        revokeSession: jest.fn(),
      };
      const lockout = {
        assertPlatformNotLocked: jest.fn().mockResolvedValue(undefined),
        assertPlatformAccountNotLocked: jest.fn().mockResolvedValue(undefined),
        recordPlatformFailedAttempt: jest.fn().mockResolvedValue({
          codeIpCounted: true,
          codeGlobalCounted: true,
        }),
        clearPlatformOnSuccess: jest.fn().mockResolvedValue(undefined),
      };

      const service = new PlatformAuthService(
        prisma as unknown as PrismaService,
        jwtService as unknown as JwtService,
        sessions as unknown as PlatformSessionsService,
        lockout as unknown as LoginLockoutService,
      );
      return { service, prisma, sessions, lockout };
    }

    it('always runs bcrypt dummy comparison on unknown user and records lockout failure', async () => {
      const { service, prisma, lockout } = buildServiceMocks();
      prisma.platformUser.findFirst.mockResolvedValue(null);
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(
        service.login(
          { login: 'missing@asas.com', password: 'WrongPassword#1' },
          { clientIp: '198.51.100.1' },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );

      expect(lockout.assertPlatformNotLocked).toHaveBeenCalledWith(
        'missing@asas.com',
        '198.51.100.1',
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
      // التحقق من استخدام PLATFORM_TIMING_DUMMY_HASH صالح بنفس cost=10
      expect(compareSpy.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$.{53}$/);
      expect(lockout.recordPlatformFailedAttempt).toHaveBeenCalledWith(
        'missing@asas.com',
        '198.51.100.1',
        undefined,
      );
    });

    it('does NOT reveal ACCOUNT_DISABLED when password is wrong on a disabled account', async () => {
      const { service, prisma, sessions, lockout } = buildServiceMocks();
      const realHash = await bcrypt.hash('CorrectPass#1', 10);
      prisma.platformUser.findFirst.mockResolvedValue({
        id: 7,
        uuid: 'user-uuid-7',
        email: 'disabled@asas.com',
        username: 'disabled_admin',
        name: 'Disabled Admin',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: false,
        isDeleted: false,
        passwordHash: realHash,
      });

      await expect(
        service.login(
          { login: 'disabled@asas.com', password: 'WrongPassword#99' },
          { clientIp: '198.51.100.2' },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS),
      );

      expect(lockout.assertPlatformAccountNotLocked).toHaveBeenCalledWith(
        7,
        '198.51.100.2',
      );
      expect(lockout.recordPlatformFailedAttempt).toHaveBeenCalledWith(
        'disabled@asas.com',
        '198.51.100.2',
        7,
      );
      expect(lockout.clearPlatformOnSuccess).not.toHaveBeenCalled();
      expect(sessions.createSession).not.toHaveBeenCalled();
    });

    it('reveals ACCOUNT_DISABLED only when password matches on disabled account and never clears lockout or creates session', async () => {
      const { service, prisma, sessions, lockout } = buildServiceMocks();
      const realHash = await bcrypt.hash('CorrectPass#1', 10);
      prisma.platformUser.findFirst.mockResolvedValue({
        id: 7,
        uuid: 'user-uuid-7',
        email: 'disabled@asas.com',
        username: 'disabled_admin',
        name: 'Disabled Admin',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: false,
        isDeleted: false,
        passwordHash: realHash,
      });

      await expect(
        service.login(
          { login: 'disabled@asas.com', password: 'CorrectPass#1' },
          { clientIp: '198.51.100.2' },
        ),
      ).rejects.toThrow(
        new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED),
      );

      expect(lockout.clearPlatformOnSuccess).not.toHaveBeenCalled();
      expect(sessions.createSession).not.toHaveBeenCalled();
    });

    it('short-circuits before Prisma or bcrypt when LoginLockoutException is thrown', async () => {
      const { service, prisma, lockout } = buildServiceMocks();
      lockout.assertPlatformNotLocked.mockRejectedValue(
        new LoginLockoutException(120, PLATFORM_AUTH_ERRORS.RATE_LIMITED),
      );
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(
        service.login(
          { login: 'owner@asas.com', password: 'SomePassword#1' },
          { clientIp: '198.51.100.3' },
        ),
      ).rejects.toThrow(LoginLockoutException);

      expect(prisma.platformUser.findFirst).not.toHaveBeenCalled();
      expect(compareSpy).not.toHaveBeenCalled();
    });

    it('short-circuits before bcrypt when account-level lockout triggers across email/username aliases', async () => {
      const { service, prisma, lockout } = buildServiceMocks();
      const realHash = await bcrypt.hash('CorrectPass#1', 10);
      prisma.platformUser.findFirst.mockResolvedValue({
        id: 9,
        uuid: 'user-uuid-9',
        email: 'owner@asas.com',
        username: 'owner_user',
        name: 'Owner',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
        isDeleted: false,
        passwordHash: realHash,
      });
      lockout.assertPlatformAccountNotLocked.mockRejectedValue(
        new LoginLockoutException(120, PLATFORM_AUTH_ERRORS.RATE_LIMITED),
      );
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(
        service.login(
          { login: 'owner_user', password: 'CorrectPass#1' },
          { clientIp: '198.51.100.4' },
        ),
      ).rejects.toThrow(LoginLockoutException);

      expect(compareSpy).not.toHaveBeenCalled();
    });

    it('clears login, email, username, and account lockout keys on successful login', async () => {
      const { service, prisma, sessions, lockout } = buildServiceMocks();
      const realHash = await bcrypt.hash('CorrectPass#1', 10);
      prisma.platformUser.findFirst.mockResolvedValue({
        id: 11,
        uuid: 'user-uuid-11',
        email: 'owner@asas.com',
        username: 'owner_user',
        name: 'Owner',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
        isDeleted: false,
        passwordHash: realHash,
      });
      sessions.createSession.mockResolvedValue({
        uuid: 'session-uuid-11',
        expiresAt: new Date(Date.now() + 86400_000),
      });

      const res = await service.login(
        { login: '  owner_user  ', password: 'CorrectPass#1' },
        { clientIp: '198.51.100.5' },
      );

      expect(res.sessionId).toBe('session-uuid-11');
      expect(lockout.clearPlatformOnSuccess).toHaveBeenCalledWith(
        'owner_user',
        '198.51.100.5',
        {
          platformUserId: 11,
          email: 'owner@asas.com',
          username: 'owner_user',
        },
      );
    });
  });
});
