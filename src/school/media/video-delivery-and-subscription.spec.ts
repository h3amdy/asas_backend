/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
// src/school/media/video-delivery-and-subscription.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 VIDEO P4-5b — اختبارات نقاط التسليم (/status, /download-url, /meta, 409 USE_DOWNLOAD_URL)
//                  وفحص الاشتراك الفعلي بـ JWT حقيقي (Decision 2)
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MediaKind, ProcessingStatus } from '@prisma/client';
import { PlatformMediaController } from '../../platform/media/platform-media.controller';
import { PlatformMediaService } from '../../platform/media/platform-media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { R2StorageProvider } from '../../shared/media/r2-storage.provider';
import { StorageService } from '../../shared/media/storage.service';
import { VideoMediaConfig } from '../../shared/media/video-media.config';
import { VideoVariantsManifest } from '../../shared/media/worker/video-transcode.processor';
import { SchoolJwtStrategy } from '../auth/strategies/school-jwt.strategy';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

const SAMPLE_VIDEO_MANIFEST: VideoVariantsManifest = {
  schema_version: 1,
  quality_ladder: [360, 480],
  preferred_variant: '480p',
  variants: {
    '360p': {
      storage_key: 'school/10/videos/2026/11/v-uuid/360p.mp4',
      width: 640,
      height: 360,
      size_bytes: 4_100_000,
      sha256: 'a'.repeat(64),
      etag: '"etag-360p"',
      status: 'VERIFIED',
      verified_at: '2026-11-06T10:00:00.000Z',
    },
    '480p': {
      storage_key: 'school/10/videos/2026/11/v-uuid/480p.mp4',
      width: 854,
      height: 480,
      size_bytes: 7_200_000,
      sha256: 'b'.repeat(64),
      etag: '"etag-480p"',
      status: 'VERIFIED',
      verified_at: '2026-11-06T10:00:05.000Z',
    },
  },
  thumb: {
    storage_key: 'school/10/videos/2026/11/v-uuid/thumb.webp',
    size_bytes: 18_500,
    sha256: 'c'.repeat(64),
    etag: '"etag-thumb"',
    status: 'VERIFIED',
    verified_at: '2026-11-06T10:00:01.000Z',
  },
  source: {
    storage_key: 'school/10/videos/2026/11/v-uuid/source.mp4',
    ext: '.mp4',
    location: 'READY',
    size_bytes: 15_000_000,
    sha256: 'd'.repeat(64),
    etag: '"etag-source"',
    status: 'VERIFIED',
    verified_at: '2026-11-06T10:00:00.000Z',
  },
};

describe('VIDEO P4-5b — Delivery Endpoints, Redaction & Real JWT Subscription Guard (Decision 2)', () => {
  let prismaMock: any;
  let storageMock: any;
  let r2StorageMock: any;
  let videoConfig: VideoMediaConfig;
  let accessPolicy: MediaAccessPolicyService;
  let schoolMediaService: MediaService;
  let schoolController: MediaController;
  let platformMediaService: PlatformMediaService;
  let platformController: PlatformMediaController;

  const schoolId = 10;
  const schoolUuid = 'school-10-uuid';
  const videoUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const readySchoolVideoAsset = {
    id: 501,
    uuid: videoUuid,
    schoolId,
    ownerType: 'SCHOOL',
    kind: MediaKind.VIDEO,
    storageProvider: 'R2',
    storageKey: 'school/10/videos/2026/11/v-uuid/480p.mp4',
    originalUrl: null,
    contentType: 'video/mp4',
    sizeBytes: BigInt(7_200_000),
    etag: '"etag-480p"',
    sha256: 'b'.repeat(64),
    width: 854,
    height: 480,
    durationSec: 95,
    variantsJson: JSON.stringify(SAMPLE_VIDEO_MANIFEST),
    preferredVariant: '480p',
    processingStatus: ProcessingStatus.DONE,
    rowVersion: 2,
    createdAt: new Date('2026-11-06T10:00:00.000Z'),
    updatedAt: new Date('2026-11-06T10:01:00.000Z'),
    isDeleted: false,
    deletedAt: null,
  };

  beforeEach(() => {
    prismaMock = {
      authSession: {
        findUnique: jest.fn(),
      },
      mediaAsset: {
        findFirst: jest.fn(),
      },
      mediaProcessingJob: {
        findFirst: jest.fn(),
      },
      lessonContent: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      lessonBlockItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 9001 }), // أصل تعليمي افتراضياً
      },
      schoolBook: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      question: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      questionOption: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      questionMatchingPair: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      questionOrderingItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      schoolSubscriptionSettings: {
        findUnique: jest.fn().mockResolvedValue({ isActivated: true }),
      },
      user: {
        findFirst: jest.fn(),
      },
      studentAccessPeriod: {
        findFirst: jest.fn(),
      },
    };

    storageMock = {
      fileExists: jest.fn(),
      getFileSize: jest.fn(),
      getReadStream: jest.fn(),
    };

    r2StorageMock = {
      getPresignedGetUrl: jest
        .fn()
        .mockImplementation((_key: string, ttl: number) =>
          Promise.resolve({
            url: `https://acc.r2.cloudflarestorage.com/bucket/signed-object?X-Amz-Expires=${ttl}&X-Amz-Signature=secret123`,
            expiresAt: new Date('2026-11-06T11:00:00.000Z'),
          }),
        ),
    };

    videoConfig = new VideoMediaConfig();
    accessPolicy = new MediaAccessPolicyService(
      prismaMock as unknown as PrismaService,
    );

    schoolMediaService = new MediaService(
      prismaMock as unknown as PrismaService,
      storageMock as unknown as StorageService,
      accessPolicy,
      videoConfig,
      r2StorageMock as unknown as R2StorageProvider,
    );
    schoolController = new MediaController(
      schoolMediaService,
      storageMock as unknown as StorageService,
      prismaMock as unknown as PrismaService,
    );

    platformMediaService = new PlatformMediaService(
      prismaMock as unknown as PrismaService,
      storageMock as unknown as StorageService,
      accessPolicy,
      videoConfig,
      r2StorageMock as unknown as R2StorageProvider,
    );
    platformController = new PlatformMediaController(
      platformMediaService,
      storageMock as unknown as StorageService,
    );
  });

  describe('1. GET /{school|platform}/media/:uuid/status & /meta (Redaction & Partial Progress)', () => {
    it('يعيد حالة DONE مع الجودات الجاهزة والمخططة دون تسريب storage_key أو source في /status و /meta', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValue(readySchoolVideoAsset);

      const req = {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: { ut: 'TEACHER', sub: 'teacher-uuid', sc: schoolUuid },
      };

      const statusRes = await schoolController.getStatus(videoUuid, req);
      expect(statusRes).toEqual({
        asset_uuid: videoUuid,
        kind: 'VIDEO',
        processing_status: 'DONE',
        variants_ready: ['360p', '480p'],
        variants_planned: ['360p', '480p'],
        preferred_variant: '480p',
        duration_sec: 95,
        error_code: null,
      });
      expect(JSON.stringify(statusRes)).not.toContain('storage_key');
      expect(JSON.stringify(statusRes)).not.toContain('source.mp4');

      const metaRes = await schoolController.getMeta(videoUuid, req);
      expect(Object.keys(metaRes.variants)).toEqual(['360p', '480p', 'thumb']);
      expect(metaRes.variants['480p']).toEqual({
        etag: '"etag-480p"',
        size_bytes: 7_200_000,
        sha256: 'b'.repeat(64),
        content_type: 'video/mp4',
        width: 854,
        height: 480,
      });
      expect(JSON.stringify(metaRes)).not.toContain('storage_key');
      expect(JSON.stringify(metaRes)).not.toContain('source.mp4');
    });

    it('يعيد التقدم الجزئي (variants_ready من step_state_json) أثناء PROCESSING، ورمز الخطأ الآمن عند ERROR', async () => {
      const processingAsset = {
        ...readySchoolVideoAsset,
        processingStatus: ProcessingStatus.PROCESSING,
        variantsJson: null,
      };
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(processingAsset);
      prismaMock.mediaProcessingJob.findFirst.mockResolvedValueOnce({
        payloadJson: JSON.stringify({ qualityLadder: [360, 480, 720] }),
        stepStateJson: JSON.stringify({
          source: 'DOWNLOADED',
          thumb: 'VERIFIED',
          variants: {
            '360p': 'VERIFIED',
            '480p': 'PENDING',
            '720p': 'PENDING',
          },
          variant_records: {
            '360p': {
              storage_key: 'school/10/videos/v/360p.mp4',
              width: 640,
              height: 360,
              size_bytes: 1000,
              sha256: 'a'.repeat(64),
              status: 'VERIFIED',
              verified_at: '2026-11-06T10:00:00Z',
            },
          },
        }),
        lastError: null,
      });

      const req = {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: { ut: 'TEACHER', sub: 'teacher-uuid', sc: schoolUuid },
      };

      const statusRes = await schoolController.getStatus(videoUuid, req);
      expect(statusRes.processing_status).toBe('PROCESSING');
      expect(statusRes.variants_planned).toEqual(['360p', '480p', '720p']);
      expect(statusRes.variants_ready).toEqual(['360p']);
      expect(statusRes.error_code).toBeNull();

      // حالة ERROR مع رسالة خطأ تحتوي مساراً داخلياً -> يستخرج الرمز فقط دون المسار
      const errorAsset = {
        ...readySchoolVideoAsset,
        processingStatus: ProcessingStatus.ERROR,
        variantsJson: null,
      };
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(errorAsset);
      prismaMock.mediaProcessingJob.findFirst.mockResolvedValueOnce({
        payloadJson: JSON.stringify({ qualityLadder: [360, 480] }),
        stepStateJson: null,
        lastError:
          '[VARIANT_SIZE_LIMIT_EXCEEDED] حجم النسخة في /var/tmp/secret/path تجاوز الحد',
      });

      const errStatusRes = await schoolController.getStatus(videoUuid, req);
      expect(errStatusRes.processing_status).toBe('ERROR');
      expect(errStatusRes.error_code).toBe('VARIANT_SIZE_LIMIT_EXCEEDED');
      expect(JSON.stringify(errStatusRes)).not.toContain('/var/tmp/secret');
    });
  });

  describe('2. GET /{school|platform}/media/:uuid/download-url (DL-T1..T4 & No URL Logging)', () => {
    it('DL-T1: يرفض بـ 409 NOT_READY عندما يكون الفيديو قيد المعالجة PROCESSING', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce({
        ...readySchoolVideoAsset,
        processingStatus: ProcessingStatus.PROCESSING,
      });

      const req = {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: { ut: 'TEACHER', sub: 'teacher-uuid', sc: schoolUuid },
      };

      await expect(
        schoolController.getDownloadUrl(videoUuid, '360p', req),
      ).rejects.toThrow(ConflictException);
    });

    it('DL-T2: يرفض بـ 400 INVALID_VARIANT مع قائمة available_variants عند طلب جودة غير موجودة (720p لفيديو 480p)', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValue(readySchoolVideoAsset);

      const req = {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: { ut: 'TEACHER', sub: 'teacher-uuid', sc: schoolUuid },
      };

      try {
        await schoolController.getDownloadUrl(videoUuid, '720p', req);
        fail('Expected BadRequestException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual(
          expect.objectContaining({
            error: 'INVALID_VARIANT',
            available_variants: ['360p', '480p', 'thumb'],
          }),
        );
      }
    });

    it('DL-T3: يصدر رابطاً موقّعاً صالحاً للجودة المطلوبة أو الافتراضية دون تسجيل الرابط الموقّع أو storageKey في السجل', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValue(readySchoolVideoAsset);
      const logSpy = jest.spyOn((schoolMediaService as any).logger, 'log');

      const req = {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: { ut: 'TEACHER', sub: 'teacher-uuid-1', sc: schoolUuid },
      };

      const res = await schoolController.getDownloadUrl(videoUuid, '360p', req);
      expect(res).toEqual({
        url: expect.stringContaining(
          'https://acc.r2.cloudflarestorage.com/bucket/signed-object',
        ),
        expires_at: '2026-11-06T11:00:00.000Z',
        variant: '360p',
        size_bytes: 4_100_000,
        sha256: 'a'.repeat(64),
        etag: '"etag-360p"',
        content_type: 'video/mp4',
      });

      // التحقق من عدم تسرب الرابط الموقّع أو المسار الداخلي في السجلات
      expect(logSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = String(logSpy.mock.calls[0][0]);
      expect(loggedMessage).not.toContain('X-Amz-Signature');
      expect(loggedMessage).not.toContain('r2.cloudflarestorage.com');
      expect(loggedMessage).not.toContain('school/10/videos');
    });

    it('DL-T4: يرمي 503 STORAGE_PROVIDER_UNAVAILABLE بانتظام عند طلب download-url بينما R2 غير مفعّل', async () => {
      const platformAsset = {
        ...readySchoolVideoAsset,
        ownerType: 'PLATFORM',
        schoolId: null,
      };
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(platformAsset);

      // استخدام R2StorageProvider حقيقي مع VideoMediaConfig معطّل (VIDEO_UPLOAD_ENABLED != true)
      const disabledConfig = new VideoMediaConfig();
      const realR2WithDisabledConfig = new R2StorageProvider(disabledConfig);
      const svcWithDisabledR2 = new PlatformMediaService(
        prismaMock as unknown as PrismaService,
        storageMock as unknown as StorageService,
        accessPolicy,
        disabledConfig,
        realR2WithDisabledConfig,
      );
      const ctrlWithDisabledR2 = new PlatformMediaController(
        svcWithDisabledR2,
        storageMock as unknown as StorageService,
      );

      await expect(
        ctrlWithDisabledR2.getDownloadUrl(videoUuid, '360p', {
          user: { sub: 'p-admin' },
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('3. Decision 2 — فحص الاشتراك الفعلي بحمولة SchoolJwtStrategy الحقيقية (SUB-T1..T6)', () => {
    const prevJwtSecret = process.env.JWT_SECRET;
    let jwtStrategy: SchoolJwtStrategy;

    beforeEach(() => {
      process.env.JWT_SECRET = 'test-jwt-secret-for-p4-5b';
      jwtStrategy = new SchoolJwtStrategy(
        prismaMock as unknown as PrismaService,
      );
      prismaMock.mediaAsset.findFirst.mockResolvedValue(readySchoolVideoAsset);
    });

    afterEach(() => {
      if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwtSecret;
    });

    async function buildValidatedRequest(payload: {
      sub: string;
      ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
      sc: string;
      sid: string;
    }) {
      prismaMock.authSession.findUnique.mockResolvedValueOnce({
        uuid: payload.sid,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        user: { uuid: payload.sub, isActive: true, isDeleted: false },
        school: { uuid: payload.sc, isActive: true, isDeleted: false },
        device: { isActive: true },
      });

      const validatedUser = await jwtStrategy.validate(payload);
      return {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: validatedUser,
        headers: {},
      };
    }

    it('SUB-T1 & SUB-T2: طالب بـ JWT حقيقي (ut=STUDENT, sub=uuid) ينجح عند سريان الاشتراك ويُرفض بـ 403 SUBSCRIPTION_INACTIVE عند انتهائه', async () => {
      const studentUuid = 'student-active-uuid';
      prismaMock.user.findFirst.mockResolvedValue({ id: 701 });

      // 1) اشتراك سارٍ -> 200 OK
      prismaMock.studentAccessPeriod.findFirst.mockResolvedValueOnce({
        id: 8001,
      });
      const reqActive = await buildValidatedRequest({
        sub: studentUuid,
        ut: 'STUDENT',
        sc: schoolUuid,
        sid: 'sess-1',
      });

      const dlRes = await schoolController.getDownloadUrl(
        videoUuid,
        '360p',
        reqActive,
      );
      expect(dlRes.variant).toBe('360p');
      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            uuid: studentUuid,
            schoolId,
            userType: 'STUDENT',
            isDeleted: false,
            isActive: true,
          },
        }),
      );

      // 2) انتهاء الاشتراك (expiresAt <= now) -> 403 SUBSCRIPTION_INACTIVE
      prismaMock.studentAccessPeriod.findFirst.mockResolvedValueOnce(null);
      const reqExpired = await buildValidatedRequest({
        sub: studentUuid,
        ut: 'STUDENT',
        sc: schoolUuid,
        sid: 'sess-1',
      });

      try {
        await schoolController.getDownloadUrl(videoUuid, '360p', reqExpired);
        fail('Expected ForbiddenException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toMatchObject({
          error: 'SUBSCRIPTION_INACTIVE',
        });
      }
    });

    it('SUB-T3: ولي أمر بـ JWT حقيقي (ut=PARENT, sub=uuid) يخضع لفحص اشتراك أبنائه في نفس المدرسة', async () => {
      const parentUuid = 'parent-uuid-1';
      prismaMock.user.findFirst.mockResolvedValue({
        id: 702,
        parent: {
          childLinks: [{ studentId: 701 }],
        },
      });

      // الابن لديه اشتراك سارٍ -> 200 OK
      prismaMock.studentAccessPeriod.findFirst.mockResolvedValueOnce({
        id: 8002,
      });
      const reqParentOk = await buildValidatedRequest({
        sub: parentUuid,
        ut: 'PARENT',
        sc: schoolUuid,
        sid: 'sess-parent',
      });
      const res = await schoolController.getDownloadUrl(
        videoUuid,
        '480p',
        reqParentOk,
      );
      expect(res.variant).toBe('480p');

      // الابن انتهى اشتراكه -> 403 SUBSCRIPTION_INACTIVE
      prismaMock.studentAccessPeriod.findFirst.mockResolvedValueOnce(null);
      await expect(
        schoolController.getDownloadUrl(videoUuid, '480p', reqParentOk),
      ).rejects.toThrow(ForbiddenException);
    });

    it('SUB-T4 & SUB-T5 (Fail-Closed): يرفض بـ 403 عند غياب الهوية أو عدم وجود الطالب في المدرسة، ولا يسمح بتجاوز الفحص أبداً', async () => {
      // غياب req.user أو الدور -> Fail-Closed 403
      await expect(
        schoolController.getDownloadUrl(videoUuid, '360p', {
          schoolContext: { id: schoolId, uuid: schoolUuid },
          user: {},
        }),
      ).rejects.toThrow(ForbiddenException);

      // طالب غير موجود في هذه المدرسة (محاولة استخدام توكن طالب من مدرسة أخرى) -> 403
      prismaMock.user.findFirst.mockResolvedValueOnce(null);
      await expect(
        schoolController.getDownloadUrl(videoUuid, '360p', {
          schoolContext: { id: schoolId, uuid: schoolUuid },
          user: { ut: 'STUDENT', sub: 'foreign-student-uuid', sc: schoolUuid },
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('4. W049-T3 — حارس 409 USE_DOWNLOAD_URL على نقاط التنزيل المباشر القديمة', () => {
    it('GET /school/media/:uuid و GET /platform/media/:uuid يعيدان 409 USE_DOWNLOAD_URL لأصول R2 دون لمس القرص المحلي', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValue(readySchoolVideoAsset);

      const req = {
        schoolContext: { id: schoolId, uuid: schoolUuid },
        user: { ut: 'TEACHER', sub: 'teacher-uuid', sc: schoolUuid },
      };
      const resMock = {} as any;

      try {
        await schoolController.download(
          videoUuid,
          'medium',
          undefined,
          undefined,
          req,
          resMock,
        );
        fail('Expected ConflictException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toEqual({
          error: 'USE_DOWNLOAD_URL',
          download_url_endpoint: `/school/media/${videoUuid}/download-url`,
        });
      }

      // المنصة
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce({
        ...readySchoolVideoAsset,
        ownerType: 'PLATFORM',
        schoolId: null,
      });

      try {
        await platformController.download(
          videoUuid,
          'medium',
          undefined,
          undefined,
          resMock,
        );
        fail('Expected ConflictException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getStatus()).toBe(409);
        expect(err.getResponse()).toEqual({
          error: 'USE_DOWNLOAD_URL',
          download_url_endpoint: `/platform/media/${videoUuid}/download-url`,
        });
      }

      expect(storageMock.fileExists).not.toHaveBeenCalled();
    });

    it('يحافظ على عمل S4-T2 (404 ASSET_NOT_FOUND) قبل إرجاع 409 عندما يطلب مستخدم مدرسة B فيديو مدرسة A', async () => {
      prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(
        readySchoolVideoAsset,
      );

      const reqSchoolB = {
        schoolContext: { id: 20, uuid: 'school-20-uuid' },
        user: { ut: 'TEACHER', sub: 'teacher-b', sc: 'school-20-uuid' },
      };

      await expect(
        schoolController.download(
          videoUuid,
          undefined,
          undefined,
          undefined,
          reqSchoolB,
          {} as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
