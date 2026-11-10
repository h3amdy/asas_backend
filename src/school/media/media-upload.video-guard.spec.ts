/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
// src/school/media/media-upload.video-guard.spec.ts
// 🎬 VIDEO P4-1 / P4-3 — اختبار عزل تعطيل الفيديو وعدم تراجع IMAGE/AUDIO
//
// عند تعطيل رفع الفيديو (VIDEO_UPLOAD_ENABLED≠true — الافتراضي):
// - أي طلب initSession(kind=VIDEO) يُرفض فوراً بـ 503 VIDEO_FEATURE_DISABLED قبل لمس DB أو القرص.
// - مسارات IMAGE و AUDIO تعمل بكامل قواعدها السابقة دون أي تغيير.
import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { MediaKind } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { UploadValidationHelper } from '../../shared/media/upload-validation.helper';
import { VideoMediaConfig } from '../../shared/media/video-media.config';
import { VideoUploadService } from '../../shared/media/video-upload.service';
import { InitUploadSessionDto } from './dto/init-upload-session.dto';
import { MediaUploadService } from './media-upload.service';

function buildDisabledService() {
  const prev = process.env.VIDEO_UPLOAD_ENABLED;
  delete process.env.VIDEO_UPLOAD_ENABLED;
  try {
    const videoConfig = new VideoMediaConfig();
    const validation = new UploadValidationHelper(videoConfig);
    const prisma = {
      mediaAsset: { create: jest.fn() },
      mediaUploadSession: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const storage = { ensureTempDir: jest.fn(), getTempPath: jest.fn() };
    const processing = {};
    const diskGuard = { reserveAndRun: jest.fn() };
    const ffprobe = { probe: jest.fn() };
    const accessPolicy = new MediaAccessPolicyService(prisma as any);
    const video = new VideoUploadService(
      prisma as any,
      storage as any,
      videoConfig,
      diskGuard as any,
      ffprobe as any,
      validation,
    );
    const service = new MediaUploadService(
      prisma as any,
      storage as any,
      processing as any,
      video,
      validation,
      accessPolicy,
    );
    return { service, prisma, storage, diskGuard };
  } finally {
    if (prev !== undefined) process.env.VIDEO_UPLOAD_ENABLED = prev;
  }
}

describe('MediaUploadService — عزل VIDEO_UPLOAD_ENABLED=false وعدم تراجع IMAGE/AUDIO (P4-1 / P4-3)', () => {
  it('Prisma MediaKind يحتوي VIDEO مع بقاء القيم القديمة', () => {
    expect(Object.values(MediaKind)).toEqual(
      expect.arrayContaining(['IMAGE', 'AUDIO', 'DOCUMENT', 'VIDEO']),
    );
  });

  it('DTO يقبل kind=VIDEO وحقول subjectUuid و lessonUuid الاختيارية', async () => {
    const dto = plainToInstance(InitUploadSessionDto, {
      kind: 'VIDEO',
      contentType: 'video/mp4',
      totalSizeBytes: 100_000_000,
      subjectUuid: 'sub-uuid',
      lessonUuid: 'les-uuid',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it.each(['video/mp4', 'video/quicktime', 'audio/mpeg', 'image/jpeg'])(
    'عند تعطيل الفيديو: initSession(kind=VIDEO, contentType=%p) يُرفض فوراً بـ 503 VIDEO_FEATURE_DISABLED دون لمس DB أو القرص',
    async (contentType) => {
      const { service, prisma, storage, diskGuard } = buildDisabledService();
      const dto = {
        kind: MediaKind.VIDEO,
        contentType,
        totalSizeBytes: 10_000_000,
      } as InitUploadSessionDto;

      const err = await service
        .initSession(dto, 1, 'school-uuid', { userId: 1, role: 'TEACHER' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({
        error: 'VIDEO_FEATURE_DISABLED',
      });
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
      expect(prisma.mediaUploadSession.create).not.toHaveBeenCalled();
      expect(diskGuard.reserveAndRun).not.toHaveBeenCalled();
      expect(storage.ensureTempDir).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['IMAGE', 'image/jpeg', 25_000_000, 'FILE_TOO_LARGE'],
    ['AUDIO', 'video/mp4', 1_000_000, 'CONTENT_TYPE_MISMATCH'],
  ])(
    'قواعد %s السابقة كما هي (contentType=%s, size=%d → %s)',
    async (kind, contentType, totalSizeBytes, expected) => {
      const { service } = buildDisabledService();
      const err = await service
        .initSession(
          { kind, contentType, totalSizeBytes } as any,
          1,
          'school-uuid',
          { userId: 1, role: 'TEACHER' },
        )
        .catch((e) => e);
      expect(err.getResponse()).toMatchObject({ error: expected });
    },
  );
});
