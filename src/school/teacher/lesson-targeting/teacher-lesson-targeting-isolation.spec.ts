/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { ForbiddenException } from '@nestjs/common';
import { TeacherLessonTargetingService } from './teacher-lesson-targeting.service';

describe('SEC-ISO-04 & SEC-TCH-01: TeacherLessonTargetingService isolation & ownership', () => {
  function createSetup(options?: {
    slotFound?: boolean;
    assignedSectionIds?: number[];
    ownsTemplateSubject?: boolean;
  }) {
    const assignedSectionIds = options?.assignedSectionIds ?? [20];
    const ownsTemplateSubject = options?.ownsTemplateSubject ?? true;

    const tx = {
      lesson: {
        create: jest.fn().mockResolvedValue({ id: 500, uuid: 'lesson-uuid' }),
        update: jest.fn().mockResolvedValue({ id: 500, uuid: 'lesson-uuid' }),
      },
      lessonTarget: {
        create: jest.fn().mockResolvedValue({ id: 700, sectionId: 20 }),
        deleteMany: jest.fn(),
      },
      lessonTimetableSlot: {
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      timetableSlot: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.slotFound ? { id: 88, uuid: 'slot-valid' } : null,
          ),
      },
      lessonDeliveryLog: {
        create: jest.fn(),
      },
    };

    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          uuid: 'teacher-user-1',
          teacher: { userId: 10 },
        }),
      },
      subject: {
        findFirst: jest.fn().mockResolvedValue({ id: 30, uuid: 'subj-uuid' }),
      },
      subjectSectionTeacher: {
        findFirst: jest.fn().mockResolvedValue(
          ownsTemplateSubject ? { id: 99 } : null,
        ),
        findMany: jest.fn().mockResolvedValue(
          assignedSectionIds.map((id) => ({ subjectSection: { sectionId: id } })),
        ),
      },
      section: {
        findFirst: jest.fn().mockResolvedValue({ id: 20, uuid: 'sec-20' }),
        findMany: jest.fn().mockResolvedValue([{ id: 20, uuid: 'sec-20' }]),
      },
      subjectSection: {
        findFirst: jest.fn().mockResolvedValue({ id: 200 }),
      },
      year: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          terms: [{ id: 1, startDate: null, endDate: null }],
        }),
      },
      timetable: {
        findFirst: jest.fn().mockResolvedValue({ id: 300 }),
      },
      timetableSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      lessonTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 400,
          uuid: 'tpl-uuid',
          schoolId: 1,
          subjectId: 30,
          status: 'READY',
        }),
      },
      lesson: {
        findFirst: jest.fn().mockResolvedValue({
          id: 500,
          uuid: 'lesson-uuid',
          status: 'READY',
          linkType: 'SLOT_COVERAGE',
          targets: [{ id: 700 }],
        }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };

    const deliveryService: any = {
      deliverLesson: jest.fn(),
      cancelSchedule: jest.fn(),
    };

    const service = new TeacherLessonTargetingService(prisma, deliveryService);
    return { service, prisma, tx, deliveryService };
  }

  it('rejects foreign or unauthorized slotUuid in saveTargeting and verifies full tenant scope', async () => {
    const { service, tx } = createSetup({ slotFound: false });

    await expect(
      service.saveTargeting(1, 'teacher-user-1', 'tpl-uuid', {
        linkType: 'SLOT_COVERAGE',
        sectionUuids: ['sec-20'],
        slotAssignments: [
          { slotUuid: 'foreign-school-slot', sectionUuid: 'sec-20' },
        ],
      } as any),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.timetableSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uuid: 'foreign-school-slot',
          isDeleted: false,
          timetable: expect.objectContaining({
            sectionId: 20,
            status: 'PUBLISHED',
            section: { grade: { schoolId: 1, isDeleted: false } },
          }),
          subjectSection: expect.objectContaining({
            subjectId: 30,
            sectionId: 20,
          }),
        }),
      }),
    );
    expect(tx.lessonTimetableSlot.create).not.toHaveBeenCalled();
  });

  it('rejects targeting sections not assigned to the teacher (SEC-TCH-01)', async () => {
    const { service, tx } = createSetup({ assignedSectionIds: [] });

    await expect(
      service.saveTargeting(1, 'teacher-user-1', 'tpl-uuid', {
        linkType: 'GENERAL',
        sectionUuids: ['sec-20'],
      } as any),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.lessonTarget.create).not.toHaveBeenCalled();
  });

  it('rejects publishLesson, cancelSchedule, getTargeting, and getDeliveryStatus if teacher does not own subject', async () => {
    const { service, deliveryService } = createSetup({ ownsTemplateSubject: false });

    await expect(
      service.publishLesson(1, 'teacher-user-1', 'tpl-uuid'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.cancelSchedule(1, 'teacher-user-1', 'tpl-uuid'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.getTargeting(1, 'teacher-user-1', 'tpl-uuid'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.getDeliveryStatus(1, 'teacher-user-1', 'tpl-uuid'),
    ).rejects.toThrow(ForbiddenException);

    expect(deliveryService.deliverLesson).not.toHaveBeenCalled();
    expect(deliveryService.cancelSchedule).not.toHaveBeenCalled();
  });

  it('filters lessonTimetableSlots by schoolId in getTimetableSlotsForSection', async () => {
    const { service, prisma } = createSetup();

    await service.getTimetableSlotsForSection(1, 'teacher-user-1', 'subj-uuid', 'sec-20');

    expect(prisma.timetableSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          lessonTimetableSlots: expect.objectContaining({
            where: { lesson: { schoolId: 1, isDeleted: false } },
          }),
        }),
      }),
    );
  });
});
