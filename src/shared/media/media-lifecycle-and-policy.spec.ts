/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
// src/shared/media/media-lifecycle-and-policy.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 VIDEO P4-5a — اختبارات الوحدة لسياسات العزل (S4 & W-061) و MediaLifecycleService
// ═══════════════════════════════════════════════════════════════

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaKind, ProcessingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AssetAccessSnapshot,
  MediaAccessPolicyService,
} from './media-access-policy.service';
import { MediaLifecycleService } from './media-lifecycle.service';
import { VideoMediaConfig } from './video-media.config';

describe('P4-5a — VideoMediaConfig (R2_PRESIGNED_GET_TTL_SECONDS)', () => {
  const prevTtl = process.env.R2_PRESIGNED_GET_TTL_SECONDS;

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.R2_PRESIGNED_GET_TTL_SECONDS;
    } else {
      process.env.R2_PRESIGNED_GET_TTL_SECONDS = prevTtl;
    }
  });

  it('يعيد القيمة الافتراضية 3600 ثانية عند عدم ضبط R2_PRESIGNED_GET_TTL_SECONDS', () => {
    delete process.env.R2_PRESIGNED_GET_TTL_SECONDS;
    const cfg = new VideoMediaConfig();
    expect(cfg.r2PresignedGetTtlSeconds).toBe(3600);
  });

  it('يقرأ قيمة مخصصة صالحة ضمن النطاق [60..604800] ويعود للافتراضي عند القيم الخارجة', () => {
    process.env.R2_PRESIGNED_GET_TTL_SECONDS = '1800';
    expect(new VideoMediaConfig().r2PresignedGetTtlSeconds).toBe(1800);

    process.env.R2_PRESIGNED_GET_TTL_SECONDS = '10'; // أقل من 60
    expect(new VideoMediaConfig().r2PresignedGetTtlSeconds).toBe(3600);
  });
});

describe('P4-5a — MediaAccessPolicyService (S4 Read Isolation & W-061 Write Isolation)', () => {
  let prismaMock: any;
  let policy: MediaAccessPolicyService;

  const schoolAVideoAsset: AssetAccessSnapshot = {
    id: 101,
    uuid: '11111111-1111-4111-8111-111111111111',
    kind: MediaKind.VIDEO,
    ownerType: 'SCHOOL',
    schoolId: 10,
    storageProvider: 'R2',
    processingStatus: ProcessingStatus.DONE,
    isDeleted: false,
  };

  const platformVideoAsset: AssetAccessSnapshot = {
    id: 202,
    uuid: '22222222-2222-4222-8222-222222222222',
    kind: MediaKind.VIDEO,
    ownerType: 'PLATFORM',
    schoolId: null,
    storageProvider: 'R2',
    processingStatus: ProcessingStatus.DONE,
    isDeleted: false,
  };

  const platformImageAsset: AssetAccessSnapshot = {
    id: 303,
    uuid: '33333333-3333-4333-8333-333333333333',
    kind: MediaKind.IMAGE,
    ownerType: 'PLATFORM',
    schoolId: null,
    storageProvider: 'LOCAL',
    processingStatus: ProcessingStatus.DONE,
    isDeleted: false,
  };

  beforeEach(() => {
    prismaMock = {
      mediaAsset: {
        findFirst: jest.fn(),
      },
      lessonBlockItem: {
        findFirst: jest.fn(),
      },
      lessonContent: {
        findFirst: jest.fn(),
      },
    };
    policy = new MediaAccessPolicyService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('عزل القراءة S4 (S4-T1 .. S4-T6)', () => {
    it('S4-T1: يسمح لمستخدم المدرسة A بقراءة فيديو SCHOOL تملكه المدرسة A', async () => {
      await expect(
        policy.assertSchoolCanReadAsset(schoolAVideoAsset, 10),
      ).resolves.toBeUndefined();
    });

    it('S4-T2: يرفض بـ 404 ASSET_NOT_FOUND (وليس 403) عندما تطلب المدرسة B فيديو المدرسة A', async () => {
      await expect(
        policy.assertSchoolCanReadAsset(schoolAVideoAsset, 20),
      ).rejects.toThrow(NotFoundException);

      try {
        await policy.assertSchoolCanReadAsset(schoolAVideoAsset, 20);
      } catch (err: any) {
        expect(err.getStatus()).toBe(404);
        expect(err.getResponse()).toMatchObject({ error: 'ASSET_NOT_FOUND' });
      }
    });

    it('S4-T3 & S4-T4: يسمح للمدرسة A بقراءة فيديو PLATFORM موزع (ACTIVE) أو مستنسخ للمدرسة (Policy A)', async () => {
      prismaMock.lessonBlockItem.findFirst.mockResolvedValueOnce({ id: 500 });

      await expect(
        policy.assertSchoolCanReadAsset(platformVideoAsset, 10),
      ).resolves.toBeUndefined();

      expect(prismaMock.lessonBlockItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            mediaAssetId: 202,
            isDeleted: false,
          }),
        }),
      );
    });

    it('S4-T5: يرفض بـ 404 ASSET_NOT_FOUND عندما تطلب المدرسة B فيديو PLATFORM غير موزع وغير مستنسخ لها', async () => {
      prismaMock.lessonBlockItem.findFirst.mockResolvedValueOnce(null);
      prismaMock.lessonContent.findFirst.mockResolvedValueOnce(null);

      await expect(
        policy.assertSchoolCanReadAsset(platformVideoAsset, 20),
      ).rejects.toThrow(NotFoundException);
    });

    it('S4-T6: المنصة تقبل أصول PLATFORM فقط وترفض أصول SCHOOL بـ 404 ASSET_NOT_FOUND', () => {
      expect(() =>
        policy.assertPlatformCanReadAsset(platformVideoAsset),
      ).not.toThrow();

      expect(() =>
        policy.assertPlatformCanReadAsset(schoolAVideoAsset),
      ).toThrow(NotFoundException);
    });

    it('Decision 3: يحافظ على السلوك الحالي لأصول المنصة غير الفيديو (IMAGE/AUDIO/DOCUMENT) دون استعلام توزيع الفيديو', async () => {
      await expect(
        policy.assertSchoolCanReadAsset(platformImageAsset, 99),
      ).resolves.toBeUndefined();
      expect(prismaMock.lessonBlockItem.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('عزل الكتابة W-061 (W061-T1 .. W061-T4)', () => {
    it('W061-T1: يمنع المدرسة B من ربط أصل يخص المدرسة A بـ 404 ASSET_NOT_FOUND حتى لو اختلف النوع', async () => {
      await expect(
        policy.assertCanLinkAssetToLessonItem(prismaMock, schoolAVideoAsset, {
          expectedKind: 'IMAGE', // حتى مع اختلاف النوع، يعيد 404 أولاً لمنع استكشاف الأصول
          targetOwnerType: 'SCHOOL',
          schoolId: 20,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('W061-T2: يمنع المدرسة B من ربط فيديو منصة غير موزع لها بـ 404، ويسمح للمدرسة الموزع لها', async () => {
      prismaMock.lessonBlockItem.findFirst.mockResolvedValueOnce(null);
      prismaMock.lessonContent.findFirst.mockResolvedValueOnce(null);

      await expect(
        policy.assertCanLinkAssetToLessonItem(prismaMock, platformVideoAsset, {
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId: 20,
        }),
      ).rejects.toThrow(NotFoundException);

      prismaMock.lessonBlockItem.findFirst.mockResolvedValueOnce({ id: 777 });
      await expect(
        policy.assertCanLinkAssetToLessonItem(prismaMock, platformVideoAsset, {
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId: 10,
        }),
      ).resolves.toBeUndefined();
    });

    it('W061-T3: يرفض ربط أصل بحالة ERROR بـ 400 ASSET_PROCESSING_FAILED، ويرفض عدم تطابق النوع بـ 400 MEDIA_KIND_MISMATCH', async () => {
      const errorAsset: AssetAccessSnapshot = {
        ...schoolAVideoAsset,
        processingStatus: ProcessingStatus.ERROR,
      };

      await expect(
        policy.assertCanLinkAssetToLessonItem(prismaMock, errorAsset, {
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId: 10,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        policy.assertCanLinkAssetToLessonItem(prismaMock, schoolAVideoAsset, {
          expectedKind: 'IMAGE',
          targetOwnerType: 'SCHOOL',
          schoolId: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('W061-T4: assertCanLinkNonVideoAsset يمنع ربط VIDEO في الجداول غير الدروس بـ 400 VIDEO_NOT_ALLOWED_HERE', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(schoolAVideoAsset);

      await expect(
        policy.assertCanLinkNonVideoAsset(prismaMock, schoolAVideoAsset.uuid, {
          targetOwnerType: 'SCHOOL',
          schoolId: 10,
          allowedKinds: ['IMAGE'],
        }),
      ).rejects.toThrow(BadRequestException);

      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(schoolAVideoAsset);
      try {
        await policy.assertCanLinkNonVideoAsset(
          prismaMock,
          schoolAVideoAsset.uuid,
          {
            targetOwnerType: 'SCHOOL',
            schoolId: 10,
            allowedKinds: ['IMAGE'],
          },
        );
      } catch (err: any) {
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toMatchObject({
          error: 'VIDEO_NOT_ALLOWED_HERE',
        });
      }
    });
  });
});

describe('P4-5a — MediaLifecycleService (Symmetric FOR UPDATE & Atomic Soft Delete)', () => {
  let prismaMock: any;
  let policy: MediaAccessPolicyService;
  let lifecycle: MediaLifecycleService;

  beforeEach(() => {
    prismaMock = {
      $queryRaw: jest.fn(),
      mediaAsset: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      lessonBlockItem: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
      },
      lessonContent: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
      },
      lessonTemplate: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    policy = new MediaAccessPolicyService(
      prismaMock as unknown as PrismaService,
    );
    lifecycle = new MediaLifecycleService(policy);
  });

  it('normalizeAndSortAssetIds يرتب المعرفات تصاعدياً ويزيل التكرارات والقيم غير الصالحة', () => {
    expect(
      lifecycle.normalizeAndSortAssetIds([42, null, 7, undefined, 42, -1, 19]),
    ).toEqual([7, 19, 42]);
  });

  it('resolveAndLockAssetForLink يقفل الأصل القديم والجديد بترتيب تصاعدي ويرفض الأصل إذا أصبح isDeleted = true تحت القفل', async () => {
    prismaMock.mediaAsset.findUnique.mockResolvedValueOnce({ id: 50 });
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 20,
        uuid: 'old-uuid',
        kind: 'VIDEO',
        ownerType: 'SCHOOL',
        schoolId: 10,
        storageProvider: 'R2',
        processingStatus: 'DONE',
        isDeleted: false,
        rowVersion: 1,
      },
      {
        id: 50,
        uuid: 'new-uuid',
        kind: 'VIDEO',
        ownerType: 'SCHOOL',
        schoolId: 10,
        storageProvider: 'R2',
        processingStatus: 'DONE',
        isDeleted: true, // حُذف منطقياً بواسطة معاملة متزامنة قبل اكتساب القفل
        rowVersion: 2,
      },
    ]);

    await expect(
      lifecycle.resolveAndLockAssetForLink(prismaMock, {
        assetUuid: 'new-uuid',
        expectedKind: 'VIDEO',
        targetOwnerType: 'SCHOOL',
        schoolId: 10,
        previousAssetId: 20,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reconcileUnlinkedAssetsUnderLock ينفذ الحذف المنطقي الذري لأصل VIDEO عندما تصبح المراجع النشطة 0 فقط', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        id: 10,
        uuid: 'video-zero-refs',
        kind: 'VIDEO',
        ownerType: 'SCHOOL',
        schoolId: 1,
        storageProvider: 'R2',
        processingStatus: 'DONE',
        isDeleted: false,
        rowVersion: 1,
      },
      {
        id: 20,
        uuid: 'video-still-linked',
        kind: 'VIDEO',
        ownerType: 'SCHOOL',
        schoolId: 1,
        storageProvider: 'R2',
        processingStatus: 'DONE',
        isDeleted: false,
        rowVersion: 1,
      },
      {
        id: 30,
        uuid: 'image-zero-refs',
        kind: 'IMAGE',
        ownerType: 'SCHOOL',
        schoolId: 1,
        storageProvider: 'LOCAL',
        processingStatus: 'DONE',
        isDeleted: false,
        rowVersion: 1,
      },
    ]);

    // الأصل 10 له 0 مراجع، الأصل 20 له مرجع واحد، الأصل 30 صورة له 0 مراجع
    prismaMock.lessonBlockItem.count
      .mockResolvedValueOnce(0) // asset 10
      .mockResolvedValueOnce(1) // asset 20
      .mockResolvedValueOnce(0); // asset 30

    const res = await lifecycle.reconcileUnlinkedAssetsUnderLock(
      prismaMock,
      [30, 10, 20],
    );

    expect(res.softDeletedAssetIds).toEqual([10]);
    expect(res.remainingCounts).toEqual({ 10: 0, 20: 1, 30: 0 });
    expect(prismaMock.mediaAsset.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({
          isDeleted: true,
          deletedAt: expect.any(Date),
          rowVersion: { increment: 1 },
        }),
      }),
    );
  });
});
