/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RolloverService } from './rollover.service';

describe('SEC-ROL-01 & SEC-ROL-02: RolloverService cascading graduation prevention & locking', () => {
  function createInMemorySchool() {
    let nextYearId = 2;
    let nextEnrollmentId = 100;

    const grades = [
      { id: 1, schoolId: 1, displayName: 'الصف الأول', sortOrder: 1, isDeleted: false, isActive: true, sections: [{ id: 11, name: 'أ', orderIndex: 1 }] },
      { id: 2, schoolId: 1, displayName: 'الصف الثاني', sortOrder: 2, isDeleted: false, isActive: true, sections: [{ id: 21, name: 'أ', orderIndex: 1 }] },
      { id: 3, schoolId: 1, displayName: 'الصف الثالث', sortOrder: 3, isDeleted: false, isActive: true, sections: [{ id: 31, name: 'أ', orderIndex: 1 }] },
    ];

    const years = [
      { id: 1, schoolId: 1, name: '2025-2026', isCurrent: true, isDeleted: false, createdAt: new Date('2025-09-01'), terms: [{ id: 10, isCurrent: false, isDeleted: false }] },
    ];

    // 3 students: one in Grade 1, one in Grade 2, one in Grade 3 (graduating)
    const enrollments: any[] = [
      { id: 1, studentId: 1001, gradeId: 1, sectionId: 11, yearId: 1, isCurrent: true, isDeleted: false, status: 'ACTIVE' },
      { id: 2, studentId: 1002, gradeId: 2, sectionId: 21, yearId: 1, isCurrent: true, isDeleted: false, status: 'ACTIVE' },
      { id: 3, studentId: 1003, gradeId: 3, sectionId: 31, yearId: 1, isCurrent: true, isDeleted: false, status: 'ACTIVE' },
    ];

    const rawCalls: string[] = [];
    const timetableWhereCalls: any[] = [];

    const matchesEnrollment = (e: any, where: any) => {
      if (where.yearId !== undefined && e.yearId !== where.yearId) return false;
      if (where.gradeId !== undefined && e.gradeId !== where.gradeId) return false;
      if (where.isCurrent !== undefined && e.isCurrent !== where.isCurrent) return false;
      if (where.isDeleted !== undefined && e.isDeleted !== where.isDeleted) return false;
      return true;
    };

    const tx: any = {
      $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string) => {
        rawCalls.push(sql);
        return [{ id: 1 }];
      }),
      year: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id?.not) {
            return years.find((y) => y.schoolId === where.schoolId && !y.isDeleted && y.id !== where.id.not && y.createdAt > where.createdAt.gt) ?? null;
          }
          return years.find((y) => y.schoolId === where.schoolId && y.isCurrent === where.isCurrent && !y.isDeleted) ?? null;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const y = years.find((yr) => yr.id === where.id);
          if (y) Object.assign(y, data);
          return y;
        }),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const ny = { id: nextYearId++, ...data, isDeleted: false, createdAt: new Date(), terms: [] };
          years.push(ny);
          return ny;
        }),
      },
      term: {
        create: jest.fn().mockResolvedValue({ id: 99 }),
        findFirst: jest.fn().mockResolvedValue({ id: 10 }),
      },
      section: {
        create: jest.fn(),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const g = grades.find((gr) => gr.id === where.gradeId);
          return g ? g.sections.map((s) => ({ id: s.id, orderIndex: s.orderIndex })) : [];
        }),
      },
      studentEnrollment: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) =>
          enrollments
            .filter((e) => matchesEnrollment(e, where))
            .map((e) => ({ ...e, section: { orderIndex: 1 } })),
        ),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const rec = enrollments.find((e) => e.id === where.id);
          if (rec) Object.assign(rec, data);
          return rec;
        }),
        upsert: jest.fn().mockImplementation(async ({ where, create, update }: any) => {
          const existing = enrollments.find(
            (e) => e.studentId === where.studentId_yearId.studentId && e.yearId === where.studentId_yearId.yearId,
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created = { id: nextEnrollmentId++, isDeleted: false, ...create };
          enrollments.push(created);
          return created;
        }),
      },
      timetable: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          timetableWhereCalls.push(where);
          return [];
        }),
      },
    };

    const prisma: any = {
      year: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.id?.not) return null;
          return years[0];
        }),
      },
      schoolGrade: {
        findMany: jest.fn().mockResolvedValue(
          grades.map((g) => ({
            ...g,
            _count: {
              enrollments: enrollments.filter((e) => e.gradeId === g.id && e.isCurrent).length,
            },
          })),
        ),
      },
      studentEnrollment: {
        findMany: tx.studentEnrollment.findMany,
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };

    const service = new RolloverService(prisma);
    return { service, enrollments, rawCalls, timetableWhereCalls };
  }

  const baseDto: any = {
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
      { sourceGradeId: 1, targetGradeId: 2 },
      { sourceGradeId: 2, targetGradeId: 3 },
      { sourceGradeId: 3, targetGradeId: null },
    ],
    studentStatuses: [],
    copyTimetable: true,
  };

  it('promotes each grade exactly once without cascading students to graduation (SEC-ROL-01)', async () => {
    const { service, enrollments, rawCalls, timetableWhereCalls } = createInMemorySchool();

    const result = await service.execute(1, baseDto);

    expect(result.promotedCount).toBe(2);
    expect(result.graduatedCount).toBe(1);

    // Grade 1 student -> Grade 2 in newYear (yearId=2), active & current
    const s1001New = enrollments.find((e) => e.studentId === 1001 && e.yearId === 2);
    expect(s1001New).toBeDefined();
    expect(s1001New.gradeId).toBe(2);
    expect(s1001New.isCurrent).toBe(true);

    // Grade 2 student -> Grade 3 in newYear (yearId=2), active & current
    const s1002New = enrollments.find((e) => e.studentId === 1002 && e.yearId === 2);
    expect(s1002New).toBeDefined();
    expect(s1002New.gradeId).toBe(3);
    expect(s1002New.isCurrent).toBe(true);

    // Grade 3 student -> graduated, no yearId=2 enrollment
    const s1003New = enrollments.find((e) => e.studentId === 1003 && e.yearId === 2);
    expect(s1003New).toBeUndefined();

    // Acquired School FOR UPDATE lock and scoped copyTimetable by schoolId
    expect(rawCalls.some((s) => s.includes('FOR UPDATE'))).toBe(true);
    expect(timetableWhereCalls[0].section).toEqual({
      isDeleted: false,
      grade: { schoolId: 1, isDeleted: false },
    });
  });

  it('rejects duplicate sourceGradeId and self-migration mappings', async () => {
    const { service } = createInMemorySchool();

    await expect(
      service.execute(1, {
        ...baseDto,
        gradeMigrations: [
          { sourceGradeId: 1, targetGradeId: 2 },
          { sourceGradeId: 1, targetGradeId: 3 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.execute(1, {
        ...baseDto,
        gradeMigrations: [{ sourceGradeId: 1, targetGradeId: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks execution inside transaction if active term appears concurrently (SEC-ROL-02)', async () => {
    const { service } = createInMemorySchool();
    const txYearFindFirst = (service as any).prisma.$transaction;
    expect(txYearFindFirst).toBeDefined();

    // Override check inside transaction via mocking prisma.$transaction
    (service as any).prisma.$transaction = jest.fn().mockImplementation(async (cb: any) =>
      cb({
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 1 }]),
        year: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            terms: [{ id: 10, isCurrent: true }],
          }),
        },
      }),
    );

    await expect(service.execute(1, baseDto)).rejects.toThrow(ConflictException);
  });

  it('blocks execution inside transaction when locked currentYear id changed after future-term rollover (SEC-ROL-02)', async () => {
    const { service } = createInMemorySchool();

    (service as any).prisma.$transaction = jest.fn().mockImplementation(async (cb: any) =>
      cb({
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 1 }]),
        year: {
          findFirst: jest.fn().mockResolvedValue({
            id: 2, // السنة تغيرت إلى السنة الجديدة مع فصل مستقبلي غير حالي
            terms: [{ id: 20, isCurrent: false }],
          }),
        },
      }),
    );

    await expect(service.execute(1, baseDto)).rejects.toThrow('ALREADY_ROLLED_OVER');
  });
});
