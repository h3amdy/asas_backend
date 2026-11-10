/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// src/shared/media/p4-5-hardening.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 VIDEO P4-5 Hardening Pass — اختبارات إغلاق ملاحظات التدقيق المستقل
//   F-P45-01: PlatformBooksService — منع VIDEO وفرض ملكية PLATFORM ونوع الحقل
//   F-P45-02: الأسئلة والمواد (مدرسة/منصة) — فرض ownerType و schoolId (يشمل الحقول الرقمية)
//   F-P45-03: سياق الطالب لولي الأمر في فحص اشتراك الوسائط
//   F-P45-04: VIDEO غير المرتبط يخضع لفحص الاشتراك
//   F-P45-05: إزالة دوال softDeleteAsset القديمة
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PlatformBooksService } from '../../platform/books/platform-books.service';
import { PlatformMediaService } from '../../platform/media/platform-media.service';
import { PlatformQuestionsService } from '../../platform/questions/platform-questions.service';
import { PlatformSubjectsService } from '../../platform/subjects/platform-subjects.service';
import { SubjectsService } from '../../school/manager/subjects/subjects.service';
import { MediaController } from '../../school/media/media.controller';
import { MediaService } from '../../school/media/media.service';
import { TeacherQuestionsService } from '../../school/teacher/questions/teacher-questions.service';

jest.mock('../../school/common/helpers/lesson-revision.helper', () => ({
  bumpContentRevision: jest.fn().mockResolvedValue(undefined),
  bumpQuestionsRevision: jest.fn().mockResolvedValue(undefined),
  touchRelatedLessons: jest.fn().mockResolvedValue(undefined),
}));

// ── أصول اختبارية مشتركة ──
const SCHOOL_ID = 10;
const OTHER_SCHOOL_ID = 20;

interface FakeAsset {
  id: number;
  uuid: string;
  kind: 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'VIDEO';
  ownerType: 'SCHOOL' | 'PLATFORM';
  schoolId: number | null;
  processingStatus: string;
  isDeleted: boolean;
}

const ASSETS: FakeAsset[] = [
  {
    id: 1,
    uuid: 'own-image',
    kind: 'IMAGE',
    ownerType: 'SCHOOL',
    schoolId: SCHOOL_ID,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 2,
    uuid: 'own-audio',
    kind: 'AUDIO',
    ownerType: 'SCHOOL',
    schoolId: SCHOOL_ID,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 3,
    uuid: 'own-video',
    kind: 'VIDEO',
    ownerType: 'SCHOOL',
    schoolId: SCHOOL_ID,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 4,
    uuid: 'other-school-image',
    kind: 'IMAGE',
    ownerType: 'SCHOOL',
    schoolId: OTHER_SCHOOL_ID,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 5,
    uuid: 'platform-image',
    kind: 'IMAGE',
    ownerType: 'PLATFORM',
    schoolId: null,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 6,
    uuid: 'platform-pdf',
    kind: 'DOCUMENT',
    ownerType: 'PLATFORM',
    schoolId: null,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 7,
    uuid: 'platform-video',
    kind: 'VIDEO',
    ownerType: 'PLATFORM',
    schoolId: null,
    processingStatus: 'DONE',
    isDeleted: false,
  },
  {
    id: 8,
    uuid: 'deleted-platform-image',
    kind: 'IMAGE',
    ownerType: 'PLATFORM',
    schoolId: null,
    processingStatus: 'DONE',
    isDeleted: true,
  },
];

function mediaAssetFindFirstMock() {
  return jest.fn(({ where }: any) => {
    const found = ASSETS.find(
      (a) =>
        (where.uuid === undefined || a.uuid === where.uuid) &&
        (where.id === undefined || a.id === where.id) &&
        (where.isDeleted === undefined || a.isDeleted === where.isDeleted),
    );
    return found ? { ...found } : null;
  });
}

async function expectRejection(
  promise: Promise<unknown>,
  type: new (...args: any[]) => Error,
  payload?: Record<string, unknown> | string,
) {
  try {
    await promise;
    fail(`Expected ${type.name}`);
  } catch (err: any) {
    expect(err).toBeInstanceOf(type);
    if (payload !== undefined) {
      const response = err.getResponse();
      if (typeof payload === 'string') {
        expect(JSON.stringify(response)).toContain(payload);
      } else {
        expect(response).toMatchObject(payload);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// F-P45-01 — PlatformBooksService
// ═══════════════════════════════════════════════════════════════
describe('F-P45-01 — PlatformBooksService.resolveMediaAssetId', () => {
  let prisma: any;
  let service: PlatformBooksService;

  beforeEach(() => {
    prisma = {
      mediaAsset: { findFirst: mediaAssetFindFirstMock() },
      subjectDictionary: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, gradeDictionaryId: 2 }),
      },
      gradeDictionary: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
      schoolBook: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => ({ id: 900, ...data })),
        findFirst: jest.fn().mockResolvedValue({ id: 900, isDeleted: false }),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) => ({ id: 900, ...data })),
      },
    };
    service = new PlatformBooksService(prisma);
  });

  const baseDto = {
    title: 'كتاب العلوم',
    semester: 'FIRST',
    subjectDictionaryId: 1,
    gradeDictionaryId: 2,
  };

  it('BK-1: يرفض VIDEO (حتى لو مملوكاً للمنصة) كغلاف أو PDF بـ 400 VIDEO_NOT_ALLOWED_HERE', async () => {
    await expectRejection(
      service.create({
        ...baseDto,
        coverMediaAssetUuid: 'platform-video',
      } as any),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
    await expectRejection(
      service.create({
        ...baseDto,
        pdfMediaAssetUuid: 'platform-video',
      } as any),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
    expect(prisma.schoolBook.create).not.toHaveBeenCalled();
  });

  it('BK-2: يرفض أصلاً مملوكاً لمدرسة بنفس عقد عدم الوجود القديم (400 MEDIA_ASSET_NOT_FOUND)', async () => {
    await expectRejection(
      service.create({ ...baseDto, coverMediaAssetUuid: 'own-image' } as any),
      BadRequestException,
      'MEDIA_ASSET_NOT_FOUND: own-image',
    );
    await expectRejection(
      service.update(900, { pdfMediaAssetUuid: 'other-school-image' } as any),
      BadRequestException,
      'MEDIA_ASSET_NOT_FOUND: other-school-image',
    );
    expect(prisma.schoolBook.create).not.toHaveBeenCalled();
    expect(prisma.schoolBook.update).not.toHaveBeenCalled();
  });

  it('BK-3: يقبل غلاف IMAGE و PDF DOCUMENT مملوكين للمنصة (السلوك الصحيح محفوظ)', async () => {
    await service.create({
      ...baseDto,
      coverMediaAssetUuid: 'platform-image',
      pdfMediaAssetUuid: 'platform-pdf',
    } as any);
    expect(prisma.schoolBook.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coverMediaAssetId: 5,
          pdfMediaAssetId: 6,
        }),
      }),
    );

    await service.update(900, { coverMediaAssetUuid: null } as any);
    expect(prisma.schoolBook.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { coverMediaAssetId: null } }),
    );
  });

  it('BK-4: يرفض نوعاً غير مناسب للحقل (PDF كغلاف، صورة كملف PDF) بـ 400 MEDIA_KIND_MISMATCH', async () => {
    await expectRejection(
      service.create({
        ...baseDto,
        coverMediaAssetUuid: 'platform-pdf',
      } as any),
      BadRequestException,
      { error: 'MEDIA_KIND_MISMATCH' },
    );
    await expectRejection(
      service.create({
        ...baseDto,
        pdfMediaAssetUuid: 'platform-image',
      } as any),
      BadRequestException,
      { error: 'MEDIA_KIND_MISMATCH' },
    );
  });

  it('BK-5: يرفض الأصل المحذوف منطقياً كعدم وجود', async () => {
    await expectRejection(
      service.create({
        ...baseDto,
        coverMediaAssetUuid: 'deleted-platform-image',
      } as any),
      BadRequestException,
      'MEDIA_ASSET_NOT_FOUND',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// F-P45-02 — Questions & Subjects
// ═══════════════════════════════════════════════════════════════
describe('F-P45-02 — TeacherQuestionsService (سياق المدرسة)', () => {
  let prisma: any;
  let service: any;

  beforeEach(() => {
    prisma = {
      mediaAsset: { findFirst: mediaAssetFindFirstMock() },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 50, teacher: { userId: 50 } }),
      },
      question: {
        findFirst: jest.fn().mockResolvedValue({
          id: 300,
          type: 'MCQ',
          template: { id: 30, subjectId: 3, schoolId: SCHOOL_ID },
        }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 300,
          uuid: 'q-uuid',
          type: 'MCQ',
          options: [],
          matchingPairs: [],
          orderingItems: [],
          fillBlanks: [],
          fillAnswers: [],
        }),
      },
      subjectSectionTeacher: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    prisma.$transaction = jest.fn((cb: any) => cb(prisma));
    service = new TeacherQuestionsService(prisma);
  });

  it('TQ-1: يقبل أصول المدرسة نفسها وأصول المنصة غير الفيديو (Decision 3)', async () => {
    await expect(
      service.resolveAssetUuid(SCHOOL_ID, 'own-image'),
    ).resolves.toBe(1);
    await expect(
      service.resolveAssetUuid(SCHOOL_ID, 'own-audio'),
    ).resolves.toBe(2);
    await expect(
      service.resolveAssetUuid(SCHOOL_ID, 'platform-image'),
    ).resolves.toBe(5);
    await expect(
      service.resolveAssetField(SCHOOL_ID, 1, undefined),
    ).resolves.toBe(1);
  });

  it('TQ-2 (cross-tenant): يرفض أصل مدرسة أخرى بالـ UUID أو بالمعرف الرقمي بـ 404 ASSET_NOT_FOUND', async () => {
    await expectRejection(
      service.resolveAssetUuid(SCHOOL_ID, 'other-school-image'),
      NotFoundException,
      { error: 'ASSET_NOT_FOUND' },
    );
    await expectRejection(
      service.resolveAssetField(SCHOOL_ID, 4, undefined),
      NotFoundException,
      { error: 'ASSET_NOT_FOUND' },
    );
  });

  it('TQ-3: يستمر في رفض VIDEO بـ 400 VIDEO_NOT_ALLOWED_HERE (UUID ورقمي)', async () => {
    await expectRejection(
      service.resolveAssetUuid(SCHOOL_ID, 'own-video'),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
    await expectRejection(
      service.resolveAssetField(SCHOOL_ID, 3, undefined),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
  });

  it('TQ-4: updateQuestion لم يعد يكتب المعرف الرقمي الخام دون تحقق (أصل مدرسة أخرى → 404 ولا تحديث)', async () => {
    await expectRejection(
      service.updateQuestion(SCHOOL_ID, 'teacher-uuid', 'q-uuid', {
        questionImageAssetId: 4,
      }),
      NotFoundException,
    );
    expect(prisma.question.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('TQ-5: updateQuestion يحافظ على دلالات null (إزالة) و undefined (بلا تغيير) ويكتب الأصل الصالح', async () => {
    await service.updateQuestion(SCHOOL_ID, 'teacher-uuid', 'q-uuid', {
      questionImageAssetId: null,
      questionAudioAssetUuid: 'own-audio',
    });
    expect(prisma.question.update).toHaveBeenCalledWith({
      where: { id: 300 },
      data: { questionImageAssetId: null, questionAudioAssetId: 2 },
    });
  });
});

describe('F-P45-02 — PlatformQuestionsService (سياق المنصة)', () => {
  let service: any;

  beforeEach(() => {
    const prisma: any = {
      mediaAsset: { findFirst: mediaAssetFindFirstMock() },
    };
    service = new PlatformQuestionsService(prisma);
  });

  it('PQ-1: يقبل أصول المنصة غير الفيديو فقط', async () => {
    await expect(service.resolveAssetUuid('platform-image')).resolves.toBe(5);
    await expect(service.resolveAssetField(5, undefined)).resolves.toBe(5);
    await expect(
      service.resolveUpdateAssetField(null, undefined),
    ).resolves.toBeNull();
    await expect(
      service.resolveUpdateAssetField(undefined, undefined),
    ).resolves.toBeUndefined();
  });

  it('PQ-2 (wrong-owner): يرفض أي أصل مملوك لمدرسة بـ 404 ASSET_NOT_FOUND (UUID ورقمي)', async () => {
    await expectRejection(
      service.resolveAssetUuid('own-image'),
      NotFoundException,
    );
    await expectRejection(
      service.resolveAssetField(1, undefined),
      NotFoundException,
    );
    await expectRejection(
      service.resolveUpdateAssetField(4, undefined),
      NotFoundException,
    );
  });

  it('PQ-3: يرفض VIDEO المملوك للمنصة بـ 400 VIDEO_NOT_ALLOWED_HERE', async () => {
    await expectRejection(
      service.resolveAssetUuid('platform-video'),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
  });
});

describe('F-P45-02 — SubjectsService (غلاف مادة المدرسة)', () => {
  let prisma: any;
  let service: SubjectsService;

  beforeEach(() => {
    prisma = {
      mediaAsset: { findFirst: mediaAssetFindFirstMock() },
      schoolGrade: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, schoolId: SCHOOL_ID }),
      },
      subject: {
        findFirst: jest
          .fn()
          // createSubject: فحص التكرار → null، ثم getSubjectById → المادة
          .mockImplementation(({ where }: any) =>
            where.displayName
              ? null
              : {
                  id: 77,
                  schoolId: SCHOOL_ID,
                  displayName: 'العلوم',
                  gradeId: 1,
                },
          ),
        create: jest.fn().mockResolvedValue({ id: 77 }),
        update: jest.fn().mockResolvedValue({ id: 77 }),
      },
      section: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SubjectsService(prisma);
  });

  it('SB-1: يقبل غلاف المدرسة نفسها وغلاف المنصة (غلاف القاموس الرسمي)', async () => {
    await service.createSubject(SCHOOL_ID, {
      gradeId: 1,
      displayName: 'العلوم',
      coverMediaAssetUuid: 'own-image',
    } as any);
    expect(prisma.subject.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coverMediaAssetId: 1 }),
      }),
    );
    await service.updateSubject(SCHOOL_ID, 77, {
      coverMediaAssetUuid: 'platform-image',
    } as any);
    expect(prisma.subject.update).toHaveBeenLastCalledWith({
      where: { id: 77 },
      data: { coverMediaAssetId: 5 },
    });
  });

  it('SB-2 (cross-tenant): يرفض غلاف مدرسة أخرى بالعقد القديم 400 COVER_MEDIA_ASSET_NOT_FOUND', async () => {
    await expectRejection(
      service.createSubject(SCHOOL_ID, {
        gradeId: 1,
        displayName: 'العلوم',
        coverMediaAssetUuid: 'other-school-image',
      } as any),
      BadRequestException,
      'COVER_MEDIA_ASSET_NOT_FOUND',
    );
    await expectRejection(
      service.updateSubject(SCHOOL_ID, 77, {
        coverMediaAssetUuid: 'other-school-image',
      } as any),
      BadRequestException,
      'COVER_MEDIA_ASSET_NOT_FOUND',
    );
    expect(prisma.subject.create).not.toHaveBeenCalled();
    expect(prisma.subject.update).not.toHaveBeenCalled();
  });

  it('SB-3: يستمر في رفض VIDEO', async () => {
    await expectRejection(
      service.updateSubject(SCHOOL_ID, 77, {
        coverMediaAssetUuid: 'own-video',
      } as any),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
  });
});

describe('F-P45-02 — PlatformSubjectsService (غلاف القاموس الرسمي)', () => {
  let prisma: any;
  let service: PlatformSubjectsService;

  beforeEach(() => {
    prisma = {
      mediaAsset: { findFirst: mediaAssetFindFirstMock() },
      subjectDictionary: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 1, uuid: 'dict-1', isDeleted: false }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new PlatformSubjectsService(prisma);
  });

  it('PS-1: يقبل صورة المنصة', async () => {
    const res = await service.updateSubjectCover('dict-1', {
      mediaAssetUuid: 'platform-image',
    });
    expect(res.coverMediaAssetId).toBe(5);
  });

  it('PS-2 (wrong-owner): يرفض صورة مدرسة بالعقد القديم 404 ولا يحدّث القاموس', async () => {
    await expectRejection(
      service.updateSubjectCover('dict-1', { mediaAssetUuid: 'own-image' }),
      NotFoundException,
    );
    expect(prisma.subjectDictionary.update).not.toHaveBeenCalled();
  });

  it('PS-3: يستمر في رفض VIDEO', async () => {
    await expectRejection(
      service.updateSubjectCover('dict-1', {
        mediaAssetUuid: 'platform-video',
      }),
      BadRequestException,
      { error: 'VIDEO_NOT_ALLOWED_HERE' },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// F-P45-03 & F-P45-04 — MediaController.checkMediaSubscription
// ═══════════════════════════════════════════════════════════════
describe('F-P45-03 / F-P45-04 — فحص اشتراك الوسائط لولي الأمر وللفيديو غير المرتبط', () => {
  const SCHOOL_UUID = 'school-10-uuid';

  // نموذج بيانات: ولي أمر بابن واحد، وولي أمر بابنين (A مشترك، B غير مشترك) + ابن مرتبط من مدرسة أخرى
  const parents = [
    {
      uuid: 'parent-single',
      schoolId: SCHOOL_ID,
      children: [{ studentId: 701, uuid: 'child-a', schoolId: SCHOOL_ID }],
    },
    {
      uuid: 'parent-multi',
      schoolId: SCHOOL_ID,
      children: [
        { studentId: 701, uuid: 'child-a', schoolId: SCHOOL_ID },
        { studentId: 702, uuid: 'child-b', schoolId: SCHOOL_ID },
        {
          studentId: 703,
          uuid: 'child-other-school',
          schoolId: OTHER_SCHOOL_ID,
        },
      ],
    },
  ];
  const students = [
    { id: 701, uuid: 'child-a', schoolId: SCHOOL_ID },
    { id: 702, uuid: 'child-b', schoolId: SCHOOL_ID },
  ];
  const activeStudentIds = new Set([701]);

  let prisma: any;
  let controller: any;
  let mediaService: MediaService;

  const videoAsset = { id: 501, kind: 'VIDEO' };
  const imageAsset = { id: 502, kind: 'IMAGE' };

  beforeEach(() => {
    prisma = {
      schoolSubscriptionSettings: {
        findUnique: jest.fn().mockResolvedValue({ isActivated: true }),
      },
      // لا مراجع تعليمية (أصول غير مرتبطة)
      lessonContent: { findFirst: jest.fn().mockResolvedValue(null) },
      lessonBlockItem: { findFirst: jest.fn().mockResolvedValue(null) },
      schoolBook: { findFirst: jest.fn().mockResolvedValue(null) },
      question: { findFirst: jest.fn().mockResolvedValue(null) },
      questionOption: { findFirst: jest.fn().mockResolvedValue(null) },
      questionMatchingPair: { findFirst: jest.fn().mockResolvedValue(null) },
      questionOrderingItem: { findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findFirst: jest.fn((args: any) => {
          const { where } = args;
          if (where.userType === 'STUDENT') {
            const s = students.find(
              (x) => x.uuid === where.uuid && x.schoolId === where.schoolId,
            );
            return s ? { id: s.id } : null;
          }
          if (where.userType === 'PARENT') {
            const p = parents.find(
              (x) => x.uuid === where.uuid && x.schoolId === where.schoolId,
            );
            if (!p) return null;
            const filter =
              args.select.parent.select.childLinks.where.student.user;
            const childLinks = p.children
              .filter(
                (c) =>
                  c.schoolId === filter.schoolId &&
                  (filter.uuid === undefined || c.uuid === filter.uuid),
              )
              .map((c) => ({ studentId: c.studentId }));
            return { id: 900, parent: { childLinks } };
          }
          return null;
        }),
      },
      studentAccessPeriod: {
        findFirst: jest.fn(({ where }: any) => {
          // يجب أن يكون الطالب المستهدف واحداً محدداً (لا { in: [...] })
          expect(typeof where.studentUserId).toBe('number');
          return activeStudentIds.has(where.studentUserId) ? { id: 1 } : null;
        }),
      },
    };
    mediaService = new MediaService(prisma, {} as any);
    controller = new MediaController(mediaService, {} as any, prisma);
  });

  function parentReq(parentUuid: string, headers: Record<string, any> = {}) {
    return {
      schoolContext: { id: SCHOOL_ID, uuid: SCHOOL_UUID },
      user: { ut: 'PARENT', sub: parentUuid, sc: SCHOOL_UUID },
      headers,
    };
  }

  const check = (req: any, asset: any = videoAsset) =>
    controller.checkMediaSubscription(
      req,
      SCHOOL_ID,
      asset,
      'SUBSCRIPTION_INACTIVE',
    );

  it('PAR-1: ولي أمر بابن واحد مشترك (بلا رأس) → مسموح', async () => {
    await expect(check(parentReq('parent-single'))).resolves.toBeUndefined();
  });

  it('PAR-2 / PAR-6: ولي أمر بابنين أحدهما مشترك، بلا رأس → 403 STUDENT_CONTEXT_REQUIRED دون منح الوصول من اشتراك أي ابن', async () => {
    await expectRejection(
      check(parentReq('parent-multi')),
      ForbiddenException,
      {
        error: 'STUDENT_CONTEXT_REQUIRED',
      },
    );
    expect(prisma.studentAccessPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('PAR-3: اختيار الابن المشترك عبر x-student-context (الرأس المعتمد) → مسموح', async () => {
    await expect(
      check(parentReq('parent-multi', { 'x-student-context': 'child-a' })),
    ).resolves.toBeUndefined();
    expect(prisma.studentAccessPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentUserId: 701 }),
      }),
    );
  });

  it('PAR-3b: x-student-uuid مدعوم كتوافق خلفي', async () => {
    await expect(
      check(parentReq('parent-multi', { 'x-student-uuid': 'child-a' })),
    ).resolves.toBeUndefined();
  });

  it('PAR-4: اختيار الابن غير المشترك → 403 حتى لو كان أخوه مشتركاً', async () => {
    await expectRejection(
      check(parentReq('parent-multi', { 'x-student-context': 'child-b' })),
      ForbiddenException,
      { error: 'SUBSCRIPTION_INACTIVE' },
    );
    expect(prisma.studentAccessPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentUserId: 702 }),
      }),
    );
  });

  it('PAR-4b (مراجعة الإجابات PAR-033): ولي أمر متعدد الأبناء يعرض وسائط إجابات الابن الذي يراجعه عبر x-student-context دون 403 STUDENT_CONTEXT_REQUIRED', async () => {
    // صورة مرتبطة بسؤال في مراجعة الإجابات (أصل تعليمي)
    prisma.question.findFirst.mockResolvedValueOnce({ id: 1 });
    await expect(
      check(
        parentReq('parent-multi', { 'x-student-context': 'child-a' }),
        imageAsset,
      ),
    ).resolves.toBeUndefined();
    expect(prisma.studentAccessPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: SCHOOL_ID,
          studentUserId: 701,
        }),
      }),
    );
  });

  it('PAR-5: UUID غير مرتبط بولي الأمر → 403 دون الرجوع لفحص جميع الأبناء', async () => {
    await expectRejection(
      check(
        parentReq('parent-multi', { 'x-student-context': 'stranger-uuid' }),
      ),
      ForbiddenException,
      { error: 'SUBSCRIPTION_INACTIVE' },
    );
    // ابن ولي الأمر صاحب الرأس الوحيد (single) لا يستطيع استخدام ابن غير مرتبط به
    await expectRejection(
      check(parentReq('parent-single', { 'x-student-context': 'child-b' })),
      ForbiddenException,
    );
    expect(prisma.studentAccessPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('PAR-7: محاولة استخدام ابن مرتبط لكنه في مدرسة أخرى → 403', async () => {
    await expectRejection(
      check(
        parentReq('parent-multi', {
          'x-student-context': 'child-other-school',
        }),
      ),
      ForbiddenException,
    );
    expect(prisma.studentAccessPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('PAR-8: رأسان متعارضان أو رأس مكرر (مصفوفة) → 403 (قيم ملتبسة)', async () => {
    await expectRejection(
      check(
        parentReq('parent-multi', {
          'x-student-context': 'child-a',
          'x-student-uuid': 'child-b',
        }),
      ),
      ForbiddenException,
    );
    await expectRejection(
      check(
        parentReq('parent-multi', {
          'x-student-context': ['child-a', 'child-b'],
        }),
      ),
      ForbiddenException,
    );
    expect(prisma.studentAccessPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('PAR-9: ولي أمر بلا sub (UUID) → 403 (أُزيل المسار الرقمي الذي كان يستخدم معرف ولي الأمر كمعرف طالب)', async () => {
    await expectRejection(
      check({
        schoolContext: { id: SCHOOL_ID, uuid: SCHOOL_UUID },
        user: { ut: 'PARENT', userId: 701, sc: SCHOOL_UUID },
        headers: {},
      }),
      ForbiddenException,
    );
  });

  it('PAR-10: سلوك الطالب صاحب الحساب المستقل محفوظ (مشترك → مسموح، غير مشترك → 403)', async () => {
    const studentReq = (sub: string) => ({
      schoolContext: { id: SCHOOL_ID, uuid: SCHOOL_UUID },
      user: { ut: 'STUDENT', sub, sc: SCHOOL_UUID },
      headers: {},
    });
    await expect(check(studentReq('child-a'))).resolves.toBeUndefined();
    await expectRejection(check(studentReq('child-b')), ForbiddenException);
  });

  it('PAR-11: المدرسة المجانية (الاشتراكات غير مفعلة) لا تتأثر بقاعدة تعدد الأبناء', async () => {
    prisma.schoolSubscriptionSettings.findUnique.mockResolvedValueOnce({
      isActivated: false,
    });
    await expect(check(parentReq('parent-multi'))).resolves.toBeUndefined();
  });

  it('VID-1 (F-P45-04): فيديو DONE غير مرتبط بأي مرجع يخضع لفحص الاشتراك (طالب غير مشترك → 403)', async () => {
    const studentReq = {
      schoolContext: { id: SCHOOL_ID, uuid: SCHOOL_UUID },
      user: { ut: 'STUDENT', sub: 'child-b', sc: SCHOOL_UUID },
      headers: {},
    };
    await expectRejection(check(studentReq, videoAsset), ForbiddenException, {
      error: 'SUBSCRIPTION_INACTIVE',
    });
  });

  it('VID-2 (F-P45-04): لا توسع للقاعدة — IMAGE غير مرتبط يبقى غير تعليمي ولا يُحجب', async () => {
    const studentReq = {
      schoolContext: { id: SCHOOL_ID, uuid: SCHOOL_UUID },
      user: { ut: 'STUDENT', sub: 'child-b', sc: SCHOOL_UUID },
      headers: {},
    };
    await expect(check(studentReq, imageAsset)).resolves.toBeUndefined();
    expect(prisma.studentAccessPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('VID-3: isEducationalAsset يعيد true لأي VIDEO دون استعلام المراجع، ويحافظ على المسار القديم لغير الفيديو', async () => {
    await expect(mediaService.isEducationalAsset(501, 'VIDEO')).resolves.toBe(
      true,
    );
    expect(prisma.lessonBlockItem.findFirst).not.toHaveBeenCalled();
    await expect(mediaService.isEducationalAsset(502, 'IMAGE')).resolves.toBe(
      false,
    );
    await expect(mediaService.isEducationalAsset(502)).resolves.toBe(false);
    expect(prisma.lessonBlockItem.findFirst).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// F-P45-05 — إزالة دوال الحذف القديمة
// ═══════════════════════════════════════════════════════════════
describe('F-P45-05 — لا توجد مسارات حذف وسائط خارج MediaLifecycleService', () => {
  it('MediaService و PlatformMediaService لم يعودا يعرّفان softDeleteAsset', () => {
    expect((MediaService.prototype as any).softDeleteAsset).toBeUndefined();
    expect(
      (PlatformMediaService.prototype as any).softDeleteAsset,
    ).toBeUndefined();
  });
});
