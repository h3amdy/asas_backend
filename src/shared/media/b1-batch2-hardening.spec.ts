// src/shared/media/b1-batch2-hardening.spec.ts
// MEDIA-R2 B1 الدفعة 2 — Range الآمن، Path Traversal، فحص المحتوى عند الرفع، أنواع إضافية
import { UnprocessableEntityException } from '@nestjs/common';
import { MediaKind } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSingleRange } from './local-file-response.helper';
import {
  isSniffCompatibleWithKind,
  normalizeSniffForKind,
  sniffMediaType,
} from './media-magic-bytes';
import { isPathInside, StorageService } from './storage.service';
import { UploadValidationHelper } from './upload-validation.helper';
import { VideoMediaConfig } from './video-media.config';
import { PrismaService } from '../../prisma/prisma.service';

describe('SEC-MEDIA-05 — parseSingleRange', () => {
  it.each([
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=900-', 1000, { start: 900, end: 999 }],
    ['bytes=0-999999999', 1000, { start: 0, end: 999 }], // يُقلَّص لحجم الملف
    ['bytes=-100', 1000, { start: 900, end: 999 }],
    ['bytes=-5000', 1000, { start: 0, end: 999 }],
  ])('%s على ملف %d بايت', (header, size, expected) => {
    expect(parseSingleRange(header, size)).toEqual(expected);
  });

  it.each([
    ['bytes=1000-', 1000],
    ['bytes=5000-6000', 1000],
    ['bytes=500-100', 1000],
    ['bytes=-0', 1000],
    ['bytes=0-10', 0],
  ])('%s على ملف %d بايت ← 416', (header, size) => {
    expect(parseSingleRange(header, size)).toBe('UNSATISFIABLE');
  });

  it.each([undefined, '', 'items=0-10', 'bytes=0-10,20-30', 'bytes=-'])(
    '%s ← الملف كاملاً',
    (header) => {
      expect(parseSingleRange(header, 1000)).toBeNull();
    },
  );
});

describe('SEC-MEDIA-06 — isPathInside / resolvePath', () => {
  it('يميّز المجلدات المتشابهة في البادئة', () => {
    expect(isPathInside('/srv/storage', '/srv/storage/a/b.png')).toBe(true);
    expect(isPathInside('/srv/storage', '/srv/storage-evil/x')).toBe(false);
    expect(isPathInside('/srv/storage', '/srv/storage/../etc/passwd')).toBe(
      false,
    );
    expect(isPathInside('/srv/storage', '/srv/storage')).toBe(false);
    expect(isPathInside('/srv/storage', '/srv/storage/..foo/x')).toBe(true);
  });

  it('resolvePath يرفض المفاتيح الخارجة عن مجلد التخزين ويقبل الجذر', () => {
    const saved = process.env.MEDIA_STORAGE_PATH;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
    process.env.MEDIA_STORAGE_PATH = root;
    try {
      const storage = new StorageService();
      expect(storage.resolvePath('school/a/original.webp')).toBe(
        path.join(root, 'school/a/original.webp'),
      );
      expect(storage.resolvePath('')).toBe(path.resolve(root));
      expect(() => storage.resolvePath('../../etc/passwd')).toThrow(
        'STORAGE_KEY_OUTSIDE_BASE',
      );
      expect(() => storage.resolvePath('/etc/passwd')).toThrow(
        'STORAGE_KEY_OUTSIDE_BASE',
      );
    } finally {
      if (saved === undefined) delete process.env.MEDIA_STORAGE_PATH;
      else process.env.MEDIA_STORAGE_PATH = saved;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('SEC-MEDIA-04 — أنواع إضافية تعمل اليوم ولا يجب كسرها', () => {
  const s = (t: string) => Buffer.from(t, 'latin1');
  it.each([
    ['HEIC (iPhone)', s('\0\0\0\x18ftypheic\0\0'), 'IMAGE', 'image/heic'],
    ['HEIF mif1', s('\0\0\0\x18ftypmif1\0\0'), 'IMAGE', 'image/heic'],
    ['AVIF', s('\0\0\0\x1cftypavif\0\0'), 'IMAGE', 'image/avif'],
    ['TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00]), 'IMAGE', 'image/tiff'],
    ['FLAC', s('fLaC\0'), 'AUDIO', 'audio/flac'],
    ['AMR', s('#!AMR\n'), 'AUDIO', 'audio/amr'],
  ])('%s', (_n, head, kind, ct) => {
    const sniff = sniffMediaType(head);
    expect(sniff?.contentType).toBe(ct);
    expect(isSniffCompatibleWithKind(sniff, kind)).toBe(true);
  });

  it('تسجيل صوتي داخل WebM يُقبل كصوت ويُخزَّن audio/webm', () => {
    const sniff = sniffMediaType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]));
    expect(isSniffCompatibleWithKind(sniff, 'AUDIO')).toBe(true);
    expect(isSniffCompatibleWithKind(sniff, 'IMAGE')).toBe(false);
    expect(normalizeSniffForKind(sniff!, 'AUDIO')).toEqual({
      contentType: 'audio/webm',
      ext: 'webm',
    });
  });

  it('validateContentType يمنع SVG ويقبل بقية الصور', () => {
    const helper = new UploadValidationHelper({} as VideoMediaConfig);
    expect(() =>
      helper.validateContentType('image/svg+xml', MediaKind.IMAGE),
    ).toThrow();
    expect(() =>
      helper.validateContentType('IMAGE/SVG+XML', MediaKind.IMAGE),
    ).toThrow();
    expect(() =>
      helper.validateContentType('image/png', MediaKind.IMAGE),
    ).not.toThrow();
    expect(() =>
      helper.validateContentType('image/heic', MediaKind.IMAGE),
    ).not.toThrow();
  });
});

describe('SEC-MEDIA-04 — assertUploadedContentMatchesKind', () => {
  let root: string;
  let saved: string | undefined;
  let storage: StorageService;
  const helper = new UploadValidationHelper({} as VideoMediaConfig);

  const prisma = {
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    mediaUploadSession: { update: jest.fn(() => Promise.resolve({})) },
    mediaAsset: { update: jest.fn(() => Promise.resolve({})) },
  };

  beforeAll(() => {
    saved = process.env.MEDIA_STORAGE_PATH;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sniff-upload-'));
    process.env.MEDIA_STORAGE_PATH = root;
    storage = new StorageService();
  });

  afterAll(() => {
    if (saved === undefined) delete process.env.MEDIA_STORAGE_PATH;
    else process.env.MEDIA_STORAGE_PATH = saved;
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => jest.clearAllMocks());

  const session = (uuid: string, kind: MediaKind) => ({
    id: 1,
    uuid,
    mediaAssetId: 2,
    kind,
  });

  it('يمرر ملف PNG حقيقي معلن كصورة دون أي تعديل في القاعدة', async () => {
    fs.writeFileSync(
      storage.getTempPath('ok'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    );
    await helper.assertUploadedContentMatchesKind(
      prisma as unknown as PrismaService,
      storage,
      session('ok', MediaKind.IMAGE),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fs.existsSync(storage.getTempPath('ok'))).toBe(true);
  });

  it('يرفض SVG متنكراً كصورة: 422 + حذف الملف + FAILED/ERROR', async () => {
    fs.writeFileSync(
      storage.getTempPath('svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    await expect(
      helper.assertUploadedContentMatchesKind(
        prisma as unknown as PrismaService,
        storage,
        session('svg', MediaKind.IMAGE),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(fs.existsSync(storage.getTempPath('svg'))).toBe(false);
    expect(prisma.mediaUploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { processingStatus: 'ERROR' },
      }),
    );
  });

  it('يرفض PDF مرفوعاً على أنه صوت', async () => {
    fs.writeFileSync(storage.getTempPath('pdf'), '%PDF-1.7\n...');
    await expect(
      helper.assertUploadedContentMatchesKind(
        prisma as unknown as PrismaService,
        storage,
        session('pdf', MediaKind.AUDIO),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('يرفض إذا كان الملف المؤقت مفقوداً', async () => {
    await expect(
      helper.assertUploadedContentMatchesKind(
        prisma as unknown as PrismaService,
        storage,
        session('missing', MediaKind.DOCUMENT),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
