// src/shared/media/download-url-all-kinds.spec.ts
// MEDIA-R2 Wave A1 — download-url يدعم IMAGE / AUDIO / DOCUMENT بجانب VIDEO
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { MediaAsset } from '@prisma/client';
import {
  buildSanitizedVariantsMap,
  generateMediaDownloadUrlResponse,
  resolveFlatR2Variant,
} from './video-delivery.helper';
import { R2StorageProvider } from './r2-storage.provider';
import { VideoMediaConfig } from './video-media.config';

async function captureHttpError(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpException) return err;
    throw err;
  }
  throw new Error('Expected HttpException');
}

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function verified(
  key: string,
  sha: string,
  size: number,
  contentType: string,
): Record<string, unknown> {
  return {
    storage_key: key,
    sha256: sha,
    size_bytes: size,
    etag: `"etag-${size}"`,
    content_type: contentType,
    status: 'VERIFIED',
  };
}

function makeAsset(over: Partial<MediaAsset>): MediaAsset {
  return {
    id: 1,
    uuid: 'asset-uuid-1',
    kind: 'IMAGE',
    storageProvider: 'R2',
    processingStatus: 'DONE',
    variantsJson: null,
    preferredVariant: null,
    ...over,
  } as unknown as MediaAsset;
}

describe('MEDIA-R2 A1 — download-url لكل الأنواع', () => {
  const getPresignedGetUrl = jest.fn((key: string) =>
    Promise.resolve({
      url: `https://acc.r2.cloudflarestorage.com/bucket/${encodeURIComponent(key)}?X-Amz-Signature=sig`,
      expiresAt: new Date('2026-11-15T12:00:00.000Z'),
    }),
  );
  const r2Storage = { getPresignedGetUrl } as unknown as R2StorageProvider;
  const videoConfig = {
    r2PresignedGetTtlSeconds: 3600,
  } as unknown as VideoMediaConfig;
  const logger = new Logger('test');
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  });

  const call = (asset: MediaAsset, variant?: string) =>
    generateMediaDownloadUrlResponse({
      asset,
      requestedVariant: variant,
      r2Storage,
      videoConfig,
      logger,
      actorLabel: 'tester',
    });

  describe('DOCUMENT (PDF)', () => {
    const pdfAsset = makeAsset({
      kind: 'DOCUMENT',
      variantsJson: JSON.stringify({
        original: verified(
          'platform/media/p1/original.pdf',
          SHA_A,
          5_000_000,
          'application/pdf',
        ),
      }),
    });

    it('يصدر رابطاً موقّعاً لنسخة original افتراضياً دون تسجيل الرابط أو المفتاح', async () => {
      const res = await call(pdfAsset);
      expect(res.url).toContain('r2.cloudflarestorage.com');
      expect(res).toEqual({
        url: res.url,
        expires_at: '2026-11-15T12:00:00.000Z',
        variant: 'original',
        size_bytes: 5_000_000,
        sha256: SHA_A,
        etag: '"etag-5000000"',
        content_type: 'application/pdf',
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const msg = String((logSpy.mock.calls[0] as unknown[])[0]);
      expect(msg).not.toContain('X-Amz-Signature');
      expect(msg).not.toContain('platform/media/p1');
    });

    it('يقبل variant=original صراحة ويرفض أي نسخة أخرى بـ 400', async () => {
      await expect(call(pdfAsset, 'original')).resolves.toMatchObject({
        variant: 'original',
      });
      await expect(call(pdfAsset, 'medium')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('IMAGE', () => {
    const imageAsset = makeAsset({
      kind: 'IMAGE',
      variantsJson: JSON.stringify({
        original: verified(
          's/1/media/i/original.webp',
          SHA_A,
          900,
          'image/webp',
        ),
        medium: verified('s/1/media/i/medium.webp', SHA_B, 400, 'image/webp'),
        small: verified('s/1/media/i/small.webp', SHA_C, 100, 'image/webp'),
      }),
    });

    it('الافتراضي medium، ويقدّم small عند طلبها', async () => {
      await expect(call(imageAsset)).resolves.toMatchObject({
        variant: 'medium',
        sha256: SHA_B,
        content_type: 'image/webp',
      });
      await expect(call(imageAsset, 'small')).resolves.toMatchObject({
        variant: 'small',
        size_bytes: 100,
      });
    });

    it('يرجع إلى original إذا كانت النسخة المطلوبة غير مولّدة (thumb)', async () => {
      await expect(call(imageAsset, 'thumb')).resolves.toMatchObject({
        variant: 'original',
        sha256: SHA_A,
      });
    });

    it('يرفض نسخة غير مسموحة للصور (360p) بـ 400 INVALID_VARIANT', async () => {
      const err = await captureHttpError(call(imageAsset, '360p'));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual(
        expect.objectContaining({
          error: 'INVALID_VARIANT',
          available_variants: ['original', 'medium', 'small'],
        }),
      );
    });

    it('يتجاهل النسخ غير المتحقق منها (بلا status أو sha256)', () => {
      const json = JSON.stringify({
        original: verified('k/original.webp', SHA_A, 900, 'image/webp'),
        medium: { storage_key: 'k/medium.webp', size_bytes: 400 },
        small: { ...verified('k/small.webp', 'bad-sha', 100, 'image/webp') },
      });
      const res = resolveFlatR2Variant('IMAGE', json, 'medium');
      expect(res.variant).toBe('original');
    });
  });

  describe('AUDIO', () => {
    it('الافتراضي low مع fallback إلى original', async () => {
      const audioAsset = makeAsset({
        kind: 'AUDIO',
        variantsJson: JSON.stringify({
          original: verified('k/original.m4a', SHA_A, 1000, 'audio/mp4'),
        }),
      });
      await expect(call(audioAsset)).resolves.toMatchObject({
        variant: 'original',
        content_type: 'audio/mp4',
      });
    });
  });

  describe('حراس مشتركة', () => {
    it('يرفض الأصول المحلية بـ 400 DIRECT_STREAM_ASSET', async () => {
      await expect(
        call(makeAsset({ kind: 'DOCUMENT', storageProvider: 'LOCAL' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('يرفض 409 NOT_READY عند عدم اكتمال المعالجة برسالة لا تذكر الفيديو', async () => {
      const err = await captureHttpError(
        call(
          makeAsset({
            kind: 'IMAGE',
            processingStatus: 'PROCESSING' as MediaAsset['processingStatus'],
          }),
        ),
      );
      expect(err).toBeInstanceOf(ConflictException);
      expect(JSON.stringify(err.getResponse())).not.toContain('الفيديو');
    });

    it('يرفض 409 NOT_READY إذا لم توجد أي نسخة متحقق منها', async () => {
      await expect(
        call(
          makeAsset({
            kind: 'DOCUMENT',
            variantsJson: JSON.stringify({
              original: { storage_key: 'k/original.pdf', size_bytes: 10 },
            }),
          }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('variants_json تالف يُعامل كعدم جاهزية', () => {
      expect(() =>
        resolveFlatR2Variant('IMAGE', '{not-json', 'medium'),
      ).toThrow(ConflictException);
    });
  });

  it('/meta للأنواع المسطحة يمرّر sha256 عند وجوده ولا يسرّب storage_key', () => {
    const map = buildSanitizedVariantsMap(
      'DOCUMENT',
      JSON.stringify({
        original: verified('secret/key.pdf', SHA_A, 10, 'application/pdf'),
      }),
    );
    expect(map.original.sha256).toBe(SHA_A);
    expect(JSON.stringify(map)).not.toContain('secret/key.pdf');
  });
});
