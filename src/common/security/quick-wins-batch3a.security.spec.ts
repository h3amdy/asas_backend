import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { MediaKind, MediaUploadStatus, ProcessingStatus } from '@prisma/client';
import express from 'express';
import * as fs from 'node:fs';
import http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { PlatformLessonsService } from '../../platform/lessons/platform-lessons.service';
import { PlatformMediaUploadService } from '../../platform/media/platform-media-upload.service';
import { PlatformQuestionsService } from '../../platform/questions/platform-questions.service';
import { PlatformUnitsService } from '../../platform/units/platform-units.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCheckController } from '../../releases/update-check/update-check.controller';
import { UpdateCheckService } from '../../releases/update-check/update-check.service';
import { SCHOOL_AUTH_ERRORS } from '../../school/auth/constants';
import { SchoolInfoService } from '../../school/manager/school-info/school-info.service';
import { MediaUploadService } from '../../school/media/media-upload.service';
import { ProfileService } from '../../school/profile/profile.service';
import { SessionsService } from '../../school/sessions/sessions.service';
import { PlatformContentService } from '../../school/shared/platform-content/platform-content.service';
import { StorageService } from '../../shared/media/storage.service';
import { UploadValidationHelper } from '../../shared/media/upload-validation.helper';
import { VideoMediaConfig } from '../../shared/media/video-media.config';

describe('Quick Wins Batch 3A (SEC-PLT-02, SEC-TCH-03, SEC-PRF-01, SEC-AUTH-06, SEC-MED-04, SEC-PUB-01)', () => {
  describe('SEC-PLT-02 — Enforce isDeleted: false on all 5 platformUserSubject queries', () => {
    it('PlatformUnitsService rejects unassigned/soft-deleted subject via isDeleted: false and allows PLATFORM_ADMIN', async () => {
      const prismaMock: any = {
        platformUser: { findFirst: jest.fn() },
        subjectDictionary: { findFirst: jest.fn() },
        platformUserSubject: { findFirst: jest.fn() },
        unit: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new PlatformUnitsService(prismaMock);

      prismaMock.platformUser.findFirst.mockResolvedValue({
        id: 11,
        uuid: 'pt-1',
        role: 'PLATFORM_TEACHER',
      });
      prismaMock.subjectDictionary.findFirst.mockResolvedValue({
        id: 22,
        uuid: 'dict-1',
      });
      prismaMock.platformUserSubject.findFirst.mockResolvedValue(null);

      await expect(service.getUnits('pt-1', 'dict-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.platformUserSubject.findFirst).toHaveBeenCalledWith({
        where: {
          platformUserId: 11,
          subjectDictionaryId: 22,
          isDeleted: false,
        },
      });

      prismaMock.platformUserSubject.findFirst.mockClear();
      prismaMock.platformUser.findFirst.mockResolvedValue({
        id: 1,
        uuid: 'pa-1',
        role: 'PLATFORM_ADMIN',
      });
      await expect(service.getUnits('pa-1', 'dict-1')).resolves.toEqual({
        units: [],
      });
      expect(prismaMock.platformUserSubject.findFirst).not.toHaveBeenCalled();
    });

    it('PlatformLessonsService enforces isDeleted: false on assertOwnsSubject and assertOwnsLesson (fail-closed on null subjectDictionaryId)', async () => {
      const prismaMock: any = {
        platformUser: { findFirst: jest.fn() },
        subjectDictionary: { findFirst: jest.fn() },
        lessonTemplate: { findFirst: jest.fn(), update: jest.fn() },
        platformUserSubject: { findFirst: jest.fn() },
      };
      const service = new PlatformLessonsService(prismaMock);

      prismaMock.platformUser.findFirst.mockResolvedValue({
        id: 12,
        uuid: 'pt-2',
        role: 'PLATFORM_TEACHER',
      });
      prismaMock.subjectDictionary.findFirst.mockResolvedValue({
        id: 33,
        uuid: 'dict-2',
      });
      prismaMock.platformUserSubject.findFirst.mockResolvedValue(null);

      await expect(
        service.getLessonsByUnits('pt-2', 'dict-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.platformUserSubject.findFirst).toHaveBeenCalledWith({
        where: {
          platformUserId: 12,
          subjectDictionaryId: 33,
          isDeleted: false,
        },
      });

      prismaMock.platformUserSubject.findFirst.mockClear();
      prismaMock.lessonTemplate.findFirst.mockResolvedValue({
        id: 44,
        uuid: 'les-1',
        subjectDictionaryId: 33,
        unitId: 5,
        orderIndex: 1,
        ownerType: 'PLATFORM',
      });
      await expect(
        service.updateLesson('pt-2', 'les-1', { title: 'New' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.platformUserSubject.findFirst).toHaveBeenCalledWith({
        where: {
          platformUserId: 12,
          subjectDictionaryId: 33,
          isDeleted: false,
          subjectDictionary: { isDeleted: false, isActive: true },
        },
      });

      prismaMock.platformUserSubject.findFirst.mockClear();
      prismaMock.lessonTemplate.findFirst.mockResolvedValue({
        id: 45,
        uuid: 'les-null-dict',
        subjectDictionaryId: null,
        unitId: 5,
        orderIndex: 2,
        ownerType: 'PLATFORM',
      });
      await expect(
        service.updateLesson('pt-2', 'les-null-dict', { title: 'New' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.platformUserSubject.findFirst).not.toHaveBeenCalled();
    });

    it('PlatformQuestionsService enforces isDeleted: false & active dictionary on assertOwnsLesson and assertOwnsQuestion (fail-closed)', async () => {
      const prismaMock: any = {
        platformUser: { findFirst: jest.fn() },
        lessonTemplate: { findFirst: jest.fn() },
        question: { findFirst: jest.fn() },
        platformUserSubject: { findFirst: jest.fn() },
      };
      const service = new PlatformQuestionsService(prismaMock);

      prismaMock.platformUser.findFirst.mockResolvedValue({
        id: 15,
        uuid: 'pt-3',
        role: 'PLATFORM_TEACHER',
      });
      prismaMock.lessonTemplate.findFirst.mockResolvedValue({
        id: 60,
        uuid: 'les-q-1',
        subjectDictionaryId: 77,
        ownerType: 'PLATFORM',
      });
      prismaMock.platformUserSubject.findFirst.mockResolvedValue(null);

      await expect(service.getQuestions('pt-3', 'les-q-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.platformUserSubject.findFirst).toHaveBeenCalledWith({
        where: {
          platformUserId: 15,
          subjectDictionaryId: 77,
          isDeleted: false,
          subjectDictionary: { isDeleted: false, isActive: true },
        },
      });

      prismaMock.platformUserSubject.findFirst.mockClear();
      prismaMock.question.findFirst.mockResolvedValue({
        id: 90,
        uuid: 'q-1',
        template: {
          id: 60,
          subjectDictionaryId: 77,
          ownerType: 'PLATFORM',
          isDeleted: false,
        },
      });
      await expect(service.getQuestion('pt-3', 'q-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.platformUserSubject.findFirst).toHaveBeenCalledWith({
        where: {
          platformUserId: 15,
          subjectDictionaryId: 77,
          isDeleted: false,
          subjectDictionary: { isDeleted: false, isActive: true },
        },
      });

      prismaMock.platformUserSubject.findFirst.mockClear();
      prismaMock.question.findFirst.mockResolvedValue({
        id: 91,
        uuid: 'q-2',
        template: {
          id: 61,
          subjectDictionaryId: null,
          ownerType: 'PLATFORM',
          isDeleted: false,
        },
      });
      await expect(service.getQuestion('pt-3', 'q-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.platformUserSubject.findFirst).not.toHaveBeenCalled();
    });

    it('rejects deactivated SubjectDictionary in PlatformLessonsService & PlatformQuestionsService for PLATFORM_TEACHER', async () => {
      const prismaMock: any = {
        platformUser: {
          findFirst: jest.fn().mockResolvedValue({
            id: 18,
            uuid: 'pt-4',
            role: 'PLATFORM_TEACHER',
          }),
        },
        lessonTemplate: {
          findFirst: jest.fn().mockResolvedValue({
            id: 70,
            uuid: 'les-deact',
            subjectDictionaryId: 99,
            ownerType: 'PLATFORM',
          }),
        },
        question: {
          findFirst: jest.fn().mockResolvedValue({
            id: 95,
            uuid: 'q-deact',
            template: {
              id: 70,
              subjectDictionaryId: 99,
              ownerType: 'PLATFORM',
              isDeleted: false,
            },
          }),
        },
        platformUserSubject: { findFirst: jest.fn().mockResolvedValue(null) },
      };

      const lessonsService = new PlatformLessonsService(prismaMock);
      const questionsService = new PlatformQuestionsService(prismaMock);

      await expect(
        lessonsService.updateLesson('pt-4', 'les-deact', { title: 'Blocked' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        questionsService.getQuestions('pt-4', 'les-deact'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        questionsService.getQuestion('pt-4', 'q-deact'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.platformUserSubject.findFirst).toHaveBeenCalledTimes(3);
      for (const call of prismaMock.platformUserSubject.findFirst.mock.calls) {
        expect(call[0]).toEqual({
          where: {
            platformUserId: 18,
            subjectDictionaryId: 99,
            isDeleted: false,
            subjectDictionary: { isDeleted: false, isActive: true },
          },
        });
      }
    });
  });

  describe('SEC-TCH-03 — PlatformContentService.getPlatformLessonDetail enforces full active assignment chain', () => {
    it('verifies user isActive/isDeleted and enforces full active section/grade/subject chain before querying lesson body', async () => {
      const prismaMock: any = {
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 50, teacher: { userId: 50 } }),
        },
        contentDistribution: {
          findFirst: jest.fn().mockResolvedValue({
            id: 1,
            sourceLessonTemplate: { id: 100, subjectDictionaryId: 888 },
          }),
        },
        subjectSectionTeacher: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        lessonTemplate: {
          findFirst: jest.fn(),
        },
      };

      const service = new PlatformContentService(prismaMock);
      await expect(
        service.getPlatformLessonDetail(10, 'teacher-uuid-1', 'plat-lesson-uuid'),
      ).rejects.toThrow(ForbiddenException);

      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: {
          uuid: 'teacher-uuid-1',
          schoolId: 10,
          isDeleted: false,
          isActive: true,
        },
        include: { teacher: { select: { userId: true } } },
      });

      expect(prismaMock.subjectSectionTeacher.findFirst).toHaveBeenCalledWith({
        where: {
          teacherId: 50,
          isDeleted: false,
          isActive: true,
          subjectSection: {
            isDeleted: false,
            isActive: true,
            section: {
              isDeleted: false,
              isActive: true,
              grade: {
                schoolId: 10,
                isDeleted: false,
                isActive: true,
              },
            },
            subject: {
              schoolId: 10,
              dictionaryId: 888,
              isDeleted: false,
              isActive: true,
              dictionary: {
                isDeleted: false,
                isActive: true,
              },
            },
          },
        },
        include: {
          subjectSection: {
            include: {
              subject: true,
            },
          },
        },
      });
      expect(prismaMock.lessonTemplate.findFirst).not.toHaveBeenCalled();
    });

    it('enforces full active school-isolated assignment chain in getPlatformLessons, forkLesson, and forkForPublish', async () => {
      const prismaMock: any = {
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 52, teacher: { userId: 52 } }),
        },
        subjectSectionTeacher: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        contentDistribution: {
          findFirst: jest.fn().mockResolvedValue({
            id: 4,
            sourceLessonTemplate: {
              id: 200,
              subjectDictionaryId: 999,
              subjectDictionary: { id: 999 },
              unit: null,
            },
            schoolLessonTemplate: null,
          }),
        },
        subject: {
          findFirst: jest.fn().mockResolvedValue({ id: 300, schoolId: 10 }),
        },
      };

      const service = new PlatformContentService(prismaMock);

      await expect(service.getPlatformLessons(10, 'teacher-uuid-3')).resolves.toEqual({
        subjects: [],
      });
      expect(prismaMock.subjectSectionTeacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teacherId: 52,
            isDeleted: false,
            isActive: true,
            subjectSection: {
              isDeleted: false,
              isActive: true,
              section: {
                isDeleted: false,
                isActive: true,
                grade: {
                  schoolId: 10,
                  isDeleted: false,
                  isActive: true,
                },
              },
              subject: {
                schoolId: 10,
                isDeleted: false,
                isActive: true,
                dictionaryId: { not: null },
                dictionary: {
                  isDeleted: false,
                  isActive: true,
                },
              },
            },
          },
        }),
      );

      await expect(
        service.forkLesson(10, 'teacher-uuid-3', 'plat-lesson-4'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.contentDistribution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            schoolId: 10,
            sourceLessonTemplate: {
              uuid: 'plat-lesson-4',
              ownerType: 'PLATFORM',
              isDeleted: false,
            },
          }),
        }),
      );
      expect(prismaMock.subject.findFirst).toHaveBeenCalledWith({
        where: {
          schoolId: 10,
          dictionaryId: 999,
          isDeleted: false,
          isActive: true,
        },
      });

      await expect(
        service.forkForPublish(10, 'teacher-uuid-3', 'plat-lesson-4'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.subjectSectionTeacher.findFirst).toHaveBeenCalledTimes(2);
    });

    it('rejects when sourceLessonTemplate has null subjectDictionaryId and allows assigned teachers', async () => {
      const prismaMock: any = {
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 51, teacher: { userId: 51 } }),
        },
        contentDistribution: {
          findFirst: jest.fn().mockResolvedValueOnce({
            id: 2,
            sourceLessonTemplate: { id: 101, subjectDictionaryId: null },
          }),
        },
        subjectSectionTeacher: {
          findFirst: jest.fn(),
        },
        lessonTemplate: {
          findFirst: jest.fn(),
        },
      };

      const service = new PlatformContentService(prismaMock);
      await expect(
        service.getPlatformLessonDetail(10, 'teacher-uuid-2', 'plat-lesson-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.subjectSectionTeacher.findFirst).not.toHaveBeenCalled();

      prismaMock.contentDistribution.findFirst.mockResolvedValueOnce({
        id: 3,
        sourceLessonTemplate: { id: 102, subjectDictionaryId: 777 },
      });
      prismaMock.subjectSectionTeacher.findFirst.mockResolvedValueOnce({ id: 9 });
      prismaMock.lessonTemplate.findFirst.mockResolvedValueOnce({
        uuid: 'plat-lesson-3',
        title: 'درس الفيزياء',
        templateVersion: 2,
        contentBlocks: [],
        questions: [],
      });

      const res = await service.getPlatformLessonDetail(
        10,
        'teacher-uuid-2',
        'plat-lesson-3',
      );
      expect(res).toMatchObject({
        uuid: 'plat-lesson-3',
        title: 'درس الفيزياء',
        templateVersion: 2,
        isReadOnly: true,
        blocks: [],
        questions: [],
      });
    });
  });

  describe('SEC-PRF-01 — ProfileService.updateMe enforces ownership and all 21 MediaAsset relations', () => {
    function buildEmptyCounts(overrides: Record<string, number> = {}) {
      return {
        schoolsAsLogo: 0,
        blockItemsAsMedia: 0,
        lessonContentsAsMedia: 0,
        lessonTemplatesAsCover: 0,
        matchingPairsAsLeftAudio: 0,
        matchingPairsAsLeftImage: 0,
        matchingPairsAsRightAudio: 0,
        matchingPairsAsRightImage: 0,
        questionOptionsAsAudio: 0,
        questionOptionsAsImage: 0,
        orderingItemsAsAudio: 0,
        orderingItemsAsImage: 0,
        questionsAsExplanationAudio: 0,
        questionsAsExplanationImage: 0,
        questionsAsAudio: 0,
        questionsAsImage: 0,
        booksAsCover: 0,
        booksAsPdf: 0,
        subjectDictsAsCover: 0,
        subjectsAsCover: 0,
        usersAsAvatar: 0,
        ...overrides,
      };
    }

    it('rejects linking another user’s uploaded school image (403 AVATAR_ASSET_NOT_OWNED)', async () => {
      const prismaMock: any = {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 7,
            schoolId: 1,
            avatarMediaAssetId: null,
          }),
          update: jest.fn(),
        },
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue({
            id: 200,
            kind: 'IMAGE',
            processingStatus: ProcessingStatus.DONE,
            uploadSessions: [],
            _count: buildEmptyCounts(),
          }),
        },
      };

      const service = new ProfileService(prismaMock);
      const err = await service
        .updateMe('u-7', { avatarMediaAssetUuid: 'other-img-uuid' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        code: 'AVATAR_ASSET_NOT_OWNED',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it.each([
      'blockItemsAsMedia',
      'matchingPairsAsLeftAudio',
      'questionOptionsAsAudio',
      'questionsAsExplanationAudio',
      'booksAsPdf',
      'usersAsAvatar',
    ])(
      'rejects linking an owned image already referenced via %s (400 AVATAR_ASSET_IN_USE)',
      async (relationKey) => {
        const prismaMock: any = {
          user: {
            findFirst: jest.fn().mockResolvedValue({
              id: 7,
              schoolId: 1,
              avatarMediaAssetId: null,
            }),
            update: jest.fn(),
          },
          mediaAsset: {
            findFirst: jest.fn().mockResolvedValue({
              id: 201,
              kind: 'IMAGE',
              processingStatus: ProcessingStatus.DONE,
              uploadSessions: [{ id: 10 }],
              _count: buildEmptyCounts({ [relationKey]: 1 }),
            }),
          },
        };

        const service = new ProfileService(prismaMock);
        const err = await service
          .updateMe('u-7', { avatarMediaAssetUuid: 'used-img-uuid' })
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getResponse()).toMatchObject({
          code: 'AVATAR_ASSET_IN_USE',
        });
        expect(prismaMock.user.update).not.toHaveBeenCalled();
      },
    );

    it('allows linking the user’s own unlinked COMPLETED image inside transaction and supports idempotent re-submission', async () => {
      const txMock: any = {
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: 7,
              schoolId: 1,
              avatarMediaAssetId: null,
            })
            .mockResolvedValueOnce({
              id: 7,
              schoolId: 1,
              avatarMediaAssetId: 202,
            }),
          update: jest.fn().mockResolvedValue({}),
        },
        mediaAsset: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: 202,
              kind: 'IMAGE',
              processingStatus: ProcessingStatus.DONE,
              uploadSessions: [{ id: 11 }],
              _count: buildEmptyCounts(),
            })
            .mockResolvedValueOnce({
              id: 202,
              kind: 'IMAGE',
              processingStatus: ProcessingStatus.DONE,
              uploadSessions: [],
              _count: buildEmptyCounts(),
            }),
        },
      };
      const prismaMock: any = {
        $transaction: jest.fn((cb: any) => cb(txMock)),
        user: {
          findFirst: jest.fn().mockResolvedValue({
            uuid: 'u-7',
            userType: 'TEACHER',
            code: 2300001,
            name: 'أحمد',
            displayName: 'أحمد',
            gender: 'M',
            phone: null,
            email: null,
            province: null,
            district: null,
            addressArea: null,
            addressDetails: null,
            updatedAt: new Date(),
            avatarMediaAsset: { uuid: 'my-img-uuid' },
          }),
        },
      };

      const service = new ProfileService(prismaMock);
      const first = await service.updateMe('u-7', {
        avatarMediaAssetUuid: 'my-img-uuid',
      });
      expect(first.avatarMediaAssetUuid).toBe('my-img-uuid');
      expect(txMock.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { avatarMediaAssetId: 202 },
      });

      const second = await service.updateMe('u-7', {
        avatarMediaAssetUuid: 'my-img-uuid',
      });
      expect(second.avatarMediaAssetUuid).toBe('my-img-uuid');
    });

    it('SchoolInfoService rejects user avatars (400 AVATAR_ASSET_IN_USE) and non-SCHOOL assets via FOR UPDATE query', async () => {
      const txMock: any = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
        mediaAsset: {
          findFirst: jest.fn().mockResolvedValue({
            id: 301,
            uuid: 'avatar-asset-uuid',
            kind: MediaKind.IMAGE,
            ownerType: 'SCHOOL',
            schoolId: 10,
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
          }),
        },
        user: {
          count: jest.fn().mockResolvedValue(1),
        },
        school: {
          update: jest.fn(),
        },
      };
      const prismaMock: any = {
        $transaction: jest.fn((cb: any) => cb(txMock)),
      };

      const schoolInfo = new SchoolInfoService(prismaMock);
      const err = await schoolInfo
        .updateSchoolInfo(10, { logoMediaAssetUuid: 'avatar-asset-uuid' })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'AVATAR_ASSET_IN_USE' });
      expect(txMock.$queryRaw).toHaveBeenCalled();
      expect(txMock.mediaAsset.findFirst).toHaveBeenCalledWith({
        where: {
          uuid: 'avatar-asset-uuid',
          schoolId: 10,
          ownerType: 'SCHOOL',
          isDeleted: false,
        },
      });
      expect(txMock.user.count).toHaveBeenCalledWith({
        where: { avatarMediaAssetId: 301 },
      });
      expect(txMock.school.update).not.toHaveBeenCalled();
    });
  });

  describe('SEC-AUTH-06 — SessionsService atomic device lock & session creation', () => {
    it('never updates pushToken/lastSeenAt on disabled devices and aborts atomic upsertDeviceAndCreateSession without creating AuthSession', async () => {
      const txMock: any = {
        userDevice: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ id: 9, isActive: false })
            .mockResolvedValueOnce({ id: 10, isActive: true }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          upsert: jest.fn(),
        },
        authSession: {
          create: jest.fn(),
        },
      };
      const prismaMock: any = {
        $transaction: jest.fn((cb: any) => cb(txMock)),
      };

      const sessions = new SessionsService(prismaMock);

      // 1) Pre-disabled device rejects before any write and never creates session
      await expect(
        sessions.upsertDeviceAndCreateSession({
          userId: 5,
          schoolId: 1,
          deviceFingerprint: 'fp-disabled',
          deviceType: 'ANDROID',
          pushToken: 'hijack-tok',
          refreshTokenPlain: 'r-plain-1',
        }),
      ).rejects.toThrow(new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE));
      expect(txMock.userDevice.updateMany).not.toHaveBeenCalled();
      expect(txMock.authSession.create).not.toHaveBeenCalled();

      // 2) Concurrent disable detected by updateMany count=0 -> rejects without session
      await expect(
        sessions.upsertDeviceAndCreateSession({
          userId: 5,
          schoolId: 1,
          deviceFingerprint: 'fp-race',
          deviceType: 'IOS',
          pushToken: 'hijack-tok-2',
          refreshTokenPlain: 'r-plain-2',
        }),
      ).rejects.toThrow(new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE));
      expect(txMock.authSession.create).not.toHaveBeenCalled();
    });
  });

  describe('SEC-MED-04 — Symmetrical locking, COMPLETED cancel block, & file-move recovery', () => {
    it.each([
      MediaKind.IMAGE,
      MediaKind.AUDIO,
      MediaKind.DOCUMENT,
      MediaKind.VIDEO,
    ])(
      'rejects cancelling COMPLETED %s session with ConflictException(SESSION_ALREADY_COMPLETED) without touching asset or disk',
      async (kind) => {
        const prev = process.env.R2_BUCKET_NAME;
        process.env.R2_BUCKET_NAME = 'test-bucket';
        const validation = new UploadValidationHelper(new VideoMediaConfig());
        if (prev === undefined) delete process.env.R2_BUCKET_NAME;
        else process.env.R2_BUCKET_NAME = prev;

        const sessionRow = {
          id: 70,
          uuid: `sess-${kind}`,
          mediaAssetId: 700,
          kind,
          status: MediaUploadStatus.COMPLETED,
          expiresAt: new Date(Date.now() + 3600_000),
          bytesReceived: 100n,
          totalSizeBytes: 100n,
          chunkSizeBytes: 1024,
        };
        const prismaMock: any = {
          mediaUploadSession: { update: jest.fn() },
          mediaAsset: { update: jest.fn() },
        };
        const storageMock: any = { deleteTempFile: jest.fn() };

        await expect(
          validation.executeSerializedCancelSession(
            prismaMock,
            storageMock,
            sessionRow,
          ),
        ).rejects.toThrow(new ConflictException('SESSION_ALREADY_COMPLETED'));

        expect(prismaMock.mediaUploadSession.update).not.toHaveBeenCalled();
        expect(prismaMock.mediaAsset.update).not.toHaveBeenCalled();
        expect(storageMock.deleteTempFile).not.toHaveBeenCalled();
      },
    );

    it('restores moved file back to tmp when DB update fails inside completeSession so retry can succeed', async () => {
      const storageMock = {
        buildStorageKey: jest.fn(
          (sch: string, asset: string, v: string, ext: string) =>
            `${sch}/${asset}/${v}.${ext}`,
        ),
        moveToFinal: jest.fn().mockResolvedValue(undefined),
        restoreFromFinal: jest.fn().mockResolvedValue(undefined),
        reconcileTempFile: jest.fn().mockResolvedValue(undefined),
        getTempPath: jest.fn(),
        deleteTempFile: jest.fn(),
      } as unknown as StorageService;

      const validation = new UploadValidationHelper(new VideoMediaConfig());
      jest
        .spyOn(validation, 'sniffUploadedContentForKind')
        .mockResolvedValue({ ok: true });

      const prismaMock: any = {
        mediaUploadSession: {
          findFirst: jest.fn().mockResolvedValue({
            id: 88,
            uuid: 'sess-rec-1',
            mediaAssetId: 880,
            schoolId: 1,
            ownerType: 'SCHOOL',
            uploaderUserId: 10,
            kind: MediaKind.IMAGE,
            contentType: 'image/png',
            totalSizeBytes: 100n,
            bytesReceived: 100n,
            chunkSizeBytes: 1024,
            status: MediaUploadStatus.UPLOADING,
            processingStatus: ProcessingStatus.PENDING,
            expiresAt: new Date(Date.now() + 3600_000),
            mediaAsset: { id: 880, uuid: 'asset-rec-1' },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        mediaAsset: {
          update: jest.fn().mockRejectedValue(new Error('DB_TRANSIENT_FAIL')),
        },
      };

      const service = new MediaUploadService(
        prismaMock,
        storageMock,
        { processAsset: jest.fn().mockResolvedValue(undefined) } as any,
        {} as any,
        validation,
        {} as any,
      );

      await expect(
        service.completeSession('sess-rec-1', 1, 'sch-uuid-1', 10),
      ).rejects.toThrow('DB_TRANSIENT_FAIL');

      expect((storageMock as any).moveToFinal).toHaveBeenCalledTimes(1);
      expect((storageMock as any).restoreFromFinal).toHaveBeenCalledWith(
        'sess-rec-1',
        'sch-uuid-1/asset-rec-1/original.png',
      );
    });

    it('School & Platform completeSession reject CANCELED, FAILED, or EXPIRED sessions inside withSessionLock', async () => {
      const validation = new UploadValidationHelper(new VideoMediaConfig());
      const makePrisma = (status: MediaUploadStatus, expiresOffsetMs: number) => ({
        mediaUploadSession: {
          findFirst: jest.fn().mockResolvedValue({
            id: 80,
            uuid: 'sess-state-check',
            mediaAssetId: 800,
            schoolId: 1,
            ownerType:
              status === MediaUploadStatus.INITIATED ? 'PLATFORM' : 'SCHOOL',
            uploaderUserId: 10,
            platformUserId: 10,
            kind: MediaKind.IMAGE,
            contentType: 'image/png',
            totalSizeBytes: 100n,
            bytesReceived: 100n,
            chunkSizeBytes: 1024,
            status,
            processingStatus: ProcessingStatus.PENDING,
            expiresAt: new Date(Date.now() + expiresOffsetMs),
            mediaAsset: { id: 800, uuid: 'asset-800' },
          }),
          updateMany: jest.fn(),
        },
      });
      const storageMock: any = {
        moveToFinal: jest.fn(),
        getTempPath: jest.fn(),
      };

      const schoolCanceled = new MediaUploadService(
        makePrisma(MediaUploadStatus.CANCELED, 3600_000) as any,
        storageMock,
        {} as any,
        {} as any,
        validation,
        {} as any,
      );
      await expect(
        schoolCanceled.completeSession('sess-state-check', 1, 'sch-uuid', 10),
      ).rejects.toThrow(new ConflictException('SESSION_CANCELED'));

      const schoolFailed = new MediaUploadService(
        makePrisma(MediaUploadStatus.FAILED, 3600_000) as any,
        storageMock,
        {} as any,
        {} as any,
        validation,
        {} as any,
      );
      await expect(
        schoolFailed.completeSession('sess-state-check', 1, 'sch-uuid', 10),
      ).rejects.toThrow(new ConflictException('SESSION_FAILED'));

      const platformExpired = new PlatformMediaUploadService(
        makePrisma(MediaUploadStatus.INITIATED, -10_000) as any,
        storageMock,
        {} as any,
        {} as any,
        validation,
        {} as any,
        {} as any,
        {} as any,
      );
      await expect(
        platformExpired.completeSession('sess-state-check', {
          platformUserId: 10,
          role: 'PLATFORM_TEACHER',
        }),
      ).rejects.toThrow(new GoneException('SESSION_EXPIRED'));

      expect(storageMock.moveToFinal).not.toHaveBeenCalled();
    });

    it('StorageService.recoverOrphanFinalToTempIfNeeded restores exact-size crash orphans, skips size mismatch, and preserves existing temp files', async () => {
      const tmpRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'qw3a-orphan-rec-'),
      );
      const prevStoragePath = process.env.MEDIA_STORAGE_PATH;
      process.env.MEDIA_STORAGE_PATH = tmpRoot;
      try {
        const realStorage = new StorageService();
        const sessionUuid = 'sess-crash-1';
        const storageKey = realStorage.buildStorageKey(
          'school-uuid-1',
          'asset-crash-1',
          'original',
          'png',
        );
        const finalPath = realStorage.resolvePath(storageKey);
        const tempPath = realStorage.getTempPath(sessionUuid);

        await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
        await fs.promises.writeFile(finalPath, Buffer.alloc(256, 0x11));

        // Wrong size -> does not recover
        await expect(
          realStorage.recoverOrphanFinalToTempIfNeeded(
            sessionUuid,
            storageKey,
            512,
          ),
        ).resolves.toBe(false);
        expect(fs.existsSync(finalPath)).toBe(true);
        expect(fs.existsSync(tempPath)).toBe(false);

        // Exact committed size -> restores orphaned final file back to tmp/{session}.part
        await expect(
          realStorage.recoverOrphanFinalToTempIfNeeded(
            sessionUuid,
            storageKey,
            256,
          ),
        ).resolves.toBe(true);
        expect(fs.existsSync(finalPath)).toBe(false);
        expect(fs.existsSync(tempPath)).toBe(true);

        // Existing temp file -> no-op even if a file exists at finalPath
        await fs.promises.writeFile(finalPath, Buffer.alloc(256, 0x22));
        await expect(
          realStorage.recoverOrphanFinalToTempIfNeeded(
            sessionUuid,
            storageKey,
            256,
          ),
        ).resolves.toBe(false);
        expect((await fs.promises.readFile(tempPath))[0]).toBe(0x11);
      } finally {
        if (prevStoragePath === undefined) delete process.env.MEDIA_STORAGE_PATH;
        else process.env.MEDIA_STORAGE_PATH = prevStoragePath;
        await fs.promises.rm(tmpRoot, { recursive: true, force: true });
      }
    });
  });

  describe('SEC-PUB-01 — POST /public/app/check-update trust proxy loopback, Anti-Spoofing, Trim Validation & No-Write', () => {
    let app: INestApplication;
    const prismaMock: any = {
      app: { findUnique: jest.fn() },
      release: { findFirst: jest.fn() },
      school: { findUnique: jest.fn() },
      schoolReleaseAssignment: { findFirst: jest.fn() },
      deviceInstallation: { upsert: jest.fn().mockResolvedValue({}) },
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'short', ttl: 60_000, limit: 5 },
            { name: 'long', ttl: 3_600_000, limit: 20 },
          ]),
        ],
        controllers: [UpdateCheckController],
        providers: [
          UpdateCheckService,
          {
            provide: PrismaService,
            useValue: prismaMock,
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      // مطابقة إعداد الإنتاج في src/main.ts تماماً
      app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('rejects whitespace-only, oversized, and out-of-range fields with 400 while preserving Flutter payload compatibility', async () => {
      const badPayloads = [
        {
          appCode: '   ',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '   ',
          currentBuild: 1,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: '   ',
        },
        {
          appCode: 'A'.repeat(65),
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          packageName: 'p'.repeat(151),
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: 'v'.repeat(33),
          currentBuild: 1,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'i'.repeat(129),
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'inst-1',
          osVersion: 'o'.repeat(65),
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'inst-1',
          deviceModel: 'm'.repeat(129),
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: -1,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 2_147_483_648,
          installationId: 'inst-1',
        },
        {
          appCode: 'APP_1',
          platform: 'ANDROID',
          currentVersion: '1.0.0',
          currentBuild: 1,
          installationId: 'inst-1',
          schoolCode: 0,
        },
      ];

      for (const body of badPayloads) {
        await request(app.getHttpServer())
          .post('/public/app/check-update')
          .set('X-Forwarded-For', '198.51.100.1')
          .send(body)
          .expect(400);
      }

      // Valid Flutter fallback payload: currentBuild = 0, deviceModel = null
      prismaMock.app.findUnique.mockResolvedValueOnce(null);
      const validRes = await request(app.getHttpServer())
        .post('/public/app/check-update')
        .set('X-Forwarded-For', '198.51.100.2')
        .send({
          appCode: ' MAFHOOM_STUDENT ',
          packageName: '   ',
          platform: 'ANDROID',
          currentVersion: ' 1.0.0 ',
          currentBuild: 0,
          installationId: ' flutter-fp-1 ',
          osVersion: 'Android',
          deviceModel: null,
        })
        .expect(201);

      expect(validRes.body).toEqual({
        updateAvailable: false,
        updatePolicy: 'NONE',
        latestVersion: null,
        latestBuild: null,
        minimumBuild: null,
        releaseNotes: null,
        download: null,
      });
      expect(prismaMock.app.findUnique).toHaveBeenCalledWith({
        where: { code: 'MAFHOOM_STUDENT' },
      });
      expect(prismaMock.deviceInstallation.upsert).not.toHaveBeenCalled();
    });

    it('deduplicates school lookup, blocks X-Forwarded-For spoofing behind loopback Nginx, and rejects non-loopback spoofing', async () => {
      prismaMock.app.findUnique.mockResolvedValue({
        id: 1,
        code: 'MAFHOOM_APP',
        status: 'ACTIVE',
        isDeleted: false,
      });
      prismaMock.school.findUnique.mockResolvedValue({ id: 77 });
      prismaMock.schoolReleaseAssignment.findFirst.mockResolvedValue(null);
      prismaMock.release.findFirst.mockResolvedValue({
        id: 10,
        versionName: '2.0.0',
        versionCode: 20,
        minimumSupportedVersionCode: 10,
        updatePolicy: 'OPTIONAL',
        releaseNotesAr: 'تحديث',
        checksum: 'abc',
        distributions: [
          {
            downloadUrl: 'https://cdn.example.com/app.apk',
            fileSize: BigInt(1024),
          },
        ],
      });

      const attackerRealIp = '198.51.100.77';
      const legitClientIp = '198.51.100.88';
      const payload = {
        appCode: 'MAFHOOM_APP',
        platform: 'ANDROID',
        currentVersion: '1.0.0',
        currentBuild: 10,
        installationId: 'inst-valid',
        schoolCode: 1001,
      };

      // الطلب الأول مع schoolCode يستعلم عن المدرسة مرة واحدة فقط
      await request(app.getHttpServer())
        .post('/public/app/check-update')
        .set('X-Forwarded-For', `1.1.1.0, ${attackerRealIp}`)
        .send(payload)
        .expect(201);
      expect(prismaMock.school.findUnique).toHaveBeenCalledTimes(1);

      // 29 طلباً إضافياً (المجموع 30) مع تدوير IP مزور على يسار X-Forwarded-For
      // مع trust proxy='loopback' يقرأ Express آخر قفزة غير loopback (attackerRealIp)
      for (let i = 1; i < 30; i++) {
        await request(app.getHttpServer())
          .post('/public/app/check-update')
          .set('X-Forwarded-For', `203.0.113.${i}, ${attackerRealIp}`)
          .send(payload)
          .expect(201);
      }

      // الطلب 31 مع IP يساري مزور مختلف يجب أن يُرفض بـ 429 لأنه ما زال من attackerRealIp
      await request(app.getHttpServer())
        .post('/public/app/check-update')
        .set('X-Forwarded-For', `203.0.113.250, ${attackerRealIp}`)
        .send(payload)
        .expect(429);

      // مستخدم شرعي من IP مختلف خلف نفس وكيل Nginx يظل يعمل بنجاح
      await request(app.getHttpServer())
        .post('/public/app/check-update')
        .set('X-Forwarded-For', `198.51.100.9, ${legitClientIp}`)
        .send(payload)
        .expect(201);

      // التحقق المباشر من رفض X-Forwarded-For عند اتصال من IP غير loopback
      const isolatedExpress = express();
      isolatedExpress.set('trust proxy', 'loopback');
      isolatedExpress.use((req, _res, next) => {
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: '203.0.113.99',
          configurable: true,
        });
        next();
      });
      isolatedExpress.get('/ip', (req, res) => {
        res.json({ ip: req.ip });
      });

      const trustFn = isolatedExpress.get('trust proxy fn') as (
        addr: string,
        distance: number,
      ) => boolean;
      expect(trustFn('127.0.0.1', 0)).toBe(true);
      expect(trustFn('::1', 0)).toBe(true);
      expect(trustFn('203.0.113.99', 0)).toBe(false);

      const server = isolatedExpress.listen(0);
      try {
        const addr = server.address() as { port: number };
        const body = await new Promise<{ ip: string }>((resolve, reject) => {
          const req = http.get(
            {
              host: '127.0.0.1',
              port: addr.port,
              path: '/ip',
              headers: { 'X-Forwarded-For': '8.8.8.8' },
            },
            (res) => {
              let raw = '';
              res.on('data', (chunk) => (raw += chunk));
              res.on('end', () => resolve(JSON.parse(raw)));
            },
          );
          req.on('error', reject);
        });
        expect(body.ip).toBe('203.0.113.99');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
