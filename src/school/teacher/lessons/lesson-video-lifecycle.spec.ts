/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBlockItemDto as SchoolCreateBlockItemDto } from './dto/create-block-item.dto';
import { CreateBlockItemDto as PlatformCreateBlockItemDto } from '../../../platform/lessons/dto/create-block-item.dto';
import { TeacherLessonsService } from './teacher-lessons.service';
import { PlatformLessonsService } from '../../../platform/lessons/platform-lessons.service';
import { PlatformContentService } from '../../shared/platform-content/platform-content.service';
import { TeacherQuestionsService } from '../questions/teacher-questions.service';
import { SubjectsService } from '../../manager/subjects/subjects.service';
import { PlatformSubjectsService } from '../../../platform/subjects/platform-subjects.service';
import { SchoolInfoService } from '../../manager/school-info/school-info.service';
import { ProfileService } from '../../profile/profile.service';
import { MediaAccessPolicyService } from '../../../shared/media/media-access-policy.service';
import { MediaLifecycleService } from '../../../shared/media/media-lifecycle.service';

jest.mock('../../common/helpers/lesson-revision.helper', () => ({
  bumpContentRevision: jest.fn().mockResolvedValue(undefined),
  bumpQuestionsRevision: jest.fn().mockResolvedValue(undefined),
  touchRelatedLessons: jest.fn().mockResolvedValue(undefined),
}));

describe('P4-5c: Lesson Block Item Video Lifecycle, Symmetric Locking & W-061 Guards', () => {
  describe('CreateBlockItemDto validation (School & Platform)', () => {
    it('accepts itemType VIDEO when mediaAssetUuid is a valid UUID v4', async () => {
      for (const DtoClass of [
        SchoolCreateBlockItemDto,
        PlatformCreateBlockItemDto,
      ]) {
        const dto = plainToInstance(DtoClass, {
          itemType: 'VIDEO',
          orderIndex: 1,
          mediaAssetUuid: '550e8400-e29b-41d4-a716-446655440000',
          caption: '  مقدمة الدرس  ',
        });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
        expect(dto.caption).toBe('مقدمة الدرس');
      }
    });

    it('rejects itemType VIDEO when mediaAssetUuid is missing', async () => {
      for (const DtoClass of [
        SchoolCreateBlockItemDto,
        PlatformCreateBlockItemDto,
      ]) {
        const dto = plainToInstance(DtoClass, {
          itemType: 'VIDEO',
          orderIndex: 1,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('mediaAssetUuid');
      }
    });
  });

  describe('TeacherLessonsService & PlatformLessonsService lifecycle integration', () => {
    function createMockSetup() {
      const assets = new Map<number, any>();
      const activeRefCounts = new Map<number, number>();
      const lockedOrders: number[][] = [];

      const tx: any = {
        $queryRaw: jest.fn().mockImplementation((sqlObj: any) => {
          const ids: number[] = Array.isArray(sqlObj?.values?.[0])
            ? sqlObj.values[0]
            : [];
          lockedOrders.push([...ids]);
          const rows = ids
            .map((id) => assets.get(id))
            .filter(Boolean)
            .sort((a, b) => a.id - b.id)
            .map((a) => ({
              id: a.id,
              uuid: a.uuid,
              ownerType: a.ownerType,
              schoolId: a.schoolId,
              kind: a.kind,
              processingStatus: a.processingStatus,
              isDeleted: a.isDeleted,
            }));
          return Promise.resolve(rows);
        }),
        mediaAsset: {
          findUnique: jest.fn().mockImplementation(({ where }: any) => {
            for (const a of assets.values()) {
              if (where.uuid && a.uuid === where.uuid)
                return Promise.resolve(a);
              if (where.id && a.id === where.id) return Promise.resolve(a);
            }
            return Promise.resolve(null);
          }),
          findFirst: jest.fn().mockImplementation(({ where }: any) => {
            for (const a of assets.values()) {
              if (where.uuid && a.uuid !== where.uuid) continue;
              if (where.id && a.id !== where.id) continue;
              if (
                where.isDeleted !== undefined &&
                a.isDeleted !== where.isDeleted
              )
                continue;
              return Promise.resolve(a);
            }
            return Promise.resolve(null);
          }),
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            const a = assets.get(where.id);
            if (a) {
              Object.assign(a, data);
            }
            return Promise.resolve(a);
          }),
          updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
            const a = assets.get(where.id);
            if (a && !a.isDeleted) {
              a.isDeleted = data.isDeleted;
              a.deletedAt = data.deletedAt;
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          }),
        },
        lessonBlockItem: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          aggregate: jest.fn().mockResolvedValue({ _max: { orderIndex: 0 } }),
          create: jest.fn().mockImplementation(({ data }: any) => {
            const media = data.mediaAssetId
              ? assets.get(data.mediaAssetId)
              : null;
            return Promise.resolve({
              id: 500,
              uuid: 'item-uuid-500',
              ...data,
              mediaAsset: media ? { uuid: media.uuid, kind: media.kind } : null,
            });
          }),
          update: jest.fn().mockImplementation(({ where, data }: any) => {
            const media = data.mediaAssetId
              ? assets.get(data.mediaAssetId)
              : null;
            return Promise.resolve({
              id: where.id,
              uuid: 'item-uuid-updated',
              itemType: 'VIDEO',
              orderIndex: 1,
              textContent: data.textContent ?? null,
              caption: data.caption ?? null,
              mediaAsset: media ? { uuid: media.uuid, kind: media.kind } : null,
            });
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          count: jest.fn().mockImplementation(({ where }: any) => {
            return Promise.resolve(
              activeRefCounts.get(where.mediaAssetId) ?? 0,
            );
          }),
        },
        lessonContentBlock: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 20, uuid: 'block-1', templateId: 10 }),
          update: jest.fn().mockResolvedValue({ id: 20 }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        lessonTemplate: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue({
            id: 10,
            uuid: 'lesson-1',
            schoolId: 1,
            subjectId: 5,
            subjectDictionaryId: 7,
            unitId: 3,
            status: 'DRAFT',
            ownerType: 'SCHOOL',
          }),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ id: 10, templateVersion: 2 }),
        },
        contentDistribution: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        lesson: {
          count: jest.fn().mockResolvedValue(0),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        lessonContent: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        question: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        questionOption: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        questionMatchingPair: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        questionOrderingItem: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        questionFillBlank: {
          count: jest.fn().mockResolvedValue(0),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        questionFillAnswer: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        subject: {
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        subjectDictionary: { count: jest.fn().mockResolvedValue(0) },
        school: { count: jest.fn().mockResolvedValue(0) },
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 100,
            uuid: 'teacher-1',
            schoolId: 1,
            teacher: { userId: 100 },
          }),
          count: jest.fn().mockResolvedValue(0),
        },
        subjectSectionTeacher: {
          findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        },
        platformUser: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            uuid: 'p-admin-1',
            role: 'PLATFORM_ADMIN',
            isDeleted: false,
            isActive: true,
          }),
        },
      };

      tx.$transaction = jest
        .fn()
        .mockImplementation((cb: any) =>
          typeof cb === 'function' ? cb(tx) : Promise.all(cb),
        );

      const policy = new MediaAccessPolicyService(tx);
      const lifecycle = new MediaLifecycleService(policy);
      const teacherService = new TeacherLessonsService(tx, lifecycle, policy);
      const platformService = new PlatformLessonsService(tx, lifecycle, policy);

      return {
        tx,
        assets,
        activeRefCounts,
        lockedOrders,
        teacherService,
        platformService,
      };
    }

    it('createBlockItem links a READY school VIDEO under FOR UPDATE lock and rejects ERROR or undistributed PLATFORM video', async () => {
      const { assets, lockedOrders, teacherService } = createMockSetup();
      assets.set(11, {
        id: 11,
        uuid: 'vid-ready-11',
        ownerType: 'SCHOOL',
        schoolId: 1,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: false,
      });
      assets.set(12, {
        id: 12,
        uuid: 'vid-err-12',
        ownerType: 'SCHOOL',
        schoolId: 1,
        kind: 'VIDEO',
        processingStatus: 'ERROR',
        isDeleted: false,
      });
      assets.set(13, {
        id: 13,
        uuid: 'vid-plat-13',
        ownerType: 'PLATFORM',
        schoolId: null,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: false,
      });

      const created = await teacherService.createBlockItem(
        1,
        'teacher-1',
        'lesson-1',
        'block-1',
        {
          itemType: 'VIDEO',
          orderIndex: 1,
          mediaAssetUuid: 'vid-ready-11',
        },
      );
      expect(created.mediaAssetUuid).toBe('vid-ready-11');
      expect(created.mediaAssetKind).toBe('VIDEO');
      expect(lockedOrders).toEqual([[11]]);

      await expect(
        teacherService.createBlockItem(1, 'teacher-1', 'lesson-1', 'block-1', {
          itemType: 'VIDEO',
          orderIndex: 2,
          mediaAssetUuid: 'vid-err-12',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        teacherService.createBlockItem(1, 'teacher-1', 'lesson-1', 'block-1', {
          itemType: 'VIDEO',
          orderIndex: 3,
          mediaAssetUuid: 'vid-plat-13',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updateBlockItem locks [previousAssetId, newAssetId] in ascending order and soft-deletes old VIDEO when unreferenced', async () => {
      const { tx, assets, activeRefCounts, lockedOrders, teacherService } =
        createMockSetup();

      assets.set(25, {
        id: 25,
        uuid: 'old-vid-25',
        ownerType: 'SCHOOL',
        schoolId: 1,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: false,
      });
      assets.set(10, {
        id: 10,
        uuid: 'new-vid-10',
        ownerType: 'SCHOOL',
        schoolId: 1,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: false,
      });
      activeRefCounts.set(25, 0);

      tx.lessonBlockItem.findFirst.mockResolvedValueOnce({
        id: 99,
        uuid: 'item-99',
        blockId: 20,
        itemType: 'VIDEO',
        mediaAssetId: 25,
        isDeleted: false,
      });

      const res = await teacherService.updateBlockItem(
        1,
        'teacher-1',
        'lesson-1',
        'block-1',
        'item-99',
        { mediaAssetUuid: 'new-vid-10' },
      );

      expect(res.mediaAssetUuid).toBe('new-vid-10');
      // First lock is [10, 25] during resolveAndLockAssetForLink; second is [25] during reconcile
      expect(lockedOrders[0]).toEqual([10, 25]);
      expect(assets.get(25).isDeleted).toBe(true);
      expect(assets.get(10).isDeleted).toBe(false);
    });

    it('deleteBlockItem and deleteLesson soft-delete unreferenced VIDEO assets while preserving PLATFORM IMAGE assets', async () => {
      const { tx, assets, activeRefCounts, lockedOrders, teacherService } =
        createMockSetup();

      assets.set(40, {
        id: 40,
        uuid: 'school-vid-40',
        ownerType: 'SCHOOL',
        schoolId: 1,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: false,
      });
      assets.set(15, {
        id: 15,
        uuid: 'platform-img-15',
        ownerType: 'PLATFORM',
        schoolId: null,
        kind: 'IMAGE',
        processingStatus: 'READY',
        isDeleted: false,
      });
      activeRefCounts.set(40, 0);
      activeRefCounts.set(15, 0);

      tx.lessonBlockItem.findMany.mockResolvedValueOnce([
        { mediaAssetId: 40 },
        { mediaAssetId: 15 },
      ]);

      await teacherService.deleteLesson(1, 'teacher-1', 'lesson-1');

      expect(lockedOrders[0]).toEqual([15, 40]);
      expect(assets.get(40).isDeleted).toBe(true);
      expect(assets.get(15).isDeleted).toBe(false);
    });

    it('PlatformLessonsService links PLATFORM VIDEO and soft-deletes on deleteBlockItem when unreferenced', async () => {
      const { tx, assets, activeRefCounts, platformService } =
        createMockSetup();

      tx.lessonTemplate.findFirst.mockResolvedValue({
        id: 10,
        uuid: 'plat-lesson-1',
        ownerType: 'PLATFORM',
        subjectDictionaryId: 7,
        status: 'DRAFT',
        isDeleted: false,
      });

      assets.set(77, {
        id: 77,
        uuid: 'plat-vid-77',
        ownerType: 'PLATFORM',
        schoolId: null,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: false,
      });
      activeRefCounts.set(77, 0);

      const created = await platformService.createBlockItem(
        'p-admin-1',
        'plat-lesson-1',
        'block-1',
        {
          itemType: 'VIDEO',
          orderIndex: 1,
          mediaAssetUuid: 'plat-vid-77',
        },
      );
      expect(created.mediaAssetUuid).toBe('plat-vid-77');

      tx.lessonBlockItem.findFirst.mockResolvedValueOnce({
        id: 500,
        uuid: 'item-uuid-500',
        blockId: 20,
        itemType: 'VIDEO',
        mediaAssetId: 77,
        isDeleted: false,
      });

      await platformService.deleteBlockItem(
        'p-admin-1',
        'plat-lesson-1',
        'block-1',
        'item-uuid-500',
      );
      expect(assets.get(77).isDeleted).toBe(true);
    });

    it('PlatformContentService locks referenced media assets during fork and fails with 404 ASSET_NOT_FOUND if soft-deleted', async () => {
      const { tx, assets, lockedOrders } = createMockSetup();
      const policy = new MediaAccessPolicyService(tx);
      const lifecycle = new MediaLifecycleService(policy);
      const contentService = new PlatformContentService(tx, lifecycle, policy);

      assets.set(88, {
        id: 88,
        uuid: 'plat-vid-88',
        ownerType: 'PLATFORM',
        schoolId: null,
        kind: 'VIDEO',
        processingStatus: 'READY',
        isDeleted: true,
      });

      tx.lessonContentBlock.findMany = jest.fn().mockResolvedValue([
        {
          id: 1,
          title: 'Block 1',
          orderIndex: 1,
          items: [
            {
              id: 10,
              itemType: 'VIDEO',
              orderIndex: 1,
              textContent: null,
              mediaAssetId: 88,
              caption: null,
              metadataJson: null,
            },
          ],
        },
      ]);

      await expect(
        (contentService as any).copyBlocksAndItems(tx, 100, 200),
      ).rejects.toThrow(NotFoundException);
      expect(lockedOrders).toEqual([[88]]);
    });
  });

  describe('W-061 Non-Lesson VIDEO_NOT_ALLOWED_HERE Guards', () => {
    it('rejects VIDEO assets in TeacherQuestionsService, SubjectsService, PlatformSubjectsService, SchoolInfoService, and ProfileService', async () => {
      const mockPrisma: any = {
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue({
            id: 99,
            uuid: 'vid-99',
            kind: 'VIDEO',
            ownerType: 'SCHOOL',
            schoolId: 1,
            isDeleted: false,
          }),
          findUnique: jest.fn().mockResolvedValue({
            id: 99,
            uuid: 'vid-99',
            kind: 'VIDEO',
            ownerType: 'SCHOOL',
            schoolId: 1,
            isDeleted: false,
          }),
        },
        schoolGrade: {
          findFirst: jest.fn().mockResolvedValue({ id: 1, schoolId: 1 }),
        },
        subject: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        subjectDictionary: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 1, uuid: 'dict-1', isDeleted: false }),
        },
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 5, schoolId: 1 }),
        },
      };

      const questionsService = new TeacherQuestionsService(mockPrisma);
      await expect(
        (questionsService as any).resolveAssetUuid(1, 'vid-99'),
      ).rejects.toThrow(BadRequestException);

      const subjectsService = new SubjectsService(mockPrisma);
      await expect(
        subjectsService.createSubject(1, {
          gradeId: 1,
          displayName: 'العلوم',
          coverMediaAssetUuid: 'vid-99',
        } as any),
      ).rejects.toThrow(BadRequestException);

      // سياق المنصة يقبل أصول PLATFORM فقط (F-P45-02) — نستخدم فيديو مملوكاً للمنصة لاختبار حارس VIDEO
      const platformVideoPrisma: any = {
        ...mockPrisma,
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue({
            id: 98,
            uuid: 'vid-98',
            kind: 'VIDEO',
            ownerType: 'PLATFORM',
            schoolId: null,
            isDeleted: false,
          }),
        },
      };
      const platformSubjectsService = new PlatformSubjectsService(
        platformVideoPrisma,
      );
      await expect(
        platformSubjectsService.updateSubjectCover('dict-1', {
          mediaAssetUuid: 'vid-99',
        }),
      ).rejects.toThrow(BadRequestException);

      const schoolInfoService = new SchoolInfoService(mockPrisma);
      await expect(
        schoolInfoService.updateSchoolInfo(1, {
          logoMediaAssetUuid: 'vid-99',
        }),
      ).rejects.toThrow(BadRequestException);

      const profileService = new ProfileService(mockPrisma);
      await expect(
        profileService.updateMe('user-uuid-5', {
          avatarMediaAssetUuid: 'vid-99',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
