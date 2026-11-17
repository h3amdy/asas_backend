/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
// src/public/media/b2-public-logo-r2.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 B2 — الشعارات العامة من R2 (302 إلى رابط موقّع مخزّن مؤقتاً)
// ═══════════════════════════════════════════════════════════════

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PublicMediaController } from './public-media.controller';
import { PresignedUrlCache } from './presigned-url-cache';

const UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHA = 'a'.repeat(64);

function variant(name: string, etag = `"${name}-v1"`) {
  return {
    status: 'VERIFIED',
    storage_key: `media/logo/${name}.webp`,
    size_bytes: 2048,
    sha256: SHA,
    etag,
    content_type: 'image/webp',
  };
}

function makeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    uuid: UUID,
    kind: 'IMAGE',
    storageProvider: 'R2',
    contentType: 'image/webp',
    isDeleted: false,
    variantsJson: JSON.stringify({
      original: variant('original'),
      medium: variant('medium'),
      small: variant('small'),
    }),
    ...overrides,
  };
}

function setup(assetOverrides: Record<string, unknown> = {}, isLogo = true) {
  const asset = makeAsset(assetOverrides);
  const prisma = {
    mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
    school: {
      findFirst: jest.fn().mockResolvedValue(isLogo ? { id: 1 } : null),
    },
  } as any;
  const storage = {
    fileExists: jest.fn().mockResolvedValue(false),
    getFileSize: jest.fn(),
    getReadStream: jest.fn(),
  } as any;
  let n = 0;
  const r2 = {
    getPresignedGetUrl: jest.fn().mockImplementation((key: string) => {
      n += 1;
      return Promise.resolve({
        url: `https://acc.r2.cloudflarestorage.com/${key}?X-Amz-Signature=s${n}`,
        expiresAt: new Date(Date.now() + 3600_000),
      });
    }),
  } as any;
  const config = { r2PresignedGetTtlSeconds: 3600 } as any;
  const controller = new PublicMediaController(prisma, storage, config, r2);
  return { controller, prisma, storage, r2, asset };
}

function makeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    redirectedTo: null as string | null,
  };
  res.setHeader = jest.fn((k: string, v: string) => {
    res.headers[k] = v;
  });
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.end = jest.fn();
  res.redirect = jest.fn((code: number, url: string) => {
    res.statusCode = code;
    res.redirectedTo = url;
  });
  return res;
}

describe('B2 — PublicMediaController: شعار على R2', () => {
  it('يعيد 302 إلى رابط موقّع للنسخة medium دون المرور بالتخزين المحلي', async () => {
    const { controller, storage, r2 } = setup();
    const res = makeRes();

    await controller.download(UUID, undefined, undefined, undefined, res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toContain('media/logo/medium.webp');
    expect(r2.getPresignedGetUrl).toHaveBeenCalledWith(
      'media/logo/medium.webp',
      3600,
    );
    expect(res.headers['ETag']).toBe('"medium-v1"');
    expect(res.headers['Cache-Control']).toBe('public, max-age=300');
    expect(storage.fileExists).not.toHaveBeenCalled();
  });

  it('يعيد استخدام الرابط من الكاش للطلبات المتكررة', async () => {
    const { controller, r2 } = setup();
    const a = makeRes();
    const b = makeRes();

    await controller.download(UUID, undefined, undefined, undefined, a);
    await controller.download(UUID, undefined, undefined, undefined, b);

    expect(r2.getPresignedGetUrl).toHaveBeenCalledTimes(1);
    expect(b.redirectedTo).toBe(a.redirectedTo);
  });

  it('تغيير الشعار (etag جديد) يُبطل الكاش تلقائياً', async () => {
    const { controller, prisma, r2 } = setup();
    await controller.download(UUID, undefined, undefined, undefined, makeRes());

    prisma.mediaAsset.findFirst.mockResolvedValue(
      makeAsset({
        variantsJson: JSON.stringify({ medium: variant('medium', '"v2"') }),
      }),
    );
    await controller.download(UUID, undefined, undefined, undefined, makeRes());

    expect(r2.getPresignedGetUrl).toHaveBeenCalledTimes(2);
  });

  it('يعيد 304 عند تطابق If-None-Match دون توليد رابط', async () => {
    const { controller, r2 } = setup();
    const res = makeRes();

    await controller.download(UUID, undefined, undefined, '"medium-v1"', res);

    expect(res.statusCode).toBe(304);
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('يحترم variant=small، ونسخة غير معروفة تعود إلى medium', async () => {
    const { controller, r2 } = setup();

    await controller.download(UUID, 'small', undefined, undefined, makeRes());
    await controller.download(UUID, 'low', undefined, undefined, makeRes());

    expect(r2.getPresignedGetUrl.mock.calls[0][0]).toBe(
      'media/logo/small.webp',
    );
    expect(r2.getPresignedGetUrl.mock.calls[1][0]).toBe(
      'media/logo/medium.webp',
    );
  });

  it('يرجع إلى original إذا لم تتوفر medium', async () => {
    const { controller, r2 } = setup({
      variantsJson: JSON.stringify({ original: variant('original') }),
    });

    await controller.download(UUID, undefined, undefined, undefined, makeRes());

    expect(r2.getPresignedGetUrl.mock.calls[0][0]).toBe(
      'media/logo/original.webp',
    );
  });

  it('لا نسخ متحقق منها ← 404 عام', async () => {
    const { controller } = setup({
      variantsJson: JSON.stringify({
        medium: { ...variant('medium'), status: 'PENDING' },
      }),
    });

    await expect(
      controller.download(UUID, undefined, undefined, undefined, makeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('فشل توليد الرابط ← 503 ولا يُخزَّن في الكاش', async () => {
    const { controller, r2 } = setup();
    r2.getPresignedGetUrl.mockRejectedValueOnce(new Error('boom'));
    jest
      .spyOn((controller as any).logger, 'error')
      .mockImplementation(() => {});

    await expect(
      controller.download(UUID, undefined, undefined, undefined, makeRes()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const res = makeRes();
    await controller.download(UUID, undefined, undefined, undefined, res);
    expect(res.statusCode).toBe(302);
  });

  it('أصل R2 غير مستخدم كشعار ← 404 قبل أي توليد رابط', async () => {
    const { controller, r2 } = setup({}, false);

    await expect(
      controller.download(UUID, undefined, undefined, undefined, makeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('أصل R2 ليس صورة ← 404', async () => {
    const { controller, r2 } = setup({ kind: 'AUDIO' });

    await expect(
      controller.download(UUID, undefined, undefined, undefined, makeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('الأصل المحلي LOCAL يبقى على المسار القديم (لا 302)', async () => {
    const { controller, storage, r2 } = setup({
      storageProvider: 'LOCAL',
      variantsJson: JSON.stringify({
        medium: { storage_key: 'logos/m.webp', etag: '"m"' },
      }),
    });

    await expect(
      controller.download(UUID, undefined, undefined, undefined, makeRes()),
    ).rejects.toThrow('FILE_NOT_FOUND');
    expect(storage.fileExists).toHaveBeenCalledWith('logos/m.webp');
    expect(r2.getPresignedGetUrl).not.toHaveBeenCalled();
  });
});

describe('B2 — PresignedUrlCache', () => {
  const url = (s: string) => ({
    url: `https://x/${s}`,
    expiresAt: new Date(1_000_000 + 3600_000),
  });

  it('ينتهي إعادة الاستخدام بعد نافذة 10 دقائق', () => {
    let now = 1_000_000;
    const cache = new PresignedUrlCache(600_000, 10, () => now);
    cache.set('k', url('a'));

    now += 599_000;
    expect(cache.get('k')?.url).toBe('https://x/a');
    now += 2_000;
    expect(cache.get('k')).toBeNull();
  });

  it('لا يعيد استخدام رابط لأكثر من نصف عمره المتبقي', () => {
    let now = 1_000_000;
    const cache = new PresignedUrlCache(600_000, 10, () => now);
    cache.set('k', { url: 'u', expiresAt: new Date(now + 120_000) });

    now += 59_000;
    expect(cache.get('k')).not.toBeNull();
    now += 2_000;
    expect(cache.get('k')).toBeNull();
  });

  it('لا يخزّن رابطاً منتهياً، ويحذف الأقدم عند الامتلاء', () => {
    const now = 1_000_000;
    const cache = new PresignedUrlCache(600_000, 2, () => now);
    cache.set('dead', { url: 'u', expiresAt: new Date(now - 1) });
    expect(cache.size).toBe(0);

    cache.set('a', url('a'));
    cache.set('b', url('b'));
    cache.set('c', url('c'));
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('c')?.url).toBe('https://x/c');
  });
});
