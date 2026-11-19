/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { NotFoundException } from '@nestjs/common';
import { TeachersService } from './teachers.service';

describe('SEC-ISO-01: TeachersService multi-tenant isolation', () => {
  function createSetup() {
    const teacherInSchool2 = {
      id: 42,
      uuid: 'teacher-s2-uuid',
      schoolId: 2,
      userType: 'TEACHER',
      code: 2200042,
      isDeleted: false,
      isActive: true,
    };

    const prisma: any = {
      user: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (
            where.uuid === teacherInSchool2.uuid &&
            where.schoolId === teacherInSchool2.schoolId &&
            where.userType === 'TEACHER' &&
            where.isDeleted === false
          ) {
            return { ...teacherInSchool2, teacher: { isSupervisor: false } };
          }
          return null;
        }),
        update: jest.fn(),
      },
      teacher: {
        update: jest.fn(),
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ schoolCode: 'SCH-01' }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) =>
        cb({
          user: prisma.user,
          teacher: prisma.teacher,
        }),
      ),
    };

    const service = new TeachersService(prisma, {} as any);
    return { service, prisma, teacherInSchool2 };
  }

  it('rejects getTeacherProfile for another school and enforces schoolId in query', async () => {
    const { service, prisma, teacherInSchool2 } = createSetup();

    await expect(
      service.getTeacherProfile(teacherInSchool2.uuid, 1),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uuid: teacherInSchool2.uuid,
          schoolId: 1,
          userType: 'TEACHER',
          isDeleted: false,
        }),
      }),
    );
  });

  it('rejects updateTeacher across schools without mutating user or teacher', async () => {
    const { service, prisma, teacherInSchool2 } = createSetup();

    await expect(
      service.updateTeacher(teacherInSchool2.uuid, 1, { name: 'Hacked' } as any),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.teacher.update).not.toHaveBeenCalled();
  });

  it('rejects toggleActive across schools', async () => {
    const { service, prisma, teacherInSchool2 } = createSetup();

    await expect(
      service.toggleActive(teacherInSchool2.uuid, 1, false),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects resetPassword across schools and queries school by caller schoolId when authorized', async () => {
    const { service, prisma, teacherInSchool2 } = createSetup();

    await expect(
      service.resetPassword(teacherInSchool2.uuid, 1, 'NewPass123'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();

    const res = await service.resetPassword(teacherInSchool2.uuid, 2, 'ValidPass1');
    expect(prisma.school.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2 } }),
    );
    expect(res.credentials.teacherCode).toBe(teacherInSchool2.code);
  });
});
