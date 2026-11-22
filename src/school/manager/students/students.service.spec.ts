/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

describe('StudentsService & StudentsController pagination and query hardening', () => {
  function createSetup(overrides?: { rows?: any[]; total?: number }) {
    const defaultRow = {
      id: 101,
      gradeId: 3,
      sectionId: 5,
      status: 'ACTIVE',
      isCurrent: true,
      student: {
        user: {
          uuid: 'stu-uuid-101',
          name: 'أحمد علي',
          displayName: 'أحمد علي',
          code: 2200101,
          phone: null,
          isActive: true,
          updatedAt: new Date('2026-11-01T00:00:00.000Z'),
        },
      },
      grade: { id: 3, displayName: 'الأول الأساسي', sortOrder: 3 },
      section: { id: 5, name: 'أ', orderIndex: 1 },
    };

    const rows = overrides?.rows ?? [defaultRow];
    const total = overrides?.total ?? 71;

    const prisma: any = {
      studentEnrollment: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(total),
      },
    };

    const service = new StudentsService(prisma, {} as any, {} as any);
    const controller = new StudentsController(service);
    return { service, controller, prisma, defaultRow };
  }

  it('uses default paging (page=1, limit=20) and returns exact API contract', async () => {
    const { service, prisma } = createSetup({ total: 71 });

    const res = await service.listStudents(7, {});

    expect(prisma.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );
    expect(res).toEqual({
      data: [
        {
          id: 'stu-uuid-101',
          uuid: 'stu-uuid-101',
          name: 'أحمد علي',
          displayName: 'أحمد علي',
          code: 2200101,
          isActive: true,
          gradeName: 'الأول الأساسي',
          sectionName: 'أ',
          gradeId: 3,
          sectionId: 5,
          enrollmentId: 101,
          enrollmentStatus: 'ACTIVE',
          isCurrent: true,
          updatedAt: new Date('2026-11-01T00:00:00.000Z'),
        },
      ],
      meta: { total: 71, page: 1, limit: 20 },
    });
  });

  it('calculates skip/take for valid page and limit (page=2, limit=50)', async () => {
    const { service, prisma } = createSetup({ total: 71 });

    const res = await service.listStudents(7, { page: 2, limit: 50 });

    expect(prisma.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 50,
        take: 50,
      }),
    );
    expect(res.meta).toEqual({ total: 71, page: 2, limit: 50 });
  });

  it('caps limit at MAX_PAGE_SIZE (100)', async () => {
    const { service, prisma } = createSetup({ total: 250 });

    const res = await service.listStudents(7, { page: 1, limit: 250 });

    expect(prisma.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 100,
      }),
    );
    expect(res.meta).toEqual({ total: 250, page: 1, limit: 100 });
  });

  it.each([0, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY])(
    'normalizes invalid page=%p to page=1 and skip=0',
    async (badPage) => {
      const { service, prisma } = createSetup({ total: 40 });

      const res = await service.listStudents(7, { page: badPage, limit: 25 });

      expect(prisma.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 }),
      );
      expect(res.meta).toEqual({ total: 40, page: 1, limit: 25 });
    },
  );

  it.each([0, -5, Number.NaN, 2.5, Number.POSITIVE_INFINITY])(
    'normalizes invalid limit=%p to default limit=20',
    async (badLimit) => {
      const { service, prisma } = createSetup({ total: 40 });

      const res = await service.listStudents(7, { page: 2, limit: badLimit });

      expect(prisma.studentEnrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(res.meta).toEqual({ total: 40, page: 2, limit: 20 });
    },
  );

  it('includes { id: asc } tie-breaker in deterministic orderBy', async () => {
    const { service, prisma } = createSetup();

    await service.listStudents(7, {});

    expect(prisma.studentEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { grade: { sortOrder: 'asc' } },
          { section: { orderIndex: 'asc' } },
          { student: { user: { name: 'asc' } } },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('enforces schoolId, applies valid filters, ignores bad IDs, and preserves isCurrent for re-enroll', async () => {
    const { service, prisma } = createSetup();

    await service.listStudents(12, { gradeId: 3, sectionId: 5, yearId: 9 });
    const call1Where = prisma.studentEnrollment.findMany.mock.calls[0][0].where;
    expect(call1Where).toEqual({
      isDeleted: false,
      yearId: 9,
      gradeId: 3,
      sectionId: 5,
      student: { user: { schoolId: 12, isDeleted: false } },
    });
    expect(call1Where).not.toHaveProperty('isCurrent');
    expect(prisma.studentEnrollment.count).toHaveBeenCalledWith({
      where: call1Where,
    });

    await service.listStudents(12, {
      gradeId: Number.NaN,
      sectionId: -2,
      yearId: 0,
    });
    const call2Where = prisma.studentEnrollment.findMany.mock.calls[1][0].where;
    expect(call2Where).toEqual({
      isDeleted: false,
      year: { isCurrent: true, isDeleted: false },
      student: { user: { schoolId: 12, isDeleted: false } },
    });
    expect(call2Where).not.toHaveProperty('isCurrent');
    expect(call2Where).not.toHaveProperty('gradeId');
    expect(call2Where).not.toHaveProperty('sectionId');

    await service.listStudents(12, {
      gradeId: 1.5,
      sectionId: 2147483648,
    });
    const call3Where = prisma.studentEnrollment.findMany.mock.calls[2][0].where;
    expect(call3Where).not.toHaveProperty('gradeId');
    expect(call3Where).not.toHaveProperty('sectionId');
  });

  it('normalizes search: trims, ignores blank-only search, matches valid INT4 codes, omits overflow/non-int codes', async () => {
    const { service, prisma } = createSetup();

    await service.listStudents(7, { search: '   ' });
    expect(prisma.studentEnrollment.findMany.mock.calls[0][0].where.student).toEqual({
      user: { schoolId: 7, isDeleted: false },
    });

    await service.listStudents(7, { search: ' 2228871 ' });
    expect(prisma.studentEnrollment.findMany.mock.calls[1][0].where.student).toEqual({
      user: {
        schoolId: 7,
        isDeleted: false,
        OR: [
          { name: { contains: '2228871', mode: 'insensitive' } },
          { code: 2228871 },
        ],
      },
    });

    await service.listStudents(7, { search: '999999999999' });
    expect(prisma.studentEnrollment.findMany.mock.calls[2][0].where.student).toEqual({
      user: {
        schoolId: 7,
        isDeleted: false,
        OR: [{ name: { contains: '999999999999', mode: 'insensitive' } }],
      },
    });

    await service.listStudents(7, { search: '12.5' });
    expect(prisma.studentEnrollment.findMany.mock.calls[3][0].where.student).toEqual({
      user: {
        schoolId: 7,
        isDeleted: false,
        OR: [{ name: { contains: '12.5', mode: 'insensitive' } }],
      },
    });
  });

  it('StudentsController.list safely parses valid integer queries and strips invalid ones', async () => {
    const { controller, service } = createSetup();
    const spy = jest.spyOn(service, 'listStudents');

    await controller.list(
      { schoolContext: { id: 5 } },
      '3',
      '10',
      '2',
      'أحمد',
      '2',
      '50',
    );
    expect(spy).toHaveBeenNthCalledWith(1, 5, {
      gradeId: 3,
      sectionId: 10,
      yearId: 2,
      search: 'أحمد',
      page: 2,
      limit: 50,
    });

    await controller.list(
      { schoolContext: { id: 5 } },
      'abc',
      '-4',
      '',
      ' علي ',
      '0',
      '1.5',
    );
    expect(spy).toHaveBeenNthCalledWith(2, 5, {
      gradeId: undefined,
      sectionId: undefined,
      yearId: undefined,
      search: ' علي ',
      page: undefined,
      limit: undefined,
    });
  });
});

