/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubjectsService } from './subjects.service';

describe('SEC-ISO-03: SubjectsService section & teacher multi-tenant isolation', () => {
  function createSetup() {
    const tx = {
      subjectSection: {
        upsert: jest.fn(),
      },
    };

    const prisma: any = {
      subject: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          uuid: 'subj-s1',
          schoolId: 1,
          gradeId: 5,
          isDeleted: false,
        }),
      },
      section: {
        findMany: jest.fn().mockResolvedValue([{ id: 101 }]), // Only section 101 belongs to school 1 & grade 5
      },
      subjectSection: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };

    const service = new SubjectsService(prisma);
    return { service, prisma, tx };
  }

  it('rejects assignToSections when any sectionId belongs to another school or grade', async () => {
    const { service, prisma, tx } = createSetup();

    await expect(
      service.assignToSections(1, 10, { sectionIds: [101, 999] }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.section.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [101, 999] },
          gradeId: 5,
          isDeleted: false,
          grade: { schoolId: 1, isDeleted: false },
        }),
      }),
    );
    expect(tx.subjectSection.upsert).not.toHaveBeenCalled();
  });

  it('allows assignToSections when all sectionIds match subject grade and schoolId', async () => {
    const { service, tx } = createSetup();

    await service.assignToSections(1, 10, { sectionIds: [101, 101] });

    expect(tx.subjectSection.upsert).toHaveBeenCalledTimes(1);
    expect(tx.subjectSection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectId_sectionId: { subjectId: 10, sectionId: 101 } },
      }),
    );
  });

  it('scopes removeFromSection by section.grade.schoolId', async () => {
    const { service, prisma } = createSetup();

    await service.removeFromSection(1, 10, 999);

    expect(prisma.subjectSection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subjectId: 10,
          sectionId: 999,
          section: { grade: { schoolId: 1 } },
        }),
      }),
    );
  });

  it('scopes assignTeacherToSection & unassignTeacherFromSection by section.grade.schoolId', async () => {
    const { service, prisma } = createSetup();

    await expect(
      service.assignTeacherToSection(1, 'subj-s1', 999, 'teacher-uuid'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.subjectSection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sectionId: 999,
          section: { isDeleted: false, grade: { schoolId: 1, isDeleted: false } },
        }),
      }),
    );

    await expect(
      service.unassignTeacherFromSection(1, 'subj-s1', 999),
    ).rejects.toThrow(NotFoundException);
  });
});
