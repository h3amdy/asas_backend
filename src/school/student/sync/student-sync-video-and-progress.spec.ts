/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { StudentSyncService } from './student-sync.service';
import { StudentLessonsService } from '../lessons/student-lessons.service';

describe('P4-5d: Legacy Sync Compatibility (W-049) & Monotonic COMPLETED Protection (Decision 1)', () => {
  const sampleVariantsJson = JSON.stringify({
    schema_version: 1,
    quality_ladder: [360, 720],
    preferred_variant: '720p',
    variants: {
      '360p': {
        storage_key: 'school/1/video/vid-uuid/360p.mp4',
        status: 'VERIFIED',
        etag: 'etag-360',
        height: 360,
        width: 640,
        bitrate_kbps: 500,
        size_bytes: 4_000_000,
        sha256: 'a'.repeat(64),
        content_type: 'video/mp4',
        duration_sec: 95,
        source: 'transcoded',
        verified_at: '2026-11-06T00:00:00.000Z',
      },
      '720p': {
        storage_key: 'school/1/video/vid-uuid/720p.mp4',
        status: 'VERIFIED',
        etag: 'etag-720',
        height: 720,
        width: 1280,
        bitrate_kbps: 1200,
        size_bytes: 9_500_000,
        sha256: 'b'.repeat(64),
        content_type: 'video/mp4',
        duration_sec: 95,
        source: 'transcoded',
        verified_at: '2026-11-06T00:00:00.000Z',
      },
    },
  });

  it('W049-T1: pullLessons excludes VIDEO from mediaAssetUuids and attaches sanitized mediaVariants without breaking legacy fields', async () => {
    const mockPrisma: any = {
      lesson: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            uuid: 'lesson-uuid-1',
            status: 'PUBLISHED',
            isActive: true,
            isDeleted: false,
            updatedAt: new Date('2026-11-06T10:00:00.000Z'),
            subject: {
              uuid: 'sub-uuid-1',
              displayName: 'الفيزياء',
              isDeleted: false,
              isActive: true,
            },
            targets: [{ publishedAt: new Date('2026-11-06T09:00:00.000Z') }],
            template: {
              title: 'قوانين الحركة',
              orderIndex: 1,
              unit: { uuid: 'unit-1', title: 'الوحدة الأولى', orderIndex: 1 },
              coverMediaAsset: { uuid: 'cover-img-uuid' },
              _count: { questions: 2 },
              contentBlocks: [
                {
                  uuid: 'block-1',
                  title: 'مقدمة مرئية',
                  orderIndex: 1,
                  items: [
                    {
                      uuid: 'item-img-1',
                      itemType: 'IMAGE',
                      orderIndex: 1,
                      textContent: null,
                      caption: 'صورة توضيحية',
                      mediaAsset: {
                        uuid: 'img-asset-uuid',
                        kind: 'IMAGE',
                        contentType: 'image/png',
                        durationSec: null,
                        processingStatus: 'READY',
                        variantsJson: null,
                      },
                    },
                    {
                      uuid: 'item-aud-2',
                      itemType: 'AUDIO',
                      orderIndex: 2,
                      textContent: null,
                      caption: 'تسجيل صوتي',
                      mediaAsset: {
                        uuid: 'aud-asset-uuid',
                        kind: 'AUDIO',
                        contentType: 'audio/mp4',
                        durationSec: 30,
                        processingStatus: 'READY',
                        variantsJson: null,
                      },
                    },
                    {
                      uuid: 'item-vid-3',
                      itemType: 'VIDEO',
                      orderIndex: 3,
                      textContent: null,
                      caption: 'شرح الفيديو',
                      mediaAsset: {
                        uuid: 'vid-asset-uuid',
                        kind: 'VIDEO',
                        contentType: 'video/mp4',
                        durationSec: 95,
                        processingStatus: 'READY',
                        variantsJson: sampleVariantsJson,
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]),
      },
    };

    const syncService = new StudentSyncService(mockPrisma);
    const result = await (syncService as any).pullLessons(
      1,
      {
        studentId: 10,
        sectionId: 5,
        gradeId: 2,
        yearId: 1,
        termId: 1,
      },
      null,
      20,
      true,
    );

    expect(result.items).toHaveLength(1);
    const lessonPayload = result.items[0];

    // VIDEO uuid MUST NOT be in mediaAssetUuids (W-049)
    expect(lessonPayload.mediaAssetUuids).toEqual([
      'cover-img-uuid',
      'img-asset-uuid',
      'aud-asset-uuid',
    ]);
    expect(lessonPayload.mediaAssetUuids).not.toContain('vid-asset-uuid');

    const items = lessonPayload.contentBlocks[0].items;
    expect(items[0].mediaVariants).toBeNull();
    expect(items[1].mediaVariants).toBeNull();
    expect(items[2]).toEqual({
      uuid: 'item-vid-3',
      itemType: 'VIDEO',
      orderIndex: 3,
      textContent: null,
      caption: 'شرح الفيديو',
      mediaAssetUuid: 'vid-asset-uuid',
      mediaAssetKind: 'VIDEO',
      contentType: 'video/mp4',
      durationSec: 95,
      mediaVariants: {
        '360p': {
          etag: 'etag-360',
          height: 360,
          width: 640,
          size_bytes: 4_000_000,
          sha256: 'a'.repeat(64),
          content_type: 'video/mp4',
        },
        '720p': {
          etag: 'etag-720',
          height: 720,
          width: 1280,
          size_bytes: 9_500_000,
          sha256: 'b'.repeat(64),
          content_type: 'video/mp4',
        },
      },
    });
    expect(JSON.stringify(items[2])).not.toContain('storage_key');
  });

  it('W049-T2: StudentLessonsService.getLessonDetail attaches sanitized mediaVariants on VIDEO items', async () => {
    const mockPrisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          uuid: 'student-uuid-10',
          schoolId: 1,
          student: { userId: 10 },
        }),
      },
      studentEnrollment: {
        findFirst: jest.fn().mockResolvedValue({
          studentId: 10,
          sectionId: 5,
          gradeId: 2,
          yearId: 1,
          isCurrent: true,
          status: 'ACTIVE',
        }),
      },
      term: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
      lesson: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          uuid: 'lesson-uuid-1',
          status: 'PUBLISHED',
          subject: { displayName: 'الفيزياء' },
          template: {
            title: 'قوانين الحركة',
            orderIndex: 1,
            unit: { title: 'الوحدة الأولى' },
            _count: { questions: 0 },
            contentBlocks: [
              {
                uuid: 'block-1',
                title: 'فقرة 1',
                orderIndex: 1,
                items: [
                  {
                    uuid: 'item-vid-3',
                    itemType: 'VIDEO',
                    orderIndex: 1,
                    textContent: null,
                    caption: 'فيديو التجربة',
                    mediaAsset: {
                      uuid: 'vid-asset-uuid',
                      kind: 'VIDEO',
                      contentType: 'video/mp4',
                      durationSec: 95,
                      processingStatus: 'READY',
                      variantsJson: sampleVariantsJson,
                    },
                  },
                ],
              },
            ],
          },
        }),
      },
      lessonTarget: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ publishedAt: new Date('2026-11-06T09:00:00Z') }),
      },
      studentLessonProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      studentLessonResult: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const lessonsService = new StudentLessonsService(mockPrisma, {} as any);
    const detail = await lessonsService.getLessonDetail(
      1,
      'student-uuid-10',
      'lesson-uuid-1',
    );

    expect(detail.blocks[0].items[0].mediaVariants).toBeDefined();
    expect(Object.keys(detail.blocks[0].items[0].mediaVariants!)).toEqual([
      '360p',
      '720p',
    ]);
    expect(JSON.stringify(detail.blocks[0].items[0])).not.toContain(
      'storage_key',
    );
  });

  it('Decision 1 (Unit): processProgressChange uses atomic ON CONFLICT SQL with monotonic COMPLETED guard', async () => {
    const executedQueries: any[] = [];
    const mockPrisma: any = {
      lesson: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 55, templateId: 10, isDeleted: false }),
      },
      $executeRaw: jest.fn().mockImplementation((sqlObj: any) => {
        executedQueries.push(sqlObj);
        return Promise.resolve(1);
      }),
      studentLessonResult: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    const syncService = new StudentSyncService(mockPrisma);
    await (syncService as any).processProgressChange(10, {
      entityType: 'lesson_progress',
      operation: 'UPSERT',
      clientTimestamp: new Date().toISOString(),
      payload: {
        lessonUuid: 'lesson-55',
        status: 'IN_PROGRESS',
        lastPosition: { blockIndex: 1 },
      },
    });

    expect(executedQueries).toHaveLength(1);
    const sqlText = executedQueries[0].strings.join('?');
    expect(sqlText).toContain(
      'ON CONFLICT ("student_id", "lesson_id") DO UPDATE',
    );
    expect(sqlText).toContain(
      `WHEN "student_lesson_progress"."status" = 'COMPLETED' THEN 'COMPLETED'`,
    );
  });
});
