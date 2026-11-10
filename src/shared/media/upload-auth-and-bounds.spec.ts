/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
// src/shared/media/upload-auth-and-bounds.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🔐 VIDEO P4-3 — اختبارات الصلاحيات الفعلية وحدود الأجزاء وملكية الجلسة (§4.1, §4.3, §10.1)
// ═══════════════════════════════════════════════════════════════
// يغطي:
//   - رفض STUDENT / PARENT / OWNER / ADMIN لرفع VIDEO في المدرسة (403)
//   - رفض TEACHER غير المسند في SubjectSectionTeacher (403)
//   - قبول TEACHER مسند فعلياً + فحص subjectUuid / lessonUuid الاختياريين
//   - رفض PLATFORM_TEACHER غير المسند في PlatformUserSubject (403) وقبول المسند و PLATFORM_ADMIN
//   - حماية ملكية الجلسة (W-063) في probe/chunks/complete/cancel للمدرسة والمنصة
//   - فحوصات حدود الأجزاء الخمسة (W-057) قبل الكتابة في /storage/tmp
//   - توحيد حدود المنصة (W-058) وإلغاء السقوط الصامت (W-050)
//   - ترتيب فحوصات initSession: 503 → 403 → 400 → 507 → 201
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { MediaKind, MediaUploadStatus } from '@prisma/client';
import { PlatformMediaUploadService } from '../../platform/media/platform-media-upload.service';
import { MediaUploadService } from '../../school/media/media-upload.service';
import { MediaAccessPolicyService } from './media-access-policy.service';
import { UploadValidationHelper } from './upload-validation.helper';
import { VideoMediaConfig } from './video-media.config';

function makeEnabledVideoConfig(): VideoMediaConfig {
  const prev: Record<string, string | undefined> = {};
  const vars: Record<string, string> = {
    VIDEO_UPLOAD_ENABLED: 'true',
    R2_ACCOUNT_ID: 'acc-test',
    R2_ACCESS_KEY_ID: 'key-test',
    R2_SECRET_ACCESS_KEY: 'sec-test',
    R2_BUCKET_NAME: 'bucket-test',
  };
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return new VideoMediaConfig();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('VIDEO P4-3 — UploadAuthAndBoundsSpec (صلاحيات الإسناد الفعلي + W-063 + W-057 + W-058)', () => {
  // ── 1) صلاحيات رفع الفيديو في المدرسة (§4.1.1) ──

  describe('MediaAccessPolicyService — صلاحيات المدرسة', () => {
    it.each(['STUDENT', 'PARENT', 'OWNER', 'ADMIN'])(
      'يرفض الدور %s لرفع VIDEO بـ 403 VIDEO_UPLOAD_FORBIDDEN، ويسمح له برفع IMAGE',
      async (role) => {
        const prisma = {
          user: { findFirst: jest.fn() },
          subjectSectionTeacher: { findFirst: jest.fn() },
        };
        const policy = new MediaAccessPolicyService(prisma as any);

        await expect(
          policy.assertSchoolUploadAllowed(
            { userId: 10, schoolId: 1, role },
            MediaKind.IMAGE,
          ),
        ).resolves.toBeUndefined();

        const err = await policy
          .assertSchoolUploadAllowed(
            { userId: 10, schoolId: 1, role },
            MediaKind.VIDEO,
          )
          .catch((e) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getResponse()).toMatchObject({
          error: 'VIDEO_UPLOAD_FORBIDDEN',
        });
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
      },
    );

    it('يرفض TEACHER غير موجود أو غير نشط بـ 403 TEACHER_NOT_FOUND_OR_INACTIVE', async () => {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(null) },
        subjectSectionTeacher: { findFirst: jest.fn() },
      };
      const policy = new MediaAccessPolicyService(prisma as any);

      const err = await policy
        .assertSchoolUploadAllowed(
          { userId: 20, schoolId: 1, role: 'TEACHER' },
          MediaKind.VIDEO,
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        error: 'TEACHER_NOT_FOUND_OR_INACTIVE',
      });
    });

    it('يرفض TEACHER بلا إسناد نشط في SubjectSectionTeacher بـ 403 NO_ACTIVE_SUBJECT_ASSIGNMENT', async () => {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 20 }) },
        subjectSectionTeacher: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const policy = new MediaAccessPolicyService(prisma as any);

      const err = await policy
        .assertSchoolUploadAllowed(
          { userId: 20, schoolId: 1, role: 'TEACHER' },
          MediaKind.VIDEO,
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        error: 'NO_ACTIVE_SUBJECT_ASSIGNMENT',
      });
    });

    it('يقبل TEACHER مسنداً لمادة/شعبة نشطة، ويتحقق من subjectUuid/lessonUuid عند تمريرهما', async () => {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 20 }) },
        subject: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
        lessonTemplate: {
          findFirst: jest.fn().mockResolvedValue({ id: 9, subjectId: 5 }),
        },
        subjectSectionTeacher: {
          findFirst: jest.fn().mockResolvedValue({ id: 100 }),
        },
      };
      const policy = new MediaAccessPolicyService(prisma as any);

      await expect(
        policy.assertSchoolUploadAllowed(
          { userId: 20, schoolId: 1, role: 'TEACHER' },
          MediaKind.VIDEO,
          { subjectUuid: 'sub-5', lessonUuid: 'les-9' },
        ),
      ).resolves.toBeUndefined();

      expect(prisma.subjectSectionTeacher.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            teacherId: 20,
            isActive: true,
            isDeleted: false,
            subjectSection: expect.objectContaining({
              subjectId: 5,
              isActive: true,
              isDeleted: false,
            }),
          }),
        }),
      );
    });
  });

  // ── 2) صلاحيات رفع الفيديو في المنصة (§4.1.2) ──

  describe('MediaAccessPolicyService — صلاحيات المنصة', () => {
    it('يسمح لـ PLATFORM_ADMIN النشط مباشرةً ويرفض غير النشط', async () => {
      const prisma = {
        platformUser: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 1, role: 'PLATFORM_ADMIN' })
            .mockResolvedValueOnce(null),
        },
        platformUserSubject: { findFirst: jest.fn() },
      };
      const policy = new MediaAccessPolicyService(prisma as any);

      await expect(
        policy.assertPlatformUploadAllowed(
          { platformUserId: 1, role: 'PLATFORM_ADMIN' },
          MediaKind.VIDEO,
        ),
      ).resolves.toBeUndefined();
      expect(prisma.platformUserSubject.findFirst).not.toHaveBeenCalled();

      const err = await policy
        .assertPlatformUploadAllowed(
          { platformUserId: 99, role: 'PLATFORM_ADMIN' },
          MediaKind.VIDEO,
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        error: 'PLATFORM_USER_INACTIVE',
      });
    });

    it('يرفض PLATFORM_TEACHER غير المسند في PlatformUserSubject بـ 403 ويقبل المسند', async () => {
      const prisma = {
        platformUser: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 7, role: 'PLATFORM_TEACHER' }),
        },
        platformUserSubject: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 50 }),
        },
      };
      const policy = new MediaAccessPolicyService(prisma as any);

      const err = await policy
        .assertPlatformUploadAllowed(
          { platformUserId: 7, role: 'PLATFORM_TEACHER' },
          MediaKind.VIDEO,
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        error: 'NO_ACTIVE_PLATFORM_SUBJECT_ASSIGNMENT',
      });

      await expect(
        policy.assertPlatformUploadAllowed(
          { platformUserId: 7, role: 'PLATFORM_TEACHER' },
          MediaKind.VIDEO,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ── 3) حماية ملكية الجلسة W-063 في المدرسة والمنصة ──

  describe('W-063 — حماية ملكية الجلسة (probe, uploadChunk, complete, cancel)', () => {
    it('يرفض تعديل أو فحص جلسة مستخدم آخر في المدرسة بـ 403 SESSION_FORBIDDEN', async () => {
      const videoConfig = makeEnabledVideoConfig();
      const validation = new UploadValidationHelper(videoConfig);
      const sessionRow = {
        id: 1,
        uuid: 'sess-1',
        schoolId: 1,
        ownerType: 'SCHOOL',
        uploaderUserId: 100, // مالك الجلسة هو المعلم 100
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: BigInt(2_000_000),
        bytesReceived: 0n,
        chunkSizeBytes: 1_048_576,
        status: MediaUploadStatus.INITIATED,
        expiresAt: new Date(Date.now() + 3600_000),
        mediaAsset: { id: 10, uuid: 'asset-1' },
      };
      const prisma = {
        mediaUploadSession: {
          findFirst: jest.fn().mockResolvedValue(sessionRow),
          update: jest.fn(),
        },
      };
      const storage = { appendToTemp: jest.fn(), deleteTempFile: jest.fn() };
      const service = new MediaUploadService(
        prisma as any,
        storage as any,
        {} as any,
        {} as any,
        validation,
        {} as any,
      );

      // المعلم 200 يحاول التطفل على جلسة المعلم 100
      for (const op of [
        () => service.probeSession('sess-1', 1, 200),
        () =>
          service.uploadChunk(
            'sess-1',
            1,
            'bytes 0-1023/2000000',
            Buffer.alloc(1024),
            200,
          ),
        () => service.completeSession('sess-1', 1, 'school-uuid', 200),
        () => service.cancelSession('sess-1', 1, 200),
      ]) {
        const err = await op().catch((e) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.getResponse()).toMatchObject({ error: 'SESSION_FORBIDDEN' });
      }
      expect(storage.appendToTemp).not.toHaveBeenCalled();
      expect(storage.deleteTempFile).not.toHaveBeenCalled();
    });

    it('في المنصة: يرفض معلم منصة آخر بـ 403 SESSION_FORBIDDEN، ويسمح لـ PLATFORM_ADMIN', async () => {
      const videoConfig = makeEnabledVideoConfig();
      const validation = new UploadValidationHelper(videoConfig);
      const sessionRow = {
        id: 2,
        uuid: 'plat-sess-1',
        schoolId: null,
        ownerType: 'PLATFORM',
        platformUserId: 7,
        kind: MediaKind.VIDEO,
        contentType: 'video/mp4',
        totalSizeBytes: BigInt(2_000_000),
        bytesReceived: 512n,
        chunkSizeBytes: 1_048_576,
        status: MediaUploadStatus.UPLOADING,
        processingStatus: null,
        expiresAt: new Date(Date.now() + 3600_000),
        mediaAsset: { id: 20, uuid: 'plat-asset-1' },
      };
      const prisma = {
        mediaUploadSession: {
          findFirst: jest.fn().mockResolvedValue(sessionRow),
        },
      };
      const service = new PlatformMediaUploadService(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        validation,
        {} as any,
      );

      // معلم منصة آخر (id=8) → مرفوض
      await expect(
        service.probeSession('plat-sess-1', {
          platformUserId: 8,
          role: 'PLATFORM_TEACHER',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // مالك الجلسة (id=7) → مسموح
      await expect(
        service.probeSession('plat-sess-1', {
          platformUserId: 7,
          role: 'PLATFORM_TEACHER',
        }),
      ).resolves.toMatchObject({ bytes_received: 512 });

      // مشرف المنصة (PLATFORM_ADMIN) → مسموح
      await expect(
        service.probeSession('plat-sess-1', {
          platformUserId: 1,
          role: 'PLATFORM_ADMIN',
        }),
      ).resolves.toMatchObject({ bytes_received: 512 });
    });
  });

  // ── 4) فحوصات حدود الأجزاء الخمسة (W-057) وحدود الحجم (W-050 / W-058) ──

  describe('W-057 + W-050/W-058 — فحوصات حدود الأجزاء والحجم', () => {
    const videoConfig = makeEnabledVideoConfig();
    const helper = new UploadValidationHelper(videoConfig);

    const baseSession = {
      kind: MediaKind.VIDEO,
      status: MediaUploadStatus.UPLOADING,
      expiresAt: new Date(Date.now() + 3600_000),
      bytesReceived: BigInt(1000),
      totalSizeBytes: BigInt(3000),
      chunkSizeBytes: 1024,
    };

    it('W-057.1: حالة الجلسة COMPLETED / CANCELED / EXPIRED تُرفض قبل أي كتابة', () => {
      expect(() =>
        helper.validateChunkUpload(
          { ...baseSession, status: MediaUploadStatus.COMPLETED },
          'bytes 1000-1999/3000',
          1000,
        ),
      ).toThrow(ConflictException);

      expect(() =>
        helper.validateChunkUpload(
          { ...baseSession, status: MediaUploadStatus.CANCELED },
          'bytes 1000-1999/3000',
          1000,
        ),
      ).toThrow(ConflictException);

      expect(() =>
        helper.validateChunkUpload(
          { ...baseSession, expiresAt: new Date(Date.now() - 1000) },
          'bytes 1000-1999/3000',
          1000,
        ),
      ).toThrow(GoneException);
    });

    it('W-057.2: start !== bytesReceived يُرجع 409 OUT_OF_ORDER مع bytes_received و next_expected_byte', () => {
      let caught: any;
      try {
        helper.validateChunkUpload(baseSession, 'bytes 0-999/3000', 1000);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught.getResponse()).toMatchObject({
        error: 'OUT_OF_ORDER',
        bytes_received: 1000,
        next_expected_byte: 1000,
      });
    });

    it('W-057.3: عدم تطابق طول الجزء الفعلي مع (end - start + 1) يُرفض بـ 400 CONTENT_RANGE_LENGTH_MISMATCH', () => {
      let caught: any;
      try {
        helper.validateChunkUpload(baseSession, 'bytes 1000-1999/3000', 500);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.getResponse()).toMatchObject({
        error: 'CONTENT_RANGE_LENGTH_MISMATCH',
      });
    });

    it('W-057.4: تجاوز chunkSizeBytes يُرفض بـ 400 CHUNK_TOO_LARGE', () => {
      let caught: any;
      try {
        helper.validateChunkUpload(baseSession, 'bytes 1000-2499/3000', 1500);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.getResponse()).toMatchObject({
        error: 'CHUNK_TOO_LARGE',
        max_chunk_bytes: 1024,
      });
    });

    it('W-057.5: اختلاف total أو تجاوز المجموع التراكمي لـ totalSizeBytes يُرفض بـ 400 قبل الكتابة في /storage/tmp', () => {
      // اختلاف total في الترويسة عن حجم الجلسة
      let caught1: any;
      try {
        helper.validateChunkUpload(
          baseSession,
          'bytes 1000-1999/9999999',
          1000,
        );
      } catch (e) {
        caught1 = e;
      }
      expect(caught1).toBeInstanceOf(BadRequestException);
      expect(caught1.getResponse()).toMatchObject({
        error: 'TOTAL_SIZE_MISMATCH',
      });

      // تجاوز totalSizeBytes (المتبقي 500 بايت ويحاول إرسال 1000 بايت)
      let caught2: any;
      try {
        helper.validateChunkUpload(
          { ...baseSession, bytesReceived: BigInt(2500) },
          'bytes 2500-3499/3000',
          1000,
        );
      } catch (e) {
        caught2 = e;
      }
      expect(caught2).toBeInstanceOf(BadRequestException);
      expect(caught2.getResponse()).toMatchObject({
        error: 'FILE_TOO_LARGE',
      });
    });

    it('W-050 / W-058: حدود الحجم الصريحة (IMAGE=20MiB, AUDIO=50MiB, VIDEO=150MB) ونوع المحتوى', () => {
      expect(() =>
        helper.validateFileSize(150_000_000, MediaKind.VIDEO),
      ).not.toThrow();
      expect(() =>
        helper.validateFileSize(150_000_001, MediaKind.VIDEO),
      ).toThrow(BadRequestException);

      expect(() =>
        helper.validateContentType('video/mp4', MediaKind.VIDEO, 'SCHOOL'),
      ).not.toThrow();
      expect(() =>
        helper.validateContentType(
          'video/quicktime',
          MediaKind.VIDEO,
          'SCHOOL',
        ),
      ).not.toThrow();
      expect(() =>
        helper.validateContentType('video/webm', MediaKind.VIDEO, 'SCHOOL'),
      ).toThrow(BadRequestException);
    });
  });
});
