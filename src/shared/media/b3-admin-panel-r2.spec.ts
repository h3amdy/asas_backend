/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// src/shared/media/b3-admin-panel-r2.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 B3 — اختبارات حقل storage_provider في استجابة /meta
//    يتحقق من أن getAssetMeta يُعيد storage_provider من سجل الأصل
// ═══════════════════════════════════════════════════════════════

import { MediaKind, ProcessingStatus } from '@prisma/client';
import { PlatformMediaService } from '../../platform/media/platform-media.service';
import { MediaService as SchoolMediaService } from '../../school/media/media.service';

// ── مساعدات مشتركة ──

function makeFakeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    kind: MediaKind.IMAGE,
    ownerType: 'PLATFORM',
    schoolId: null,
    storageProvider: 'LOCAL',
    contentType: 'image/webp',
    processingStatus: ProcessingStatus.DONE,
    isDeleted: false,
    variantsJson: JSON.stringify({
      original: {
        storage_key: 'media/aaa/original.webp',
        etag: '"abc"',
        size_bytes: 1024,
        sha256: 'sha256hex',
        content_type: 'image/webp',
      },
    }),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makePrismaMock(asset: ReturnType<typeof makeFakeAsset>) {
  return {
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(asset),
      findUnique: jest.fn().mockResolvedValue(asset),
    },
    mediaAssetDistribution: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;
}

// ═══════════════════════════════════════════════════════════════
// 1) PlatformMediaService.getAssetMeta — حقل storage_provider
// ═══════════════════════════════════════════════════════════════

describe('B3 — PlatformMediaService.getAssetMeta يُعيد storage_provider', () => {
  it('يُعيد storage_provider = LOCAL لأصل محلي', async () => {
    const asset = makeFakeAsset({ storageProvider: 'LOCAL' });
    const prisma = makePrismaMock(asset);
    const svc = new PlatformMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(asset.uuid, asset as any);

    expect(meta).toEqual(
      expect.objectContaining({
        asset_uuid: asset.uuid,
        kind: 'IMAGE',
        storage_provider: 'LOCAL',
      }),
    );
  });

  it('يُعيد storage_provider = R2 لأصل مُخزّن في R2', async () => {
    const asset = makeFakeAsset({ storageProvider: 'R2' });
    const prisma = makePrismaMock(asset);
    const svc = new PlatformMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(asset.uuid, asset as any);

    expect(meta).toEqual(
      expect.objectContaining({
        asset_uuid: asset.uuid,
        storage_provider: 'R2',
      }),
    );
  });

  it('يشمل variants و processing_status و updated_at', async () => {
    const asset = makeFakeAsset({ storageProvider: 'R2' });
    const prisma = makePrismaMock(asset);
    const svc = new PlatformMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(asset.uuid, asset as any);

    expect(meta.variants).toBeDefined();
    expect(meta.variants.original).toBeDefined();
    // لا يجب أن يكشف storage_key للعميل
    expect(
      (meta.variants.original as unknown as Record<string, unknown>)
        .storage_key,
    ).toBeUndefined();
    expect(meta.processing_status).toBe('DONE');
    expect(meta.updated_at).toEqual(asset.updatedAt);
  });

  it('يعمل مع أصل فيديو R2 بدون preloadedAsset', async () => {
    const videoAsset = makeFakeAsset({
      kind: MediaKind.VIDEO,
      storageProvider: 'R2',
      contentType: 'video/mp4',
      variantsJson: JSON.stringify({
        variants: {
          '360p': {
            status: 'VERIFIED',
            storage_key: 'media/vid/360p.mp4',
            etag: '"v1"',
            size_bytes: 50000,
            sha256: 'sha',
            width: 640,
            height: 360,
          },
        },
      }),
    });
    const prisma = makePrismaMock(videoAsset);
    const svc = new PlatformMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(videoAsset.uuid);

    expect(meta.storage_provider).toBe('R2');
    expect(meta.kind).toBe('VIDEO');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2) SchoolMediaService.getAssetMeta — حقل storage_provider
// ═══════════════════════════════════════════════════════════════

describe('B3 — SchoolMediaService.getAssetMeta يُعيد storage_provider', () => {
  const SCHOOL_ID = 100;

  function makeSchoolAsset(overrides: Record<string, unknown> = {}) {
    return makeFakeAsset({
      ownerType: 'SCHOOL',
      schoolId: SCHOOL_ID,
      ...overrides,
    });
  }

  it('يُعيد storage_provider = LOCAL لأصل مدرسة محلي', async () => {
    const asset = makeSchoolAsset({ storageProvider: 'LOCAL' });
    const prisma = makePrismaMock(asset);
    const svc = new SchoolMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(asset.uuid, SCHOOL_ID, asset as any);

    expect(meta).toEqual(
      expect.objectContaining({
        asset_uuid: asset.uuid,
        storage_provider: 'LOCAL',
      }),
    );
  });

  it('يُعيد storage_provider = R2 لأصل مدرسة في R2', async () => {
    const asset = makeSchoolAsset({ storageProvider: 'R2' });
    const prisma = makePrismaMock(asset);
    const svc = new SchoolMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(asset.uuid, SCHOOL_ID, asset as any);

    expect(meta).toEqual(
      expect.objectContaining({
        asset_uuid: asset.uuid,
        storage_provider: 'R2',
      }),
    );
  });

  it('يُعيد content_type الصحيح من سجل الأصل', async () => {
    const asset = makeSchoolAsset({
      storageProvider: 'R2',
      kind: MediaKind.AUDIO,
      contentType: 'audio/mpeg',
    });
    const prisma = makePrismaMock(asset);
    const svc = new SchoolMediaService(prisma, {} as any);

    const meta = await svc.getAssetMeta(asset.uuid, SCHOOL_ID, asset as any);

    expect(meta.content_type).toBe('audio/mpeg');
    expect(meta.storage_provider).toBe('R2');
    expect(meta.kind).toBe('AUDIO');
  });
});
