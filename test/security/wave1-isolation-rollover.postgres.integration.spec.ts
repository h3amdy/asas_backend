/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppType, EnrollmentStatus, UserType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { UserCodeGeneratorService } from '../../src/common/user-code/user-code-generator.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ParentsService } from '../../src/school/manager/parents/parents.service';
import { RolloverService } from '../../src/school/manager/rollover/rollover.service';
import { RolloverStatus } from '../../src/school/manager/rollover/dto/rollover.dto';
import { SubjectsService } from '../../src/school/manager/subjects/subjects.service';
import { TeachersService } from '../../src/school/manager/teachers/teachers.service';
import { LessonDeliveryService } from '../../src/school/teacher/lesson-targeting/lesson-delivery.service';
import { TeacherLessonTargetingService } from '../../src/school/teacher/lesson-targeting/teacher-lesson-targeting.service';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolvePgBinary(name: 'createdb' | 'dropdb'): string {
  const candidates = [
    `/usr/local/opt/libpq/bin/${name}`,
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return name;
}

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_wave1_sec_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(
      `SAFETY: test database name "${dbName}" violates safe ephemeral naming format.`,
    );
  }
  const lower = dbName.toLowerCase();
  if (
    lower.includes('prod') ||
    lower.includes('staging') ||
    lower.includes('dev')
  ) {
    throw new Error(`SAFETY: "${dbName}" matches a protected database name.`);
  }
}

describe('Wave 1 Independent Verification — Real PostgreSQL Two-School Isolation & Rollover', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prismaA: PrismaService;
  let prismaB: PrismaService;

  let teachersService: TeachersService;
  let parentsService: ParentsService;
  let subjectsService: SubjectsService;
  let targetingService: TeacherLessonTargetingService;
  let rolloverServiceA: RolloverService;
  let rolloverServiceB: RolloverService;

  // Seeded School A & School B IDs/UUIDs
  let schoolA: any;
  let schoolB: any;
  let yearA: any;
  let yearB: any;
  let termA: any;
  let termB: any;
  let gradeA1: any;
  let gradeA2: any;
  let gradeB1: any;
  let secA1: any;
  let secA2: any;
  let secA_unlinked: any;
  let secA_grade2: any;
  let secB1: any;

  let teacherA1User: any;
  let teacherA2User: any;
  let teacherBUser: any;
  let parentAUser: any;
  let parentBUser: any;
  let studentAUser: any;
  let studentA2User: any;
  let studentBUser: any;

  let subjectA1: any;
  let subjectB1: any;
  let slotA1: any;
  let slotB1: any;
  let tplA1: any;

  beforeAll(async () => {
    tempDbName = `asas_wave1_sec_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);

    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}?connection_limit=20`;

    await execFileAsync(resolvePgBinary('createdb'), [
      '-h',
      'localhost',
      '-p',
      '5432',
      tempDbName,
    ]);
    dbCreated = true;

    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    prismaA = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaB = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prismaA.$connect();
    await prismaB.$connect();

    const rows: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(
        `ISOLATION FAILURE: connected to "${rows[0]?.db}" instead of "${tempDbName}"`,
      );
    }

    const userCodeGen = new UserCodeGeneratorService();
    teachersService = new TeachersService(prismaA, userCodeGen);
    parentsService = new ParentsService(prismaA, userCodeGen);
    subjectsService = new SubjectsService(prismaA);
    targetingService = new TeacherLessonTargetingService(
      prismaA,
      new LessonDeliveryService(prismaA),
    );
    rolloverServiceA = new RolloverService(prismaA);
    rolloverServiceB = new RolloverService(prismaB);

    const dummyHash = await bcrypt.hash('TestPass#123', 10);

    // 1. Seed School A and School B
    schoolA = await prismaA.school.create({
      data: {
        name: 'School A',
        displayName: 'مدرسة أ',
        schoolCode: 91001,
        appType: AppType.PRIVATE,
      },
    });
    schoolB = await prismaA.school.create({
      data: {
        name: 'School B',
        displayName: 'مدرسة ب',
        schoolCode: 91002,
        appType: AppType.PRIVATE,
      },
    });

    // 2. Years & Terms
    yearA = await prismaA.year.create({
      data: { schoolId: schoolA.id, name: '2025-2026', isCurrent: true },
    });
    termA = await prismaA.term.create({
      data: {
        yearId: yearA.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-01-15'),
        isCurrent: true,
      },
    });
    yearB = await prismaA.year.create({
      data: { schoolId: schoolB.id, name: '2025-2026', isCurrent: true },
    });
    termB = await prismaA.term.create({
      data: {
        yearId: yearB.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-01-15'),
        isCurrent: true,
      },
    });

    // 3. Grades & Sections
    gradeA1 = await prismaA.schoolGrade.create({
      data: { schoolId: schoolA.id, displayName: 'أول أ', sortOrder: 1 },
    });
    gradeA2 = await prismaA.schoolGrade.create({
      data: { schoolId: schoolA.id, displayName: 'ثاني أ', sortOrder: 2 },
    });
    gradeB1 = await prismaA.schoolGrade.create({
      data: { schoolId: schoolB.id, displayName: 'أول ب', sortOrder: 1 },
    });

    secA1 = await prismaA.section.create({
      data: { gradeId: gradeA1.id, name: 'شعبة أ-1', orderIndex: 1 },
    });
    secA2 = await prismaA.section.create({
      data: { gradeId: gradeA1.id, name: 'شعبة أ-2', orderIndex: 2 },
    });
    secA_unlinked = await prismaA.section.create({
      data: { gradeId: gradeA1.id, name: 'شعبة أ-3', orderIndex: 3 },
    });
    secA_grade2 = await prismaA.section.create({
      data: { gradeId: gradeA2.id, name: 'شعبة ثاني-أ', orderIndex: 1 },
    });
    secB1 = await prismaA.section.create({
      data: { gradeId: gradeB1.id, name: 'شعبة ب-1', orderIndex: 1 },
    });

    // 4. Teachers, Parents, Students
    teacherA1User = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 2291001,
        name: 'معلم أ1',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({
      data: { userId: teacherA1User.id, specialization: 'رياضيات' },
    });

    teacherA2User = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.TEACHER,
        code: 2291002,
        name: 'معلم أ2',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({
      data: { userId: teacherA2User.id, specialization: 'علوم' },
    });

    teacherBUser = await prismaA.user.create({
      data: {
        schoolId: schoolB.id,
        userType: UserType.TEACHER,
        code: 2291003,
        name: 'معلم ب',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({
      data: { userId: teacherBUser.id, specialization: 'فيزياء' },
    });

    parentAUser = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.PARENT,
        code: 2291004,
        name: 'ولي أمر أ',
        phone: '+967771000001',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.parent.create({ data: { userId: parentAUser.id } });

    parentBUser = await prismaA.user.create({
      data: {
        schoolId: schoolB.id,
        userType: UserType.PARENT,
        code: 2291005,
        name: 'ولي أمر ب',
        phone: '+967772000001',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.parent.create({ data: { userId: parentBUser.id } });

    studentAUser = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: 2291006,
        name: 'طالب أ',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.student.create({ data: { userId: studentAUser.id } });
    await prismaA.studentEnrollment.create({
      data: {
        studentId: studentAUser.id,
        yearId: yearA.id,
        gradeId: gradeA1.id,
        sectionId: secA1.id,
        isCurrent: true,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    studentA2User = await prismaA.user.create({
      data: {
        schoolId: schoolA.id,
        userType: UserType.STUDENT,
        code: 2291008,
        name: 'طالب أ ٢',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.student.create({ data: { userId: studentA2User.id } });
    await prismaA.studentEnrollment.create({
      data: {
        studentId: studentA2User.id,
        yearId: yearA.id,
        gradeId: gradeA1.id,
        sectionId: secA1.id,
        isCurrent: true,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    studentBUser = await prismaA.user.create({
      data: {
        schoolId: schoolB.id,
        userType: UserType.STUDENT,
        code: 2291007,
        name: 'طالب ب',
        passwordHash: dummyHash,
        isActive: true,
      },
    });
    await prismaA.student.create({ data: { userId: studentBUser.id } });
    await prismaA.studentEnrollment.create({
      data: {
        studentId: studentBUser.id,
        yearId: yearB.id,
        gradeId: gradeB1.id,
        sectionId: secB1.id,
        isCurrent: true,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    await prismaA.parentStudent.create({
      data: { parentId: parentBUser.id, studentId: studentBUser.id },
    });

    // 5. Subjects, SubjectSections, Teacher assignments
    subjectA1 = await prismaA.subject.create({
      data: {
        schoolId: schoolA.id,
        gradeId: gradeA1.id,
        displayName: 'الرياضيات أ',
      },
    });
    const subjectA2 = await prismaA.subject.create({
      data: {
        schoolId: schoolA.id,
        gradeId: gradeA1.id,
        displayName: 'العلوم أ',
      },
    });
    subjectB1 = await prismaA.subject.create({
      data: {
        schoolId: schoolB.id,
        gradeId: gradeB1.id,
        displayName: 'الرياضيات ب',
      },
    });

    const ssA1 = await prismaA.subjectSection.create({
      data: { subjectId: subjectA1.id, sectionId: secA1.id },
    });
    // Assign secA2 to subjectA1 too, but do NOT assign secA2 to teacherA1!
    await prismaA.subjectSection.create({
      data: { subjectId: subjectA1.id, sectionId: secA2.id },
    });
    const ssA2_sci = await prismaA.subjectSection.create({
      data: { subjectId: subjectA2.id, sectionId: secA2.id },
    });
    const ssB1 = await prismaA.subjectSection.create({
      data: { subjectId: subjectB1.id, sectionId: secB1.id },
    });

    await prismaA.subjectSectionTeacher.create({
      data: {
        subjectSectionId: ssA1.id,
        teacherId: teacherA1User.id,
        isActive: true,
      },
    });
    await prismaA.subjectSectionTeacher.create({
      data: {
        subjectSectionId: ssA2_sci.id,
        teacherId: teacherA2User.id,
        isActive: true,
      },
    });
    await prismaA.subjectSectionTeacher.create({
      data: {
        subjectSectionId: ssB1.id,
        teacherId: teacherBUser.id,
        isActive: true,
      },
    });

    // 6. Published Timetables & Slots in School A & School B
    const ttA1 = await prismaA.timetable.create({
      data: {
        sectionId: secA1.id,
        yearId: yearA.id,
        termId: termA.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    slotA1 = await prismaA.timetableSlot.create({
      data: {
        timetableId: ttA1.id,
        weekday: 1,
        lessonNumber: 1,
        subjectSectionId: ssA1.id,
      },
    });

    const ttB1 = await prismaA.timetable.create({
      data: {
        sectionId: secB1.id,
        yearId: yearB.id,
        termId: termB.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    slotB1 = await prismaA.timetableSlot.create({
      data: {
        timetableId: ttB1.id,
        weekday: 1,
        lessonNumber: 1,
        subjectSectionId: ssB1.id,
      },
    });

    // 7. LessonTemplate in School A (READY)
    tplA1 = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'SCHOOL',
        schoolId: schoolA.id,
        subjectId: subjectA1.id,
        title: 'درس المعادلات - أ',
        status: 'READY',
        createdByUserId: teacherA1User.id,
      },
    });
  });

  afterAll(async () => {
    await prismaA?.$disconnect().catch(() => undefined);
    await prismaB?.$disconnect().catch(() => undefined);

    if (dbCreated && tempDbName) {
      assertSafeTestDb(tempDbName);
      await execFileAsync(resolvePgBinary('dropdb'), [
        '-h',
        'localhost',
        '-p',
        '5432',
        '--if-exists',
        tempDbName,
      ]).catch(() => undefined);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. SEC-ISO-01 — TeachersService Cross-School Read/Update/Delete
  // ═══════════════════════════════════════════════════════════════════
  describe('SEC-ISO-01 (PostgreSQL): TeachersService blocks all cross-school access & writes', () => {
    it('rejects School A reading, updating, toggling, resetting password, or viewing credentials of School B teacher', async () => {
      const before = await prismaA.user.findUniqueOrThrow({
        where: { id: teacherBUser.id },
        include: { teacher: true },
      });

      await expect(
        teachersService.getTeacherProfile(teacherBUser.uuid, schoolA.id),
      ).rejects.toThrow(NotFoundException);

      await expect(
        teachersService.updateTeacher(teacherBUser.uuid, schoolA.id, {
          name: 'Tampered Teacher B',
          specialization: 'Hacked',
        } as any),
      ).rejects.toThrow(NotFoundException);

      await expect(
        teachersService.toggleActive(teacherBUser.uuid, schoolA.id, false),
      ).rejects.toThrow(NotFoundException);

      await expect(
        teachersService.resetPassword(
          teacherBUser.uuid,
          schoolA.id,
          'EvilPass123',
        ),
      ).rejects.toThrow(NotFoundException);

      await expect(
        teachersService.getCredentials(teacherBUser.uuid, schoolA.id),
      ).rejects.toThrow(NotFoundException);

      // Verify zero DB mutations occurred on School B teacher
      const after = await prismaA.user.findUniqueOrThrow({
        where: { id: teacherBUser.id },
        include: { teacher: true },
      });
      expect(after.name).toBe(before.name);
      expect(after.isActive).toBe(before.isActive);
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.teacher?.specialization).toBe(before.teacher?.specialization);

      // Positive control: School A updates own teacher cleanly
      const ownProfile = await teachersService.updateTeacher(
        teacherA1User.uuid,
        schoolA.id,
        { name: 'معلم أ1 المحدث' } as any,
      );
      expect(ownProfile.name).toBe('معلم أ1 المحدث');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. SEC-ISO-02 — ParentsService Practical Verification
  // ═══════════════════════════════════════════════════════════════════
  describe('SEC-ISO-02 (PostgreSQL): ParentsService isolation & cross-school child linking check', () => {
    it('blocks School A reading/modifying School B parent and blocks cross-school child linking/unlinking', async () => {
      const beforeParentB = await prismaA.user.findUniqueOrThrow({
        where: { id: parentBUser.id },
      });

      await expect(
        parentsService.getParentProfile(parentBUser.uuid, schoolA.id),
      ).rejects.toThrow(NotFoundException);

      await expect(
        parentsService.updateParent(parentBUser.uuid, schoolA.id, {
          name: 'Tampered Parent B',
        } as any),
      ).rejects.toThrow(NotFoundException);

      await expect(
        parentsService.toggleActive(parentBUser.uuid, schoolA.id, false),
      ).rejects.toThrow(NotFoundException);

      await expect(
        parentsService.resetPassword(
          parentBUser.uuid,
          schoolA.id,
          'EvilPass123',
        ),
      ).rejects.toThrow(NotFoundException);

      await expect(
        parentsService.getCredentials(parentBUser.uuid, schoolA.id),
      ).rejects.toThrow(NotFoundException);

      const afterParentB = await prismaA.user.findUniqueOrThrow({
        where: { id: parentBUser.id },
      });
      expect(afterParentB.name).toBe(beforeParentB.name);
      expect(afterParentB.isActive).toBe(beforeParentB.isActive);
      expect(afterParentB.passwordHash).toBe(beforeParentB.passwordHash);

      // First establish a legitimate baseline link (parentA -> studentA) to verify mixed requests do NOT alter it
      const initialLinkRes = await parentsService.linkChildren(
        parentAUser.uuid,
        schoolA.id,
        { studentUuids: [studentAUser.uuid] },
      );
      expect(initialLinkRes).toEqual({ success: true, linked: 1 });

      const baselineLink = await prismaA.parentStudent.findUniqueOrThrow({
        where: {
          parentId_studentId: {
            parentId: parentAUser.id,
            studentId: studentAUser.id,
          },
        },
      });

      // Attempt linking School A parent to School B student alone -> rejected
      await expect(
        parentsService.linkChildren(parentAUser.uuid, schoolA.id, {
          studentUuids: [studentBUser.uuid],
        }),
      ).rejects.toThrow(
        new BadRequestException('INVALID_STUDENTS_FOR_SCHOOL'),
      );

      // Attempt linking School A parent with MIXED [valid studentA2, foreign studentB] -> ENTIRE request rejected, ZERO new links
      await expect(
        parentsService.linkChildren(parentAUser.uuid, schoolA.id, {
          studentUuids: [studentA2User.uuid, studentBUser.uuid],
        }),
      ).rejects.toThrow(
        new BadRequestException('INVALID_STUDENTS_FOR_SCHOOL'),
      );

      // Attempt linking School A parent with MIXED [valid studentA2, nonexistent UUID] -> ENTIRE request rejected, ZERO new links
      await expect(
        parentsService.linkChildren(parentAUser.uuid, schoolA.id, {
          studentUuids: [
            studentA2User.uuid,
            '00000000-0000-4000-8000-000000000000',
          ],
        }),
      ).rejects.toThrow(
        new BadRequestException('INVALID_STUDENTS_FOR_SCHOOL'),
      );

      // Attempt linking with blank UUID -> rejected without partial write
      await expect(
        parentsService.linkChildren(parentAUser.uuid, schoolA.id, {
          studentUuids: [studentA2User.uuid, '   '],
        }),
      ).rejects.toThrow(
        new BadRequestException('INVALID_STUDENTS_FOR_SCHOOL'),
      );

      // Verify NO link created for valid-in-mixed studentA2 OR foreign studentB
      const partialValidLink = await prismaA.parentStudent.findFirst({
        where: { parentId: parentAUser.id, studentId: studentA2User.id },
      });
      expect(partialValidLink).toBeNull();

      const crossLink = await prismaA.parentStudent.findFirst({
        where: { parentId: parentAUser.id, studentId: studentBUser.id },
      });
      expect(crossLink).toBeNull();

      // Verify pre-existing legitimate link remained completely untouched
      const parentALinksAfter = await prismaA.parentStudent.findMany({
        where: { parentId: parentAUser.id },
      });
      expect(parentALinksAfter).toHaveLength(1);
      expect(parentALinksAfter[0].id).toBe(baselineLink.id);
      expect(parentALinksAfter[0].isDeleted).toBe(false);
      expect(parentALinksAfter[0].updatedAt.getTime()).toBe(
        baselineLink.updatedAt.getTime(),
      );

      // Attempt unlinking School B child from School A parent or School B parent under School A context -> rejected
      await expect(
        parentsService.unlinkChild(
          parentAUser.uuid,
          schoolA.id,
          studentBUser.uuid,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        parentsService.unlinkChild(
          parentBUser.uuid,
          schoolA.id,
          studentBUser.uuid,
        ),
      ).rejects.toThrow(NotFoundException);

      // School B's legitimate link stays intact
      const intactLinkB = await prismaA.parentStudent.findFirst({
        where: {
          parentId: parentBUser.id,
          studentId: studentBUser.id,
          isDeleted: false,
        },
      });
      expect(intactLinkB).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. SEC-ISO-03 — SubjectsService Multi-Tenant & Zero Partial Writes
  // ═══════════════════════════════════════════════════════════════════
  describe('SEC-ISO-03 (PostgreSQL): SubjectsService blocks cross-school/cross-grade sections with ZERO partial writes', () => {
    it('rejects mixed [valid same-school section, foreign School B section] atomically with zero writes', async () => {
      const ssCountBefore = await prismaA.subjectSection.count({
        where: { subjectId: subjectA1.id },
      });

      await expect(
        subjectsService.assignToSections(schoolA.id, subjectA1.id, {
          sectionIds: [secA_unlinked.id, secB1.id],
        }),
      ).rejects.toThrow(BadRequestException);

      // Verify ZERO partial write even for secA_unlinked!
      const leakedUnlinked = await prismaA.subjectSection.findUnique({
        where: {
          subjectId_sectionId: {
            subjectId: subjectA1.id,
            sectionId: secA_unlinked.id,
          },
        },
      });
      const leakedForeign = await prismaA.subjectSection.findUnique({
        where: {
          subjectId_sectionId: {
            subjectId: subjectA1.id,
            sectionId: secB1.id,
          },
        },
      });
      const ssCountAfter = await prismaA.subjectSection.count({
        where: { subjectId: subjectA1.id },
      });

      expect(leakedUnlinked).toBeNull();
      expect(leakedForeign).toBeNull();
      expect(ssCountAfter).toBe(ssCountBefore);

      // Also reject section belonging to wrong grade inside same school
      await expect(
        subjectsService.assignToSections(schoolA.id, subjectA1.id, {
          sectionIds: [secA_grade2.id],
        }),
      ).rejects.toThrow(BadRequestException);

      // Cross-school removeFromSection must not affect School B's subject_sections
      await subjectsService.removeFromSection(schoolA.id, subjectA1.id, secB1.id);
      const ssB1Intact = await prismaA.subjectSection.findFirst({
        where: { subjectId: subjectB1.id, sectionId: secB1.id, isDeleted: false },
      });
      expect(ssB1Intact).not.toBeNull();

      // Cross-school assignTeacherToSection & unassignTeacherFromSection rejected
      await expect(
        subjectsService.assignTeacherToSection(
          schoolA.id,
          subjectA1.uuid,
          secB1.id,
          teacherA1User.uuid,
        ),
      ).rejects.toThrow(NotFoundException);

      await expect(
        subjectsService.assignTeacherToSection(
          schoolA.id,
          subjectA1.uuid,
          secA1.id,
          teacherBUser.uuid,
        ),
      ).rejects.toThrow(NotFoundException);

      await expect(
        subjectsService.unassignTeacherFromSection(
          schoolA.id,
          subjectA1.uuid,
          secB1.id,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. SEC-ISO-04 & SEC-TCH-01 — TeacherLessonTargetingService
  // ═══════════════════════════════════════════════════════════════════
  describe('SEC-ISO-04 & SEC-TCH-01 (PostgreSQL): TimetableSlot isolation, teacher ownership & rollback integrity', () => {
    it('rejects foreign School B slotUuid in saveTargeting with full transaction rollback (ZERO partial rows)', async () => {
      await expect(
        targetingService.saveTargeting(schoolA.id, teacherA1User.uuid, tplA1.uuid, {
          linkType: 'SLOT_COVERAGE',
          sectionUuids: [secA1.uuid],
          slotAssignments: [{ slotUuid: slotB1.uuid, sectionUuid: secA1.uuid }],
        } as any),
      ).rejects.toThrow(ForbiddenException);

      // Verify full PostgreSQL rollback: ZERO Lesson / Target / TimetableSlot / Log rows created
      expect(
        await prismaA.lesson.count({ where: { templateId: tplA1.id } }),
      ).toBe(0);
      expect(await prismaA.lessonTarget.count()).toBe(0);
      expect(await prismaA.lessonTimetableSlot.count()).toBe(0);
      expect(await prismaA.lessonDeliveryLog.count()).toBe(0);
    });

    it('blocks horizontal cross-teacher targeting/publishing (SEC-TCH-01) and enforces per-section assignment', async () => {
      // Teacher A1 tries to target secA2 (not assigned to Teacher A1) -> rejected
      await expect(
        targetingService.saveTargeting(schoolA.id, teacherA1User.uuid, tplA1.uuid, {
          linkType: 'ADDITIONAL',
          sectionUuids: [secA2.uuid],
        } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(
        await prismaA.lesson.count({ where: { templateId: tplA1.id } }),
      ).toBe(0);

      // Teacher A1 tries getTimetableSlotsForSection on unassigned secA2 -> rejected
      await expect(
        targetingService.getTimetableSlotsForSection(
          schoolA.id,
          teacherA1User.uuid,
          subjectA1.uuid,
          secA2.uuid,
        ),
      ).rejects.toThrow(ForbiddenException);

      // Teacher A1 legitimately saves targeting on secA1 with slotA1
      const saved = await targetingService.saveTargeting(
        schoolA.id,
        teacherA1User.uuid,
        tplA1.uuid,
        {
          linkType: 'SLOT_COVERAGE',
          sectionUuids: [secA1.uuid],
          slotAssignments: [{ slotUuid: slotA1.uuid, sectionUuid: secA1.uuid }],
        } as any,
      );
      expect(saved.targetedSections).toEqual([secA1.uuid]);

      // Updating an existing targeting with an invalid foreign slot rolls back cleanly leaving prior target intact
      await expect(
        targetingService.saveTargeting(schoolA.id, teacherA1User.uuid, tplA1.uuid, {
          linkType: 'SLOT_COVERAGE',
          sectionUuids: [secA1.uuid],
          slotAssignments: [{ slotUuid: slotB1.uuid, sectionUuid: secA1.uuid }],
        } as any),
      ).rejects.toThrow(ForbiddenException);

      const intactTargets = await prismaA.lessonTarget.findMany({
        where: { lesson: { templateId: tplA1.id } },
      });
      const intactLessonSlots = await prismaA.lessonTimetableSlot.findMany({
        where: { lesson: { templateId: tplA1.id } },
      });
      expect(intactTargets).toHaveLength(1);
      expect(intactLessonSlots).toHaveLength(1);
      expect(intactLessonSlots[0].timetableSlotId).toBe(slotA1.id);

      // Teacher A2 (assigned to different subject) attempts getTargeting / publishLesson / cancelSchedule / getDeliveryStatus
      await expect(
        targetingService.getTargeting(schoolA.id, teacherA2User.uuid, tplA1.uuid),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        targetingService.publishLesson(schoolA.id, teacherA2User.uuid, tplA1.uuid),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        targetingService.cancelSchedule(schoolA.id, teacherA2User.uuid, tplA1.uuid),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        targetingService.getDeliveryStatus(
          schoolA.id,
          teacherA2User.uuid,
          tplA1.uuid,
        ),
      ).rejects.toThrow(ForbiddenException);

      const unchangedLesson = await prismaA.lesson.findFirstOrThrow({
        where: { templateId: tplA1.id },
      });
      expect(unchangedLesson.status).toBe('READY');
      expect(unchangedLesson.publishedAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. SEC-ROL-01 & SEC-ROL-02 — Real PostgreSQL Rollover & Race Test
  // ═══════════════════════════════════════════════════════════════════
  describe('SEC-ROL-01 & SEC-ROL-02 (PostgreSQL): Multi-grade rollover, repeated rollover & concurrent execution', () => {
    it('promotes 3 grades accurately without cascading graduation, copies only own timetable, and rejects repeated rollover', async () => {
      const dummyHash = await bcrypt.hash('RollPass#1', 10);

      const schoolR1 = await prismaA.school.create({
        data: {
          name: 'Rollover School 1',
          displayName: 'مدرسة ترحيل 1',
          schoolCode: 92001,
          appType: AppType.PRIVATE,
        },
      });
      const r1Year1 = await prismaA.year.create({
        data: { schoolId: schoolR1.id, name: '2025-2026', isCurrent: true },
      });
      const r1Term1 = await prismaA.term.create({
        data: {
          yearId: r1Year1.id,
          name: 'الفصل الأول',
          orderIndex: 1,
          startDate: new Date('2025-09-01'),
          endDate: new Date('2026-01-15'),
          isCurrent: false, // Ended — eligible for rollover
        },
      });

      const r1G1 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR1.id, displayName: 'الأول', sortOrder: 1 },
      });
      const r1G2 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR1.id, displayName: 'الثاني', sortOrder: 2 },
      });
      const r1G3 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR1.id, displayName: 'الثالث', sortOrder: 3 },
      });

      const r1S1 = await prismaA.section.create({
        data: { gradeId: r1G1.id, name: 'أ', orderIndex: 1 },
      });
      const r1S2 = await prismaA.section.create({
        data: { gradeId: r1G2.id, name: 'أ', orderIndex: 1 },
      });
      const r1S3 = await prismaA.section.create({
        data: { gradeId: r1G3.id, name: 'أ', orderIndex: 1 },
      });

      const createStudent = async (
        code: number,
        name: string,
        gradeId: number,
        sectionId: number,
      ) => {
        const u = await prismaA.user.create({
          data: {
            schoolId: schoolR1.id,
            userType: UserType.STUDENT,
            code,
            name,
            passwordHash: dummyHash,
            isActive: true,
          },
        });
        await prismaA.student.create({ data: { userId: u.id } });
        const enr = await prismaA.studentEnrollment.create({
          data: {
            studentId: u.id,
            yearId: r1Year1.id,
            gradeId,
            sectionId,
            isCurrent: true,
            status: EnrollmentStatus.ACTIVE,
          },
        });
        return { userId: u.id, enrollmentId: enr.id };
      };

      const st1Promote = await createStudent(2292001, 'ناجح 1', r1G1.id, r1S1.id);
      const st1Repeat = await createStudent(2292002, 'راسب 1', r1G1.id, r1S1.id);
      const st2Promote = await createStudent(2292003, 'ناجح 2', r1G2.id, r1S2.id);
      const st2Withdraw = await createStudent(2292004, 'منسحب 2', r1G2.id, r1S2.id);
      const st3Graduate = await createStudent(2292005, 'خريج 3', r1G3.id, r1S3.id);

      // Published timetable in schoolR1 (must copy)
      const r1Sub = await prismaA.subject.create({
        data: { schoolId: schoolR1.id, gradeId: r1G1.id, displayName: 'لغة عربية' },
      });
      const r1SS = await prismaA.subjectSection.create({
        data: { subjectId: r1Sub.id, sectionId: r1S1.id },
      });
      const r1TT = await prismaA.timetable.create({
        data: {
          sectionId: r1S1.id,
          yearId: r1Year1.id,
          termId: r1Term1.id,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      await prismaA.timetableSlot.create({
        data: {
          timetableId: r1TT.id,
          weekday: 1,
          lessonNumber: 1,
          subjectSectionId: r1SS.id,
        },
      });

      const rolloverDto = {
        year: {
          name: '2026-2027',
          terms: [
            {
              name: 'الفصل الأول الجديد',
              orderIndex: 1,
              startDate: '2026-09-01',
              endDate: '2027-01-15',
            },
          ],
        },
        gradeMigrations: [
          { sourceGradeId: r1G1.id, targetGradeId: r1G2.id },
          { sourceGradeId: r1G2.id, targetGradeId: r1G3.id },
          { sourceGradeId: r1G3.id, targetGradeId: null },
        ],
        studentStatuses: [
          {
            studentId: st1Repeat.userId,
            enrollmentId: st1Repeat.enrollmentId,
            status: RolloverStatus.REPEATED,
          },
          {
            studentId: st2Withdraw.userId,
            enrollmentId: st2Withdraw.enrollmentId,
            status: RolloverStatus.WITHDRAWN,
          },
        ],
        copyTimetable: true,
      };

      const res = await rolloverServiceA.execute(schoolR1.id, rolloverDto);

      expect(res.promotedCount).toBe(2);
      expect(res.repeatedCount).toBe(1);
      expect(res.withdrawnCount).toBe(1);
      expect(res.graduatedCount).toBe(1);
      expect(res.timetableCopied).toBe(true);

      // Verify exact DB enrollments in newYearId
      const verifyStudent = async (
        studentId: number,
        expectedTotalEnrollments: number,
        expectedNewGradeId: number | null,
      ) => {
        const rows = await prismaA.studentEnrollment.findMany({
          where: { studentId },
          orderBy: { yearId: 'asc' },
        });
        expect(rows).toHaveLength(expectedTotalEnrollments);
        const newRow = rows.find((r) => r.yearId === res.newYearId);
        if (expectedNewGradeId === null) {
          expect(newRow).toBeUndefined();
          expect(rows.every((r) => r.isCurrent === false)).toBe(true);
        } else {
          expect(newRow).toBeDefined();
          expect(newRow!.gradeId).toBe(expectedNewGradeId);
          expect(newRow!.isCurrent).toBe(true);
          expect(newRow!.status).toBe(EnrollmentStatus.ACTIVE);
        }
      };

      await verifyStudent(st1Promote.userId, 2, r1G2.id); // Promoted ONCE to Grade 2!
      await verifyStudent(st1Repeat.userId, 2, r1G1.id);  // Repeated in Grade 1!
      await verifyStudent(st2Promote.userId, 2, r1G3.id); // Promoted ONCE to Grade 3!
      await verifyStudent(st2Withdraw.userId, 1, null);   // Withdrawn (DROPPED)
      await verifyStudent(st3Graduate.userId, 1, null);   // Graduated ONLY from Grade 3!

      // Verify ONLY schoolR1 timetables exist in newYearId
      const newTimetables = await prismaA.timetable.findMany({
        where: { yearId: res.newYearId },
        include: { section: { include: { grade: true } }, slots: true },
      });
      expect(newTimetables).toHaveLength(1);
      expect(newTimetables[0].section.grade.schoolId).toBe(schoolR1.id);
      expect(newTimetables[0].slots).toHaveLength(1);

      // Repeated rollover attempt -> rejected cleanly with no extra year
      await expect(
        rolloverServiceA.execute(schoolR1.id, {
          ...rolloverDto,
          year: { ...rolloverDto.year, name: '2027-2028' },
          studentStatuses: [],
        }),
      ).rejects.toThrow(ConflictException);

      expect(
        await prismaA.year.count({ where: { schoolId: schoolR1.id } }),
      ).toBe(2);
    });

    it('serializes concurrent rollover requests on two independent PostgreSQL connections (SEC-ROL-02)', async () => {
      const dummyHash = await bcrypt.hash('RacePass#1', 10);

      const schoolR2 = await prismaA.school.create({
        data: {
          name: 'Rollover Concurrent School',
          displayName: 'مدرسة تزامن الترحيل',
          schoolCode: 92002,
          appType: AppType.PRIVATE,
        },
      });
      const year1 = await prismaA.year.create({
        data: { schoolId: schoolR2.id, name: '2025-2026', isCurrent: true },
      });
      await prismaA.term.create({
        data: {
          yearId: year1.id,
          name: 'الفصل الأول',
          orderIndex: 1,
          startDate: new Date('2025-09-01'),
          endDate: new Date('2026-01-15'),
          isCurrent: false,
        },
      });
      const g1 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR2.id, displayName: 'أول', sortOrder: 1 },
      });
      const g2 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR2.id, displayName: 'ثاني', sortOrder: 2 },
      });
      const s1 = await prismaA.section.create({
        data: { gradeId: g1.id, name: 'أ', orderIndex: 1 },
      });
      await prismaA.section.create({
        data: { gradeId: g2.id, name: 'أ', orderIndex: 1 },
      });

      const stu = await prismaA.user.create({
        data: {
          schoolId: schoolR2.id,
          userType: UserType.STUDENT,
          code: 2292101,
          name: 'طالب التزامن',
          passwordHash: dummyHash,
          isActive: true,
        },
      });
      await prismaA.student.create({ data: { userId: stu.id } });
      await prismaA.studentEnrollment.create({
        data: {
          studentId: stu.id,
          yearId: year1.id,
          gradeId: g1.id,
          sectionId: s1.id,
          isCurrent: true,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      const raceDto = {
        year: {
          name: '2026-2027',
          terms: [
            {
              name: 'الفصل الأول',
              orderIndex: 1,
              startDate: '2026-09-01',
              endDate: '2027-01-15',
            },
          ],
        },
        gradeMigrations: [
          { sourceGradeId: g1.id, targetGradeId: g2.id },
          { sourceGradeId: g2.id, targetGradeId: null },
        ],
        studentStatuses: [],
        copyTimetable: false,
      };

      const settled = await Promise.allSettled([
        rolloverServiceA.execute(schoolR2.id, raceDto),
        rolloverServiceB.execute(schoolR2.id, raceDto),
      ]);

      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
      );
      const rejected = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);

      // Verify exactly 2 years exist (old=false, new=true) and student promoted ONCE
      const yearsAfter = await prismaA.year.findMany({
        where: { schoolId: schoolR2.id },
      });
      expect(yearsAfter).toHaveLength(2);
      expect(yearsAfter.filter((y) => y.isCurrent)).toHaveLength(1);

      const enrollmentsAfter = await prismaA.studentEnrollment.findMany({
        where: { studentId: stu.id },
      });
      expect(enrollmentsAfter).toHaveLength(2);
      expect(enrollmentsAfter.filter((e) => e.isCurrent)).toHaveLength(1);
      expect(
        enrollmentsAfter.find((e) => e.isCurrent)?.gradeId,
      ).toBe(g2.id);
    });

    it('serializes concurrent future-startDate rollover requests where new term has isCurrent=false (SEC-ROL-02)', async () => {
      const dummyHash = await bcrypt.hash('FutureRace#1', 10);

      const schoolR3 = await prismaA.school.create({
        data: {
          name: 'Rollover Future Concurrent School',
          displayName: 'مدرسة تزامن الفصل المستقبلي',
          schoolCode: 92003,
          appType: AppType.PRIVATE,
        },
      });
      const oldYear = await prismaA.year.create({
        data: { schoolId: schoolR3.id, name: '2025-2026', isCurrent: true },
      });
      await prismaA.term.create({
        data: {
          yearId: oldYear.id,
          name: 'الفصل الأول المنتهي',
          orderIndex: 1,
          startDate: new Date('2025-09-01'),
          endDate: new Date('2026-01-15'),
          isCurrent: false,
        },
      });

      const g1 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR3.id, displayName: 'أول', sortOrder: 1 },
      });
      const g2 = await prismaA.schoolGrade.create({
        data: { schoolId: schoolR3.id, displayName: 'ثاني', sortOrder: 2 },
      });
      const s1 = await prismaA.section.create({
        data: { gradeId: g1.id, name: 'أ', orderIndex: 1 },
      });
      const s2 = await prismaA.section.create({
        data: { gradeId: g2.id, name: 'أ', orderIndex: 1 },
      });

      const stuPromote = await prismaA.user.create({
        data: {
          schoolId: schoolR3.id,
          userType: UserType.STUDENT,
          code: 2292201,
          name: 'طالب ترحيل مستقبلي أ',
          passwordHash: dummyHash,
          isActive: true,
        },
      });
      await prismaA.student.create({ data: { userId: stuPromote.id } });
      await prismaA.studentEnrollment.create({
        data: {
          studentId: stuPromote.id,
          yearId: oldYear.id,
          gradeId: g1.id,
          sectionId: s1.id,
          isCurrent: true,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      const stuGraduate = await prismaA.user.create({
        data: {
          schoolId: schoolR3.id,
          userType: UserType.STUDENT,
          code: 2292202,
          name: 'طالب تخرج مستقبلي ب',
          passwordHash: dummyHash,
          isActive: true,
        },
      });
      await prismaA.student.create({ data: { userId: stuGraduate.id } });
      await prismaA.studentEnrollment.create({
        data: {
          studentId: stuGraduate.id,
          yearId: oldYear.id,
          gradeId: g2.id,
          sectionId: s2.id,
          isCurrent: true,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      // Use strictly future term startDate so newly created Term has isCurrent: false
      const futureDto = {
        year: {
          name: '2027-2028',
          terms: [
            {
              name: 'الفصل المستقبلي الأول',
              orderIndex: 1,
              startDate: '2027-09-01',
              endDate: '2028-01-15',
            },
          ],
        },
        gradeMigrations: [
          { sourceGradeId: g1.id, targetGradeId: g2.id },
          { sourceGradeId: g2.id, targetGradeId: null },
        ],
        studentStatuses: [],
        copyTimetable: false,
      };

      const settled = await Promise.allSettled([
        rolloverServiceA.execute(schoolR3.id, futureDto),
        rolloverServiceB.execute(schoolR3.id, futureDto),
      ]);

      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
      );
      const rejected = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value.promotedCount).toBe(1);
      expect(fulfilled[0].value.graduatedCount).toBe(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect((rejected[0].reason as Error).message).toBe('ALREADY_ROLLED_OVER');

      // Verify exactly 2 years exist, new year is current, and its future term has isCurrent=false
      const yearsAfter = await prismaA.year.findMany({
        where: { schoolId: schoolR3.id },
        include: { terms: true },
        orderBy: { id: 'asc' },
      });
      expect(yearsAfter).toHaveLength(2);
      expect(yearsAfter.filter((y) => y.isCurrent)).toHaveLength(1);
      const newYear = yearsAfter.find((y) => y.id === fulfilled[0].value.newYearId)!;
      expect(newYear.isCurrent).toBe(true);
      expect(newYear.terms).toHaveLength(1);
      expect(newYear.terms[0].isCurrent).toBe(false);

      // Promoted student promoted ONCE; graduated student graduated ONCE
      const promoteEnrollments = await prismaA.studentEnrollment.findMany({
        where: { studentId: stuPromote.id },
      });
      expect(promoteEnrollments).toHaveLength(2);
      expect(promoteEnrollments.filter((e) => e.isCurrent)).toHaveLength(1);
      expect(promoteEnrollments.find((e) => e.isCurrent)?.gradeId).toBe(g2.id);

      const graduateEnrollments = await prismaA.studentEnrollment.findMany({
        where: { studentId: stuGraduate.id },
      });
      expect(graduateEnrollments).toHaveLength(1);
      expect(graduateEnrollments[0].isCurrent).toBe(false);
      expect(graduateEnrollments[0].status).toBe(EnrollmentStatus.PROMOTED);
    });
  });
});
