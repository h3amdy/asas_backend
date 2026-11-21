/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { runEnvironmentValidation } from '../../config/environment-safety';
import {
  ImportCredentialsCryptoService,
  IMPORT_CREDENTIALS_ENVELOPE_PREFIX,
} from '../../owner/imports/import-credentials-crypto.service';
import { ImportsService } from '../../owner/imports/imports.service';
import { AcademicYearsService } from '../../school/manager/academic-years/academic-years.service';
import { TimetableService } from '../../school/manager/timetable/timetable.service';
import { ReportsService } from '../../school/reports/reports.service';
import { TeacherReportController } from '../../school/teacher/reports/teacher-report.controller';

describe('Security Wave — SEC-ISO-05, SEC-TCH-02 (DUP-R3-01), and SEC-IMP-01 (Unit)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. SEC-ISO-05 — TimetableService & AcademicYearsService
  // ═══════════════════════════════════════════════════════════════

  describe('SEC-ISO-05 — Timetable cross-school isolation & read-only GET', () => {
    it('rejects cross-school yearId/termId in getTimetable without calling timetable.create', async () => {
      const prismaMock: any = {
        section: {
          findFirst: jest.fn().mockResolvedValue({
            id: 10,
            name: 'أ',
            grade: { displayName: 'الأول' },
          }),
        },
        term: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        timetable: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
      };

      const service = new TimetableService(prismaMock);
      await expect(service.getTimetable(1, 10, 999, 888)).rejects.toThrow(
        new NotFoundException('TERM_NOT_FOUND'),
      );
      expect(prismaMock.term.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 888,
            yearId: 999,
            isDeleted: false,
            year: { schoolId: 1, isDeleted: false },
          },
        }),
      );
      expect(prismaMock.timetable.create).not.toHaveBeenCalled();
    });

    it('returns empty structure on GET when no timetable exists without mutating DB', async () => {
      const prismaMock: any = {
        section: {
          findFirst: jest.fn().mockResolvedValue({
            id: 10,
            name: 'ب',
            grade: { displayName: 'الثاني' },
          }),
        },
        term: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
        timetable: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };

      const service = new TimetableService(prismaMock);
      const res = await service.getTimetable(1, 10, 4, 5);
      expect(res).toEqual({
        uuid: '',
        sectionId: 10,
        sectionName: 'ب',
        gradeName: 'الثاني',
        yearId: 4,
        termId: 5,
        slots: [],
      });
      expect(prismaMock.timetable.create).not.toHaveBeenCalled();
    });

    it('scopes saveTimetable subjectSection lookup by schoolId and uses atomic $transaction', async () => {
      const txMock = {
        timetable: { upsert: jest.fn().mockResolvedValue({ id: 77 }) },
        timetableSlot: { upsert: jest.fn() },
      };
      const prismaMock: any = {
        section: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) },
        term: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
        subjectSection: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(async (cb: any) => cb(txMock)),
      };

      const service = new TimetableService(prismaMock);
      await expect(
        service.saveTimetable(1, 10, 4, 5, {
          slots: [{ weekday: 0, lessonNumber: 1, subjectSectionId: 999 }],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.subjectSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [999] },
            sectionId: 10,
            isDeleted: false,
            subject: { schoolId: 1, isDeleted: false },
            section: { isDeleted: false, grade: { schoolId: 1, isDeleted: false } },
          },
        }),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects deleteSlot if sectionId does not match slot.timetable.sectionId or schoolId differs', async () => {
      const prismaMock: any = {
        timetableSlot: {
          findFirst: jest.fn().mockResolvedValue({
            id: 50,
            timetable: {
              id: 20,
              sectionId: 10,
              isDeleted: false,
              section: {
                isDeleted: false,
                grade: { schoolId: 1, isDeleted: false },
              },
            },
          }),
        },
        $transaction: jest.fn(),
      };

      const service = new TimetableService(prismaMock);
      await expect(service.deleteSlot(1, 'slot-uuid', 999)).rejects.toThrow(
        new NotFoundException('SLOT_NOT_FOUND'),
      );
      await expect(service.deleteSlot(2, 'slot-uuid', 10)).rejects.toThrow(
        new NotFoundException('SLOT_NOT_FOUND'),
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('validates section, term, and subjectSection ownership in checkTeacherConflicts and getTeacherTimetable', async () => {
      const prismaMock: any = {
        section: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) },
        term: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
        subjectSection: { findFirst: jest.fn().mockResolvedValue(null) },
        subjectSectionTeacher: { findFirst: jest.fn() },
        teacher: { findFirst: jest.fn() },
      };

      const service = new TimetableService(prismaMock);
      await expect(
        service.checkTeacherConflicts(1, 10, 4, 5, 0, 1, 777),
      ).rejects.toThrow(new NotFoundException('SUBJECT_SECTION_NOT_FOUND'));

      prismaMock.term.findFirst.mockResolvedValue(null);
      await expect(
        service.getTeacherTimetable(1, 'teacher-uuid', 4, 5),
      ).rejects.toThrow(new NotFoundException('TERM_NOT_FOUND'));
      expect(prismaMock.teacher.findFirst).not.toHaveBeenCalled();
    });

    it('passes schoolId into AcademicYearsService._copyTimetableBetweenTerms and filters by schoolId', async () => {
      const prismaMock: any = {
        year: { findFirst: jest.fn().mockResolvedValue({ id: 4, schoolId: 1 }) },
        term: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 5 })
            .mockResolvedValueOnce({ id: 6 }),
        },
        timetable: { findMany: jest.fn().mockResolvedValue([]) },
      };

      const service = new AcademicYearsService(prismaMock);
      const res = await service.copyTimetable(1, 4, {
        sourceTermId: 5,
        targetTermId: 6,
      });

      expect(res).toEqual({
        copied: 0,
        skipped: 0,
        message: 'NO_SOURCE_TIMETABLES',
      });
      expect(prismaMock.timetable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            yearId: 4,
            termId: 5,
            isDeleted: false,
            year: { schoolId: 1, isDeleted: false },
            term: { yearId: 4, isDeleted: false },
            section: {
              isDeleted: false,
              grade: { schoolId: 1, isDeleted: false },
            },
          }),
        }),
      );
    });

    it('scopes getSectionSubjects by subject.schoolId and isDeleted: false', async () => {
      const prismaMock: any = {
        section: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) },
        subjectSection: { findMany: jest.fn().mockResolvedValue([]) },
      };

      const service = new TimetableService(prismaMock);
      await expect(service.getSectionSubjects(1, 10)).resolves.toEqual([]);
      expect(prismaMock.subjectSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sectionId: 10,
            isDeleted: false,
            subject: { schoolId: 1, isDeleted: false },
            section: { isDeleted: false, grade: { schoolId: 1, isDeleted: false } },
          },
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. SEC-TCH-02 (+ DUP-R3-01) — TeacherReportController & ReportsService
  // ═══════════════════════════════════════════════════════════════

  describe('SEC-TCH-02 & DUP-R3-01 — Teacher report IDOR authorization', () => {
    it('filters getFilterOptions grades/sections/subjects to active teacher assignments only', async () => {
      const reportsServiceMock: any = {
        getFilterOptions: jest.fn().mockResolvedValue({
          years: [{ uuid: 'y1', name: '2026', isCurrent: true }],
          terms: [{ uuid: 't1', name: 'T1', isCurrent: true, yearUuid: 'y1' }],
          grades: [
            { uuid: 'g1', name: 'الصف 1' },
            { uuid: 'g2', name: 'الصف 2' },
          ],
          sections: [
            { uuid: 'sec1a', name: 'أ', gradeUuid: 'g1' },
            { uuid: 'sec1b', name: 'ب', gradeUuid: 'g1' },
          ],
          subjects: [
            { uuid: 'subj-math', name: 'رياضيات', gradeUuid: 'g1' },
            { uuid: 'subj-sci', name: 'علوم', gradeUuid: 'g1' },
          ],
        }),
      };

      const prismaMock: any = {
        user: { findFirst: jest.fn().mockResolvedValue({ teacher: { userId: 42 } }) },
        subjectSectionTeacher: {
          findMany: jest.fn().mockResolvedValue([
            {
              subjectSection: {
                section: { uuid: 'sec1a', grade: { uuid: 'g1' } },
                subject: { uuid: 'subj-math', grade: { uuid: 'g1' } },
              },
            },
          ]),
        },
      };

      const controller = new TeacherReportController(reportsServiceMock, prismaMock);
      const res = await controller.getFilterOptions({
        schoolContext: { id: 1 },
        user: { sub: 'teacher-uuid' },
      });

      expect(res.grades).toEqual([{ uuid: 'g1', name: 'الصف 1' }]);
      expect(res.sections).toEqual([{ uuid: 'sec1a', name: 'أ', gradeUuid: 'g1' }]);
      expect(res.subjects).toEqual([
        { uuid: 'subj-math', name: 'رياضيات', gradeUuid: 'g1' },
      ]);
      expect(res.years).toHaveLength(1);
      expect(res.terms).toHaveLength(1);
    });

    it('rejects getComprehensiveReport with missing subjectUuid (400) or unassigned subject (403)', async () => {
      const prismaMock: any = {
        user: { findFirst: jest.fn().mockResolvedValue({ teacher: { userId: 42 } }) },
        subjectSectionTeacher: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const controller = new TeacherReportController({} as any, prismaMock);

      await expect(
        controller.getComprehensiveReport(
          { schoolContext: { id: 1 }, user: { sub: 't1' } },
          '',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getComprehensiveReport(
          { schoolContext: { id: 1 }, user: { sub: 't1' } },
          'other-subject',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('enforces student section + teacher subject scope on detail, subject-detail, and closes 404/403 oracle on lesson-review (DUP-R3-01)', async () => {
      const reportsServiceMock: any = {
        getStudentComprehensiveDetail: jest.fn().mockResolvedValue({ ok: true }),
        getStudentSubjectComprehensive: jest.fn(),
        getStudentLessonReview: jest.fn(),
      };
      const prismaMock: any = {
        user: {
          findFirst: jest
            .fn()
            // call 1: teacher lookup (detail)
            .mockResolvedValueOnce({ teacher: { userId: 42 } })
            // call 2: student lookup in sec 101 (detail)
            .mockResolvedValueOnce({
              student: { userId: 201, enrollments: [{ sectionId: 101, gradeId: 1 }] },
            })
            // call 3: teacher lookup (subject detail)
            .mockResolvedValueOnce({ teacher: { userId: 42 } })
            // call 4: student lookup in sec 101 (subject detail)
            .mockResolvedValueOnce({
              student: { userId: 201, enrollments: [{ sectionId: 101, gradeId: 1 }] },
            })
            // call 5: teacher lookup (lesson review — unassigned section)
            .mockResolvedValueOnce({ teacher: { userId: 42 } })
            // call 6: student lookup in sec 999 (lesson review — unassigned section)
            .mockResolvedValueOnce({
              student: { userId: 202, enrollments: [{ sectionId: 999, gradeId: 1 }] },
            })
            // call 7: teacher lookup (lesson review — assigned section, missing/unassigned lesson)
            .mockResolvedValueOnce({ teacher: { userId: 42 } })
            // call 8: student lookup in sec 101 (lesson review)
            .mockResolvedValueOnce({
              student: { userId: 201, enrollments: [{ sectionId: 101, gradeId: 1 }] },
            }),
        },
        subjectSectionTeacher: {
          // detail -> teacher teaches ONLY subjectId 77 in sec 101
          findMany: jest
            .fn()
            .mockResolvedValueOnce([{ subjectSection: { subjectId: 77 } }])
            // lesson review call 1 -> teacher teaches ZERO subjects in sec 999
            .mockResolvedValueOnce([])
            // lesson review call 2 -> teacher teaches ONLY subjectId 77 in sec 101
            .mockResolvedValueOnce([{ subjectSection: { subjectId: 77 } }]),
          // subject detail -> not assigned in student's section
          findFirst: jest.fn().mockResolvedValue(null),
        },
        lesson: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        lessonTarget: {
          findFirst: jest.fn(),
        },
      };

      const controller = new TeacherReportController(reportsServiceMock, prismaMock);
      const req = { schoolContext: { id: 1 }, user: { sub: 't1' } };

      await controller.getStudentComprehensiveDetail(req, 'stu-1');
      expect(reportsServiceMock.getStudentComprehensiveDetail).toHaveBeenCalledWith(
        1,
        'stu-1',
        { yearUuid: undefined, termUuid: undefined, period: 'full_semester' },
        { allowedSubjectIds: [77] },
      );

      await expect(
        controller.getStudentSubjectComprehensive(req, 'stu-1', 'subj-other'),
      ).rejects.toThrow(ForbiddenException);
      expect(reportsServiceMock.getStudentSubjectComprehensive).not.toHaveBeenCalled();

      // Unassigned section rejects 403 WITHOUT ever querying lesson.findFirst (no 404/403 oracle)
      await expect(
        controller.getStudentLessonReview(req, 'stu-other-sec', 'lesson-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.lesson.findFirst).not.toHaveBeenCalled();

      // Assigned section + unassigned/missing lesson also returns unified 403 (never 404)
      await expect(
        controller.getStudentLessonReview(req, 'stu-1', 'lesson-unassigned-or-missing'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.lesson.findFirst).toHaveBeenCalledWith({
        where: {
          uuid: 'lesson-unassigned-or-missing',
          schoolId: 1,
          isDeleted: false,
          subjectId: { in: [77] },
        },
        select: { id: true },
      });
      expect(reportsServiceMock.getStudentLessonReview).not.toHaveBeenCalled();
    });

    it('restricts ReportsService.getStudentComprehensiveDetail subjects query when allowedSubjectIds is provided', async () => {
      const prismaMock: any = {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            uuid: 'stu-1',
            name: 'طالب',
            avatarMediaAsset: null,
            student: {
              userId: 201,
              enrollments: [
                {
                  gradeId: 1,
                  sectionId: 101,
                  grade: { id: 1, displayName: 'الأول' },
                  section: { id: 101, name: 'أ' },
                },
              ],
            },
          }),
        },
        year: { findFirst: jest.fn().mockResolvedValue(null) },
        subject: { findMany: jest.fn().mockResolvedValue([]) },
      };

      const service = new ReportsService(prismaMock, {} as any);
      await service.getStudentComprehensiveDetail(
        1,
        'stu-1',
        { period: 'full_semester' },
        { allowedSubjectIds: [77, 78] },
      );

      expect(prismaMock.subject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            schoolId: 1,
            isDeleted: false,
            isActive: true,
            grade: { id: 1 },
            id: { in: [77, 78] },
          },
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. SEC-IMP-01 — ImportCredentialsCryptoService + ImportsService TTL/Purge
  // ═══════════════════════════════════════════════════════════════

  describe('SEC-IMP-01 — Import credentials AES-256-GCM encryption, TTL, & cleanup', () => {
    it('encrypts with random IV, binds AAD to (schoolId, importUuid), and detects tampering', () => {
      process.env.APP_ENV = 'local';
      process.env.IMPORT_CREDENTIALS_ENC_KEY =
        'unit-test-import-enc-key-at-least-32-chars!!';

      const cryptoSvc = new ImportCredentialsCryptoService();
      const payload = [{ name: 'أحمد', schoolNumber: 2212345, password: 'SecRet#99', role: 'STUDENT' }];

      const enc1 = cryptoSvc.encrypt(payload, 10, 'import-uuid-1');
      const enc2 = cryptoSvc.encrypt(payload, 10, 'import-uuid-1');

      expect(enc1.startsWith(IMPORT_CREDENTIALS_ENVELOPE_PREFIX)).toBe(true);
      expect(enc1).not.toEqual(enc2); // IV مختلف لكل عملية تشفير
      expect(enc1).not.toContain('SecRet#99');
      expect(enc1).not.toContain('2212345');

      expect(cryptoSvc.decrypt(enc1, 10, 'import-uuid-1')).toEqual(payload);
      // AAD mismatch
      expect(() => cryptoSvc.decrypt(enc1, 11, 'import-uuid-1')).toThrow();
      expect(() => cryptoSvc.decrypt(enc1, 10, 'import-uuid-2')).toThrow();
      // Reject legacy plaintext
      expect(() =>
        cryptoSvc.decrypt(JSON.stringify(payload), 10, 'import-uuid-1'),
      ).toThrow('INVALID_IMPORT_CREDENTIALS_ENVELOPE');
      // Tampered ciphertext/tag
      const lastChar = enc1.slice(-1) === 'A' ? 'B' : 'A';
      expect(() =>
        cryptoSvc.decrypt(enc1.slice(0, -1) + lastChar, 10, 'import-uuid-1'),
      ).toThrow();
    });

    it('purges expired or legacy unencrypted credentials on getCredentials and throws 410 GoneException', async () => {
      process.env.APP_ENV = 'local';
      process.env.IMPORT_CREDENTIALS_ENC_KEY =
        'unit-test-import-enc-key-at-least-32-chars!!';
      process.env.IMPORT_CREDENTIALS_TTL_HOURS = '24';

      const cryptoSvc = new ImportCredentialsCryptoService();
      const validEnc = cryptoSvc.encrypt(
        [{ name: 'طالب', schoolNumber: 2212345, password: 'Pass#1', role: 'STUDENT' }],
        1,
        'imp-valid',
      );

      const updateMock = jest.fn().mockResolvedValue({});
      const prismaMock: any = {
        school: { findUnique: jest.fn().mockResolvedValue({ id: 1, uuid: 'sch-1' }) },
        importSession: {
          findUnique: jest.fn(),
          update: updateMock,
        },
      };

      const service = new ImportsService(
        prismaMock,
        {} as any,
        {} as any,
        cryptoSvc,
      );

      // 1) Valid within TTL
      prismaMock.importSession.findUnique.mockResolvedValueOnce({
        id: 100,
        uuid: 'imp-valid',
        schoolId: 1,
        importType: 'STUDENTS',
        status: 'COMPLETED',
        completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        credentialsJson: validEnc,
      });
      const ok = await service.getCredentials('sch-1', 'imp-valid');
      expect(ok.credentials).toHaveLength(1);
      expect(ok.credentials[0].password).toBe('Pass#1');
      expect(ok.expiresAt).toBeTruthy();

      // 2) Expired (>24h) -> wipes DB & throws 410
      prismaMock.importSession.findUnique.mockResolvedValueOnce({
        id: 101,
        uuid: 'imp-expired',
        schoolId: 1,
        importType: 'STUDENTS',
        status: 'COMPLETED',
        completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        credentialsJson: validEnc,
      });
      await expect(service.getCredentials('sch-1', 'imp-expired')).rejects.toThrow(
        GoneException,
      );
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 101 },
        data: { credentialsJson: null },
      });

      // 3) Legacy plaintext row -> wipes DB & throws 410
      prismaMock.importSession.findUnique.mockResolvedValueOnce({
        id: 102,
        uuid: 'imp-legacy',
        schoolId: 1,
        importType: 'STUDENTS',
        status: 'COMPLETED',
        completedAt: new Date(),
        createdAt: new Date(),
        credentialsJson: JSON.stringify([{ password: 'plain' }]),
      });
      await expect(service.getCredentials('sch-1', 'imp-legacy')).rejects.toThrow(
        GoneException,
      );
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 102 },
        data: { credentialsJson: null },
      });

      // 4) Corrupted/wrong-AAD ciphertext -> InternalServerErrorException
      const wrongSchoolEnc = cryptoSvc.encrypt([{ password: 'x' }], 999, 'imp-tampered');
      prismaMock.importSession.findUnique.mockResolvedValueOnce({
        id: 103,
        uuid: 'imp-tampered',
        schoolId: 1,
        importType: 'STUDENTS',
        status: 'COMPLETED',
        completedAt: new Date(),
        createdAt: new Date(),
        credentialsJson: wrongSchoolEnc,
      });
      await expect(service.getCredentials('sch-1', 'imp-tampered')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('enforces Fail-Closed IMPORT_CREDENTIALS_ENC_KEY in production (env validation + ImportCredentialsCryptoService.resolveKey) with zero JWT_SECRET fallback', () => {
      process.env.APP_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user@localhost:5432/asasprod';
      process.env.MEDIA_STORAGE_PATH = '/www/media';
      process.env.BACKUP_STORAGE_PATH = '/var/backups/mafhooom';
      process.env.JWT_SECRET = 'prod-strong-jwt-secret-key-at-least-32-chars!!';
      process.env.LOGIN_LOCKOUT_HMAC_KEY =
        'prod-strong-hmac-secret-key-at-least-32-chars!!';
      delete process.env.IMPORT_CREDENTIALS_ENC_KEY;

      // 1) Missing IMPORT_CREDENTIALS_ENC_KEY -> environment validation MUST fail in production
      const missingRes = runEnvironmentValidation();
      expect(missingRes.valid).toBe(false);
      expect(missingRes.errors.join('\n')).toContain('IMPORT_CREDENTIALS_ENC_KEY');

      // 2) ImportCredentialsCryptoService itself MUST refuse JWT_SECRET fallback in production
      const cryptoSvc = new ImportCredentialsCryptoService();
      expect(() => cryptoSvc.encrypt([{ password: 'x' }], 1, 'imp-prod-1')).toThrow(
        'IMPORT_CREDENTIALS_ENC_KEY is required in production',
      );

      // 3) Weak key & bad TTL -> both env validation and crypto service reject
      process.env.IMPORT_CREDENTIALS_ENC_KEY = 'weak-key';
      process.env.IMPORT_CREDENTIALS_TTL_HOURS = '999';

      const badRes = runEnvironmentValidation();
      expect(badRes.valid).toBe(false);
      expect(badRes.errors.join('\n')).toContain('IMPORT_CREDENTIALS_ENC_KEY');
      expect(badRes.errors.join('\n')).toContain('IMPORT_CREDENTIALS_TTL_HOURS');
      expect(() => cryptoSvc.encrypt([{ password: 'x' }], 1, 'imp-prod-2')).toThrow(
        'IMPORT_CREDENTIALS_ENC_KEY is too weak in production',
      );

      // 4) Strong dedicated key + valid TTL -> succeeds cleanly
      process.env.IMPORT_CREDENTIALS_ENC_KEY =
        'prod-strong-import-enc-key-at-least-32-chars!!';
      process.env.IMPORT_CREDENTIALS_TTL_HOURS = '24';
      const okRes = runEnvironmentValidation();
      expect(okRes.valid).toBe(true);
      const cipher = cryptoSvc.encrypt([{ password: 'ok' }], 1, 'imp-prod-3');
      expect(cryptoSvc.decrypt(cipher, 1, 'imp-prod-3')).toEqual([{ password: 'ok' }]);

      // 5) Switching to local allows non-production JWT fallback for dev/tests
      process.env.APP_ENV = 'local';
      delete process.env.IMPORT_CREDENTIALS_ENC_KEY;
      const localCipher = cryptoSvc.encrypt([{ password: 'dev' }], 1, 'imp-local-1');
      expect(cryptoSvc.decrypt(localCipher, 1, 'imp-local-1')).toEqual([{ password: 'dev' }]);
    });
  });
});
