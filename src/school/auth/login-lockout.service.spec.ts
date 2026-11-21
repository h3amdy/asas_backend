/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHmac } from 'node:crypto';
import { permuteFiveDigitsV1 } from '../../common/user-code/user-code-permutation';
import { runEnvironmentValidation } from '../../config/environment-safety';
import { ImportsService } from '../../owner/imports/imports.service';
import { SchoolLoginDto } from './dto/school-login.dto';
import {
  deriveLockoutHmacKeys,
  LoginLockoutService,
  normalizeClientIp,
} from './login-lockout.service';

describe('SEC-NUM-01 — Unit Security Controls (HKDF/HMAC, UTF-8 Byte Validation, Import CSPRNG, V1 Freeze)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('1. HKDF-SHA256 & HMAC Domain Separation', () => {
    it('derives two completely distinct 256-bit keys for code_hash and ip_hash and never uses JWT_SECRET directly', () => {
      const jwtSecret = 'test-jwt-secret-with-high-entropy-at-least-32-chars!!';
      process.env.APP_ENV = 'local';
      process.env.JWT_SECRET = jwtSecret;
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;

      const { codeKey, ipKey } = deriveLockoutHmacKeys(jwtSecret);
      expect(codeKey.length).toBe(32);
      expect(ipKey.length).toBe(32);
      expect(codeKey.equals(ipKey)).toBe(false);

      const service = new LoginLockoutService({} as any);
      const codeHash = service.hashCode(2261431);
      // مقارنة نفس المدخل كسلسلة IP لإثبات اختلاف النطاقين تماماً
      const ipHashSameLiteral = service.hashIp('2261431');
      const directHmac = createHmac('sha256', jwtSecret)
        .update('2261431', 'utf8')
        .digest('hex');

      expect(codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(ipHashSameLiteral).toMatch(/^[a-f0-9]{64}$/);
      expect(codeHash).not.toBe(ipHashSameLiteral);
      expect(codeHash).not.toBe(directHmac);
      expect(ipHashSameLiteral).not.toBe(directHmac);
      expect(codeHash).not.toContain('2261431');
    });

    it('normalizes IPv4-mapped IPv6 addresses consistently and rejects empty production keys fail-closed', () => {
      process.env.APP_ENV = 'local';
      process.env.JWT_SECRET = 'dev-jwt-secret-key-at-least-32-characters-long';
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;

      expect(normalizeClientIp('::ffff:198.51.100.10')).toBe('198.51.100.10');
      expect(normalizeClientIp('  ::FFFF:198.51.100.10 ')).toBe('198.51.100.10');
      expect(normalizeClientIp(undefined)).toBe('unknown');
      expect(normalizeClientIp('   ')).toBe('unknown');

      const service = new LoginLockoutService({} as any);
      expect(service.hashIp('::ffff:198.51.100.10')).toBe(
        service.hashIp('198.51.100.10'),
      );
      expect(service.hashIp('198.51.100.10')).not.toContain('198.51.100.10');

      process.env.APP_ENV = 'production';
      delete process.env.JWT_SECRET;
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;
      expect(() => service.hashCode(2261431)).toThrow(
        'LOGIN_LOCKOUT_HMAC_KEY or JWT_SECRET is required in staging/production',
      );
    });

    it('isolates lock digests from JWT_SECRET rotation when independent LOGIN_LOCKOUT_HMAC_KEY is set', () => {
      process.env.APP_ENV = 'production';
      process.env.JWT_SECRET = 'jwt-secret-v1-minimum-32-characters-long!!';
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;

      const service = new LoginLockoutService({} as any);
      const fallbackHashV1 = service.hashCode(2261431);

      // عند غياب LOGIN_LOCKOUT_HMAC_KEY: تدوير JWT_SECRET يغيّر الـ hash المشتق
      process.env.JWT_SECRET = 'jwt-secret-v2-rotated-minimum-32-chars-long!';
      const fallbackHashV2 = service.hashCode(2261431);
      expect(fallbackHashV2).not.toBe(fallbackHashV1);

      // عند تعيين LOGIN_LOCKOUT_HMAC_KEY مستقل: تدوير JWT_SECRET لا يغيّر الـ hash إطلاقاً
      process.env.LOGIN_LOCKOUT_HMAC_KEY =
        'independent-lockout-hmac-key-32-bytes-minimum!!';
      const isolatedHashBefore = service.hashCode(2261431);
      process.env.JWT_SECRET = 'jwt-secret-v3-rotated-again-32-chars-long!!';
      const isolatedHashAfter = service.hashCode(2261431);
      expect(isolatedHashAfter).toBe(isolatedHashBefore);
      expect(isolatedHashBefore).not.toBe(fallbackHashV2);

      // وتغيير LOGIN_LOCKOUT_HMAC_KEY نفسه يغيّر الـ hash
      process.env.LOGIN_LOCKOUT_HMAC_KEY =
        'independent-lockout-hmac-key-v2-32-bytes-min!!';
      expect(service.hashCode(2261431)).not.toBe(isolatedHashBefore);
    });
  });

  describe('2. SchoolLoginDto (@MaxLength(72) + @MaxUtf8Bytes(72))', () => {
    const basePayload = {
      identifier: '2261431',
      deviceFingerprint: 'fp-device-1',
      deviceType: 'ANDROID',
    };

    it('accepts legacy 6-digit, 8-digit, 12-char, 72 ASCII bytes, and 36 Arabic chars (72 UTF-8 bytes)', async () => {
      for (const password of [
        '123456',
        '87654321',
        'ABCDEFGH2345',
        'A'.repeat(72),
        'أ'.repeat(36), // 36 * 2 = 72 UTF-8 bytes
      ]) {
        const dto = plainToInstance(SchoolLoginDto, {
          ...basePayload,
          password,
        });
        const errors = await validate(dto);
        expect(errors).toEqual([]);
      }
    });

    it('rejects 73 ASCII bytes AND 37 Arabic chars (74 UTF-8 bytes despite length=37 < 72)', async () => {
      const ascii73 = plainToInstance(SchoolLoginDto, {
        ...basePayload,
        password: 'A'.repeat(73),
      });
      const asciiErrors = await validate(ascii73);
      expect(asciiErrors.some((e) => e.property === 'password')).toBe(true);

      const arabic37 = plainToInstance(SchoolLoginDto, {
        ...basePayload,
        password: 'أ'.repeat(37), // length = 37 (< 72) لكنها 74 بايت UTF-8 (> 72)
      });
      const utf8Errors = await validate(arabic37);
      expect(utf8Errors.length).toBe(1);
      expect(utf8Errors[0].property).toBe('password');
      expect(utf8Errors[0].constraints).toHaveProperty('maxUtf8Bytes');
    });
  });

  describe('3. ImportsService CSPRNG Password Policy', () => {
    it('generates 8-digit CSPRNG passwords for students and 12-char unambiguous alphanumeric for teachers/parents without Math.random()', () => {
      const mathRandomSpy = jest.spyOn(Math, 'random');
      const importsService = new ImportsService(
        {} as any,
        {} as any,
        {} as any,
      );

      expect((importsService as any).generatePassword).toBeUndefined();
      expect((importsService as any).useRandomPassword).toBeUndefined();

      const studentPasswords = new Set<string>();
      const teacherPasswords = new Set<string>();
      const parentPasswords = new Set<string>();

      for (let i = 0; i < 60; i++) {
        const s = (importsService as any).generateImportPassword('STUDENT');
        expect(s).toMatch(/^[1-9]\d{7}$/);
        expect(Number(s)).toBeGreaterThanOrEqual(10_000_000);
        expect(Number(s)).toBeLessThanOrEqual(99_999_999);
        studentPasswords.add(s);

        const t = (importsService as any).generateImportPassword('TEACHER');
        expect(t).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
        expect(t).not.toMatch(/[01ILO]/);
        teacherPasswords.add(t);

        const p = (importsService as any).generateImportPassword('PARENT');
        expect(p).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
        expect(p).not.toMatch(/[01ILO]/);
        parentPasswords.add(p);
      }

      expect(studentPasswords.size).toBeGreaterThan(55);
      expect(teacherPasswords.size).toBe(60);
      expect(parentPasswords.size).toBe(60);
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. permuteFiveDigitsV1 Freeze & Environment Safety Validation', () => {
    it('keeps permuteFiveDigitsV1 golden vectors strictly unchanged', () => {
      expect(22 * 100_000 + permuteFiveDigitsV1(0, 22)).toBe(2261431);
      expect(22 * 100_000 + permuteFiveDigitsV1(1, 22)).toBe(2228871);
      expect(22 * 100_000 + permuteFiveDigitsV1(99999, 22)).toBe(2210066);
    });

    it('validates JWT_SECRET and LOGIN_LOCKOUT_HMAC_KEY in environment-safety', () => {
      process.env.APP_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://asasuser@127.0.0.1:5432/asasprod';
      process.env.MEDIA_STORAGE_PATH = '/var/data/asas/media';
      process.env.BACKUP_STORAGE_PATH = '/var/backups/mafhooom';
      process.env.ACTIVATION_CODE_ENC_KEY_V1 = Buffer.alloc(32, 1).toString('base64');
      process.env.ACTIVATION_CODE_HMAC_KEY_V1 = Buffer.alloc(32, 2).toString('base64');
      process.env.IMPORT_CREDENTIALS_ENC_KEY = Buffer.from(
        Array.from({ length: 32 }, (_, i) => i + 11),
      ).toString('base64');
      process.env.JWT_SECRET = '   ';
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;

      const emptyJwt = runEnvironmentValidation();
      expect(emptyJwt.valid).toBe(false);

      process.env.JWT_SECRET = 'prod-strong-jwt-secret-over-32-characters-123456';
      const missingLockoutKey = runEnvironmentValidation();
      expect(missingLockoutKey.valid).toBe(true);
      expect(
        missingLockoutKey.warnings.some((w) =>
          w.includes('LOGIN_LOCKOUT_HMAC_KEY غير محدد'),
        ),
      ).toBe(true);

      process.env.LOGIN_LOCKOUT_HMAC_KEY = 'too-short';
      const weakLockoutKey = runEnvironmentValidation();
      expect(weakLockoutKey.valid).toBe(false);

      process.env.LOGIN_LOCKOUT_HMAC_KEY = Buffer.from(
        Array.from({ length: 32 }, (_, i) => i + 1),
      ).toString('base64');
      const strongLockoutKey = runEnvironmentValidation();
      expect(strongLockoutKey.valid).toBe(true);
      expect(
        strongLockoutKey.warnings.some((w) =>
          w.includes('LOGIN_LOCKOUT_HMAC_KEY'),
        ),
      ).toBe(false);
    });
  });
});
