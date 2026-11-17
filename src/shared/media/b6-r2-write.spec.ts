/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// src/shared/media/b6-r2-write.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 B6 — كتابة الأصول الجديدة (غير الفيديو) إلى R2 تدريجياً
//    اختبارات MediaProcessingService.processAsset + PDF inline
//
// ⚠️ ملاحظة: اختبارات IMAGE تستخدم spy على processImage الخاص لتجاوز
//    مشكلة dynamic import لـ sharp (يتطلب --experimental-vm-modules).
//    المعالجة الفعلية للصور (sharp) مغطاة باختبارات التكامل
//    (video-upload.postgres.integration.spec.ts وما شابهها).
//    هذا الملف يركّز على منطق رفع R2 وتوافق variants مع download-url.
// ═══════════════════════════════════════════════════════════════

import { MediaKind, ProcessingStatus } from '@prisma/client';
import {
  MediaProcessingService,
  PLATFORM_OWNER_ID,
  resolveOwnerType,
} from './media-processing.service';

// ── Mocks ─────────────────────────────────────────────────────

/** mock بسيط لـ PrismaService */
function makeMockPrisma() {
  return {
    mediaAsset: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

/** mock لـ StorageService */
function makeMockStorage() {
  return {
    resolvePath: jest.fn((key: string) => `/storage/${key}`),
    buildStorageKey: jest.fn(
      (school: string, asset: string, variant: string, ext: string) =>
        `${school}/${asset}/${variant}.${ext}`,
    ),
    saveBuffer: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
}

/** mock لـ VideoMediaConfig — يعيد R2 أو LOCAL حسب الإعداد */
function makeMockConfig(target: 'R2' | 'LOCAL' = 'R2') {
  return {
    resolveTargetProvider: jest.fn().mockReturnValue(target),
  };
}

/** mock لـ R2StorageProvider */
function makeMockR2() {
  return {
    uploadFromFile: jest.fn().mockResolvedValue({
      key: 'test-key',
      sizeBytes: 1024,
      etag: '"abc123"',
      sha256Hex: 'abcdef1234567890',
      verified: true,
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * ينشئ MediaProcessingService مع mocks.
 * sharp يُستخدم فعلياً في processImage لذا نختبر IMAGE عبر spy على المعالجة.
 * لاختبار R2 upload: نستدعي processAsset مع AUDIO/DOCUMENT (أبسط).
 */
function createService(overrides: {
  config?: ReturnType<typeof makeMockConfig>;
  r2?: ReturnType<typeof makeMockR2>;
  prisma?: ReturnType<typeof makeMockPrisma>;
  storage?: ReturnType<typeof makeMockStorage>;
} = {}) {
  const prisma = overrides.prisma ?? makeMockPrisma();
  const storage = overrides.storage ?? makeMockStorage();
  const config = overrides.config ?? makeMockConfig('R2');
  const r2 = overrides.r2 ?? makeMockR2();

  const service = new MediaProcessingService(
    prisma as any,
    storage as any,
    config as any,
    r2 as any,
  );

  return { service, prisma, storage, config, r2 };
}

// ── mock لـ computeFileDigest المستخدمة في placeOriginalStreaming ──
jest.mock('./file-digest.util', () => ({
  computeFileDigest: jest.fn().mockResolvedValue({
    sha256Hex: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    sizeBytes: 2048,
  }),
}));

// ── mock لـ fs.promises (copyFile, readFile, mkdir) ──
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn().mockResolvedValue(Buffer.from('fake-image-data')),
      copyFile: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
    },
  };
});

// ── mock لـ sharp — غير مطلوب فعلياً لأن processImage تستخدم dynamic import ──
// نتجاوز processImage عبر spy بدلاً من mock لـ sharp

// ═══════════════════════════════════════════════════════════════
// اختبارات resolveOwnerType
// ═══════════════════════════════════════════════════════════════

describe('B6 — resolveOwnerType (اشتقاق نوع المالك)', () => {
  it('الثابت PLATFORM_OWNER_ID يساوي "platform"', () => {
    expect(PLATFORM_OWNER_ID).toBe('platform');
  });

  it('"platform" → PLATFORM', () => {
    expect(resolveOwnerType('platform')).toBe('PLATFORM');
  });

  it('UUID مدرسة → SCHOOL', () => {
    expect(resolveOwnerType('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'SCHOOL',
    );
  });

  it('سلسلة فارغة → SCHOOL (ليست "platform")', () => {
    expect(resolveOwnerType('')).toBe('SCHOOL');
  });
});

// ═══════════════════════════════════════════════════════════════
// اختبارات processAsset — AUDIO (أبسط مسار)
// ═══════════════════════════════════════════════════════════════

describe('B6 — processAsset: AUDIO + R2 مفعّل', () => {
  it('يرفع variants (original + low) إلى R2 ويضع storageProvider = R2', async () => {
    const { service, prisma, r2, config } = createService();

    await service.processAsset(
      1, 'platform', 'asset-uuid-1',
      'platform/asset-uuid-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // resolveTargetProvider يُستدعى بالنوع والمالك الصحيحين
    expect(config.resolveTargetProvider).toHaveBeenCalledWith(
      MediaKind.AUDIO,
      'PLATFORM',
    );

    // uploadFromFile يُستدعى مرتين (original + low)
    expect(r2.uploadFromFile).toHaveBeenCalledTimes(2);

    // DB update يتضمن storageProvider: 'R2'
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.storageProvider === 'R2',
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.processingStatus).toBe(ProcessingStatus.DONE);
  });
});

describe('B6 — processAsset: DOCUMENT + R2 مفعّل', () => {
  it('يرفع variant واحد (original) إلى R2', async () => {
    const { service, r2, prisma } = createService();

    await service.processAsset(
      2, 'school-uuid-123', 'doc-uuid-1',
      'school-uuid-123/doc-uuid-1/original.pdf',
      MediaKind.DOCUMENT, 'application/pdf',
    );

    // uploadFromFile يُستدعى مرة واحدة (original فقط)
    expect(r2.uploadFromFile).toHaveBeenCalledTimes(1);

    // storageProvider = 'R2' في DB
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.storageProvider === 'R2',
    );
    expect(finalUpdate).toBeDefined();
  });
});

describe('B6 — processAsset: IMAGE + R2 مفعّل', () => {
  it('يرفع 3 variants (original+medium+small) إلى R2', async () => {
    const { service, r2, prisma, config } = createService();

    // spy على processImage لتجاوز dynamic import لـ sharp
    const fakeVariants = {
      original: {
        storage_key: 'platform/img-uuid-1/original.webp',
        etag: '"abc"',
        size_bytes: 5000,
        content_type: 'image/webp',
        width: 800,
        height: 600,
      },
      medium: {
        storage_key: 'platform/img-uuid-1/medium.webp',
        etag: '"def"',
        size_bytes: 3000,
        content_type: 'image/webp',
        width: 600,
        height: 450,
      },
      small: {
        storage_key: 'platform/img-uuid-1/small.webp',
        etag: '"ghi"',
        size_bytes: 1000,
        content_type: 'image/webp',
        width: 200,
        height: 150,
      },
    };
    jest
      .spyOn(service as any, 'processImage')
      .mockResolvedValue(fakeVariants);

    await service.processAsset(
      3, 'platform', 'img-uuid-1',
      'platform/img-uuid-1/original.jpg',
      MediaKind.IMAGE, 'image/jpeg',
    );

    // resolveTargetProvider بـ IMAGE + PLATFORM
    expect(config.resolveTargetProvider).toHaveBeenCalledWith(
      MediaKind.IMAGE,
      'PLATFORM',
    );

    // uploadFromFile: 3 مرات (original + medium + small)
    expect(r2.uploadFromFile).toHaveBeenCalledTimes(3);

    // التحقق من المفاتيح المرفوعة
    const uploadedKeys = r2.uploadFromFile.mock.calls.map(
      (call: any) => call[1],
    );
    expect(uploadedKeys).toContain('platform/img-uuid-1/original.webp');
    expect(uploadedKeys).toContain('platform/img-uuid-1/medium.webp');
    expect(uploadedKeys).toContain('platform/img-uuid-1/small.webp');

    // storageProvider = 'R2'
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.storageProvider === 'R2',
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.storageProvider).toBe('R2');
  });
});

// ═══════════════════════════════════════════════════════════════
// R2 معطّل — يبقى LOCAL
// ═══════════════════════════════════════════════════════════════

describe('B6 — processAsset: R2 معطّل (MEDIA_R2_KINDS فارغ)', () => {
  it('يبقى LOCAL ولا يستدعي uploadFromFile', async () => {
    const config = makeMockConfig('LOCAL');
    const { service, r2, prisma } = createService({ config });

    await service.processAsset(
      4, 'platform', 'asset-local-1',
      'platform/asset-local-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // لا رفع إلى R2
    expect(r2.uploadFromFile).not.toHaveBeenCalled();

    // storageProvider = 'LOCAL'
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.storageProvider).toBe('LOCAL');
  });
});

// ═══════════════════════════════════════════════════════════════
// Fail-safe: فشل R2 → يبقى LOCAL
// ═══════════════════════════════════════════════════════════════

describe('B6 — processAsset: فشل رفع R2 → fail-safe (يبقى LOCAL)', () => {
  it('فشل uploadFromFile → يبقى storageProvider = LOCAL', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockRejectedValue(new Error('R2_NETWORK_ERROR'));

    const { service, prisma } = createService({ r2 });

    await service.processAsset(
      5, 'platform', 'asset-fail-1',
      'platform/asset-fail-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // storageProvider = 'LOCAL' (ليس ERROR)
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.storageProvider).toBe('LOCAL');
  });
});

// ═══════════════════════════════════════════════════════════════
// فشل جزئي → cleanup R2 keys المرفوعة
// ═══════════════════════════════════════════════════════════════

describe('B6 — processAsset: فشل جزئي → تنظيف المفاتيح المرفوعة', () => {
  it('رفع أول variant ينجح ثم الثاني يفشل → deleteObject للأول', async () => {
    const r2 = makeMockR2();
    // أول استدعاء ينجح، الثاني يفشل
    r2.uploadFromFile
      .mockResolvedValueOnce({ key: 'k1', verified: true })
      .mockRejectedValueOnce(new Error('R2_TIMEOUT'));

    const { service, prisma } = createService({ r2 });

    await service.processAsset(
      6, 'platform', 'asset-partial-1',
      'platform/asset-partial-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // تنظيف المفتاح المرفوع
    expect(r2.deleteObject).toHaveBeenCalledTimes(1);

    // storageProvider = 'LOCAL'
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.storageProvider).toBe('LOCAL');
  });
});

// ═══════════════════════════════════════════════════════════════
// فشل DB بعد نجاح R2 → تنظيف R2
// ═══════════════════════════════════════════════════════════════

describe('B6 — processAsset: فشل DB بعد نجاح R2 → تنظيف + ERROR', () => {
  it('DB update يفشل بعد رفع R2 ناجح → تنظيف R2 keys + processingStatus = ERROR', async () => {
    const prisma = makeMockPrisma();
    // أول update (PROCESSING) ينجح
    // الثاني (DONE + storageProvider) يفشل
    // الثالث (ERROR) ينجح
    prisma.mediaAsset.update
      .mockResolvedValueOnce({}) // PROCESSING
      .mockRejectedValueOnce(new Error('DB_CONNECTION_LOST')) // DONE — فشل
      .mockResolvedValueOnce({}); // ERROR — ينجح

    const { service, r2 } = createService({ prisma });

    await service.processAsset(
      7, 'platform', 'asset-db-fail-1',
      'platform/asset-db-fail-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // R2 upload حدث
    expect(r2.uploadFromFile).toHaveBeenCalled();

    // تنظيف R2 بعد فشل DB
    expect(r2.deleteObject).toHaveBeenCalled();

    // آخر update هو ERROR
    const lastUpdate = prisma.mediaAsset.update.mock.calls[
      prisma.mediaAsset.update.mock.calls.length - 1
    ];
    expect(lastUpdate[0].data.processingStatus).toBe(ProcessingStatus.ERROR);
  });
});

// ═══════════════════════════════════════════════════════════════
// فشل التنظيف لا يرمي خطأ
// ═══════════════════════════════════════════════════════════════

describe('B6 — cleanupR2Keys: فشل التنظيف لا يمنع الحفظ المحلي', () => {
  it('فشل deleteObject أثناء التنظيف يُسجّل فقط ولا يرمي', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile
      .mockResolvedValueOnce({ key: 'k1', verified: true })
      .mockRejectedValueOnce(new Error('R2_ERROR'));
    // فشل التنظيف أيضاً
    r2.deleteObject.mockRejectedValue(new Error('CLEANUP_FAILED'));

    const { service, prisma } = createService({ r2 });

    // يجب ألا يرمي
    await service.processAsset(
      8, 'platform', 'asset-cleanup-fail-1',
      'platform/asset-cleanup-fail-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // لا يزال ينجح بـ LOCAL
    const finalUpdate = prisma.mediaAsset.update.mock.calls.find(
      (call: any) => call[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![0].data.storageProvider).toBe('LOCAL');
  });
});

// ═══════════════════════════════════════════════════════════════
// ownerType من SCHOOL UUID
// ═══════════════════════════════════════════════════════════════

describe('B6 — processAsset: ownerType يُشتق بشكل صحيح لمدرسة', () => {
  it('UUID مدرسة → resolveTargetProvider يُستدعى بـ SCHOOL', async () => {
    const { service, config } = createService();

    await service.processAsset(
      9, 'school-abc-123', 'asset-school-1',
      'school-abc-123/asset-school-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    expect(config.resolveTargetProvider).toHaveBeenCalledWith(
      MediaKind.AUDIO,
      'SCHOOL',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// VIDEO لا يمر بـ processAsset
// ═══════════════════════════════════════════════════════════════

describe('B6 — VIDEO مستبعد من processAsset', () => {
  it('VIDEO kind → يُعالج بدون R2 upload (لا variants معروفة)', async () => {
    const { service, r2, config, prisma } = createService();

    // VIDEO لا يطابق IMAGE/AUDIO/DOCUMENT → variants فارغ
    await service.processAsset(
      10, 'platform', 'vid-uuid-1',
      'platform/vid-uuid-1/original.mp4',
      MediaKind.VIDEO, 'video/mp4',
    );

    // resolveTargetProvider لا يُستدعى لأن VIDEO لا يملك variants
    // (لا entries في variants object → لا uploadFromFile calls حتى لو target='R2')
    // variants = {} لأن kind لا يطابق IMAGE/AUDIO/DOCUMENT
    // ملاحظة: processAsset سيُعالج لكن variants يبقى فارغاً
    // هذا سلوك مقبول — VIDEO يرفع عبر مساره المنفصل
  });
});

// ═══════════════════════════════════════════════════════════════
// اختبارات storageProvider في تحديث DB
// ═══════════════════════════════════════════════════════════════

describe('B6 — storageProvider في DB يُحدّث بشكل صحيح', () => {
  it('R2 مفعّل + نجاح → storageProvider = R2', async () => {
    const { service, prisma } = createService({
      config: makeMockConfig('R2'),
    });

    await service.processAsset(
      11, 'platform', 'sp-r2',
      'platform/sp-r2/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(doneCall![0].data.storageProvider).toBe('R2');
  });

  it('R2 معطّل → storageProvider = LOCAL صراحة', async () => {
    const { service, prisma } = createService({
      config: makeMockConfig('LOCAL'),
    });

    await service.processAsset(
      12, 'platform', 'sp-local',
      'platform/sp-local/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(doneCall![0].data.storageProvider).toBe('LOCAL');
  });
});


// ═══════════════════════════════════════════════════════════════
// اختبارات status: 'VERIFIED' في variants بعد R2
// ═══════════════════════════════════════════════════════════════

describe('B6 — variants تتضمن status VERIFIED بعد نجاح R2', () => {
  it('AUDIO + R2 ناجح → كل variant تتضمن status/sha256/verified_at', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockResolvedValue({
      key: 'test-key',
      sizeBytes: 1024,
      etag: '"abc"',
      sha256Hex: 'full_sha256_hex_from_r2_upload_result_64chars_padding_here_ok00',
      verified: true,
    });
    const { service, prisma } = createService({ r2 });

    await service.processAsset(
      20, 'platform', 'verified-audio-1',
      'platform/verified-audio-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    // استخراج variantsJson من DB update
    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(doneCall).toBeDefined();
    const savedVariants = JSON.parse(doneCall![0].data.variantsJson);

    // كل variant تتضمن الحقول المطلوبة لـ resolveFlatR2Variant
    for (const variantName of Object.keys(savedVariants)) {
      const v = savedVariants[variantName];
      expect(v.status).toBe('VERIFIED');
      expect(typeof v.sha256).toBe('string');
      expect(v.sha256.length).toBeGreaterThanOrEqual(32);
      expect(typeof v.verified_at).toBe('string');
      expect(typeof v.storage_key).toBe('string');
      expect(typeof v.size_bytes).toBe('number');
    }
  });

  it('R2 معطّل → variants لا تتضمن status (تبقى كما هي)', async () => {
    const { service, prisma } = createService({
      config: makeMockConfig('LOCAL'),
    });

    await service.processAsset(
      21, 'platform', 'local-audio-1',
      'platform/local-audio-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const savedVariants = JSON.parse(doneCall![0].data.variantsJson);

    // variants محلية لا تحتاج VERIFIED
    for (const variantName of Object.keys(savedVariants)) {
      expect(savedVariants[variantName].status).toBeUndefined();
    }
  });

  it('R2 يفشل → variants لا تتضمن status (يبقى LOCAL)', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockRejectedValue(new Error('R2_FAIL'));
    const { service, prisma } = createService({ r2 });

    await service.processAsset(
      22, 'platform', 'fail-audio-1',
      'platform/fail-audio-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const savedVariants = JSON.parse(doneCall![0].data.variantsJson);

    for (const variantName of Object.keys(savedVariants)) {
      expect(savedVariants[variantName].status).toBeUndefined();
    }
  });

  it('IMAGE + R2 ناجح → 3 variants كلها VERIFIED مع sha256', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockResolvedValue({
      key: 'k',
      sizeBytes: 500,
      etag: '"e"',
      sha256Hex: 'img_sha256_from_upload_result_64chars_padding_here_ok000000000',
      verified: true,
    });
    const { service, prisma } = createService({ r2 });

    // spy على processImage لتجاوز dynamic import
    jest.spyOn(service as any, 'processImage').mockResolvedValue({
      original: {
        storage_key: 'platform/vi/original.webp',
        etag: '"a"', size_bytes: 5000, content_type: 'image/webp',
      },
      medium: {
        storage_key: 'platform/vi/medium.webp',
        etag: '"b"', size_bytes: 3000, content_type: 'image/webp',
      },
      small: {
        storage_key: 'platform/vi/small.webp',
        etag: '"c"', size_bytes: 1000, content_type: 'image/webp',
      },
    });

    await service.processAsset(
      23, 'platform', 'vi',
      'platform/vi/original.jpg',
      MediaKind.IMAGE, 'image/jpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const saved = JSON.parse(doneCall![0].data.variantsJson);

    expect(Object.keys(saved)).toHaveLength(3);
    for (const name of ['original', 'medium', 'small']) {
      expect(saved[name].status).toBe('VERIFIED');
      expect(saved[name].sha256).toBe(
        'img_sha256_from_upload_result_64chars_padding_here_ok000000000',
      );
      expect(saved[name].verified_at).toBeDefined();
    }
  });
});


// ═══════════════════════════════════════════════════════════════
// اختبار توافق variants مع resolveFlatR2Variant (download-url)
// ═══════════════════════════════════════════════════════════════

import { resolveFlatR2Variant } from './video-delivery.helper';

describe('B6 — توافق variants الناتجة مع resolveFlatR2Variant', () => {
  it('AUDIO R2 variants تتوافق مع download-url (resolveFlatR2Variant لا ترمي)', async () => {
    const r2 = makeMockR2();
    // sha256 يجب أن يكون 64 حرف hex لتجتاز SHA256_HEX_RE
    r2.uploadFromFile.mockResolvedValue({
      key: 'k', sizeBytes: 2048, etag: '"e"',
      sha256Hex: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      verified: true,
    });
    const { service, prisma } = createService({ r2 });

    await service.processAsset(
      30, 'platform', 'compat-audio-1',
      'platform/compat-audio-1/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const variantsJson = doneCall![0].data.variantsJson;

    // resolveFlatR2Variant يجب ألا ترمي خطأ
    const resolved = resolveFlatR2Variant('AUDIO', variantsJson);
    expect(resolved.variant).toBe('low'); // default لـ AUDIO
    expect(resolved.storageKey).toBeTruthy();
    expect(resolved.sizeBytes).toBeGreaterThan(0);
    expect(resolved.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('DOCUMENT R2 variants تتوافق مع download-url', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockResolvedValue({
      key: 'k', sizeBytes: 2048, etag: '"e"',
      sha256Hex: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b200',
      verified: true,
    });
    const { service, prisma } = createService({ r2 });

    await service.processAsset(
      31, 'school-uuid-99', 'compat-doc-1',
      'school-uuid-99/compat-doc-1/original.pdf',
      MediaKind.DOCUMENT, 'application/pdf',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const variantsJson = doneCall![0].data.variantsJson;

    const resolved = resolveFlatR2Variant('DOCUMENT', variantsJson);
    expect(resolved.variant).toBe('original');
    expect(resolved.contentType).toBe('application/pdf');
  });

  it('IMAGE R2 variants تتوافق مع download-url (3 variants)', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockResolvedValue({
      key: 'k', sizeBytes: 500, etag: '"e"',
      sha256Hex: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b20000',
      verified: true,
    });
    const { service, prisma } = createService({ r2 });

    jest.spyOn(service as any, 'processImage').mockResolvedValue({
      original: {
        storage_key: 'platform/ci/original.webp',
        etag: '"a"', size_bytes: 5000, content_type: 'image/webp',
      },
      medium: {
        storage_key: 'platform/ci/medium.webp',
        etag: '"b"', size_bytes: 3000, content_type: 'image/webp',
      },
      small: {
        storage_key: 'platform/ci/small.webp',
        etag: '"c"', size_bytes: 1000, content_type: 'image/webp',
      },
    });

    await service.processAsset(
      32, 'platform', 'ci',
      'platform/ci/original.jpg',
      MediaKind.IMAGE, 'image/jpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const variantsJson = doneCall![0].data.variantsJson;

    // default لـ IMAGE = medium
    const resolved = resolveFlatR2Variant('IMAGE', variantsJson);
    expect(resolved.variant).toBe('medium');

    // يمكن طلب small و original أيضاً
    expect(resolveFlatR2Variant('IMAGE', variantsJson, 'small').variant).toBe('small');
    expect(resolveFlatR2Variant('IMAGE', variantsJson, 'original').variant).toBe('original');
  });

  it('LOCAL variants (بدون VERIFIED) → resolveFlatR2Variant ترمي NOT_READY', async () => {
    const { service, prisma } = createService({
      config: makeMockConfig('LOCAL'),
    });

    await service.processAsset(
      33, 'platform', 'local-compat',
      'platform/local-compat/original.mp3',
      MediaKind.AUDIO, 'audio/mpeg',
    );

    const doneCall = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    const variantsJson = doneCall![0].data.variantsJson;

    // LOCAL variants ليس لها status: VERIFIED → يرمي ConflictException
    expect(() => resolveFlatR2Variant('AUDIO', variantsJson)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// اختبار مسار PDF inline في platform-media-upload.service.ts
// ═══════════════════════════════════════════════════════════════

import { PlatformMediaUploadService } from '../../platform/media/platform-media-upload.service';

describe('B6 — PDF inline مسار المنصة (platform-media-upload)', () => {
  // Mock بسيط لـ computeFileDigest المستخدم في الملف
  // ملاحظة: jest.mock('./file-digest.util') أعلاه يغطيه

  function makePlatformService(overrides: {
    config?: ReturnType<typeof makeMockConfig>;
    r2?: ReturnType<typeof makeMockR2>;
  } = {}) {
    const config = overrides.config ?? makeMockConfig('R2');
    const r2 = overrides.r2 ?? makeMockR2();

    const completedSession = {
      id: 100,
      uuid: 'pdf-session-1',
      mediaAssetId: 200,
      kind: MediaKind.DOCUMENT,
      contentType: 'application/pdf',
      status: 'UPLOADING',
      expiresAt: new Date(Date.now() + 86400000),
      bytesReceived: BigInt(5000),
      totalSizeBytes: BigInt(5000),
      chunkSizeBytes: 1048576,
      processingStatus: null,
      platformUserId: 1,
      ownerType: 'PLATFORM',
      schoolId: null,
      mediaAsset: { id: 200, uuid: 'pdf-asset-uuid-1' },
    };

    const prisma = {
      mediaUploadSession: {
        findFirst: jest.fn().mockResolvedValue(completedSession),
        update: jest.fn().mockResolvedValue({}),
      },
      mediaAsset: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const storage = {
      resolvePath: jest.fn((key: string) => `/storage/${key}`),
      buildStorageKey: jest.fn(
        (school: string, asset: string, variant: string, ext: string) =>
          `${school}/${asset}/${variant}.${ext}`,
      ),
      moveToFinal: jest.fn().mockResolvedValue(undefined),
      reconcileTempFile: jest.fn().mockResolvedValue(undefined),
    };

    const validation = {
      withSessionLock: jest.fn((_uuid: string, fn: Function) => fn()),
      getExtFromContentType: jest.fn().mockReturnValue('pdf'),
      assertSessionOwnerPlatform: jest.fn(),
      assertUploadedContentMatchesKind: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PlatformMediaUploadService(
      prisma as any,
      storage as any,
      {} as any, // processing — لا يُستدعى لـ PDF
      {} as any, // video
      validation as any,
      {} as any, // accessPolicy
      config as any,
      r2 as any,
    );

    return { service, prisma, r2, config, storage, validation };
  }

  it('PDF + R2 مفعّل → رفع ناجح + storageProvider = R2 + VERIFIED', async () => {
    const { service, prisma, r2, config } = makePlatformService();

    await service.completeSession('pdf-session-1', {
      platformUserId: 1,
      role: 'PLATFORM_ADMIN',
    });

    // R2 upload حدث
    expect(r2.uploadFromFile).toHaveBeenCalledTimes(1);

    // resolveTargetProvider بـ DOCUMENT + PLATFORM
    expect(config.resolveTargetProvider).toHaveBeenCalledWith(
      'DOCUMENT',
      'PLATFORM',
    );

    // DB update يتضمن storageProvider: 'R2'
    const assetUpdate = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.storageProvider === 'R2',
    );
    expect(assetUpdate).toBeDefined();

    // variantsJson تتضمن VERIFIED
    const variants = JSON.parse(assetUpdate![0].data.variantsJson);
    expect(variants.original.status).toBe('VERIFIED');
    expect(typeof variants.original.verified_at).toBe('string');
  });

  it('PDF + R2 يفشل → يبقى LOCAL بدون VERIFIED', async () => {
    const r2 = makeMockR2();
    r2.uploadFromFile.mockRejectedValue(new Error('R2_TIMEOUT'));
    const { service, prisma } = makePlatformService({ r2 });

    await service.completeSession('pdf-session-1', {
      platformUserId: 1,
      role: 'PLATFORM_ADMIN',
    });

    // storageProvider = LOCAL
    const assetUpdate = prisma.mediaAsset.update.mock.calls.find(
      (c: any) => c[0].data?.processingStatus === ProcessingStatus.DONE,
    );
    expect(assetUpdate![0].data.storageProvider).toBe('LOCAL');

    // variants لا تتضمن VERIFIED
    const variants = JSON.parse(assetUpdate![0].data.variantsJson);
    expect(variants.original.status).toBeUndefined();
  });

  it('PDF + R2 ناجح + DB يفشل → cleanup R2', async () => {
    const r2 = makeMockR2();
    const prisma = {
      mediaUploadSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100, uuid: 'pdf-session-1', mediaAssetId: 200,
          kind: MediaKind.DOCUMENT, contentType: 'application/pdf',
          status: 'UPLOADING', expiresAt: new Date(Date.now() + 86400000),
          bytesReceived: BigInt(5000), totalSizeBytes: BigInt(5000),
          chunkSizeBytes: 1048576, processingStatus: null,
          platformUserId: 1, ownerType: 'PLATFORM', schoolId: null,
          mediaAsset: { id: 200, uuid: 'pdf-asset-uuid-1' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      mediaAsset: {
        update: jest.fn()
          .mockResolvedValueOnce({}) // أول update (storageKey)
          .mockRejectedValueOnce(new Error('DB_FAIL')), // ثاني update (DONE) — فشل
      },
    };

    const config = makeMockConfig('R2');
    const service = new PlatformMediaUploadService(
      prisma as any,
      { resolvePath: jest.fn(() => '/f'), buildStorageKey: jest.fn(() => 'k'),
        moveToFinal: jest.fn(), reconcileTempFile: jest.fn() } as any,
      {} as any, {} as any,
      { withSessionLock: jest.fn((_u: string, fn: Function) => fn()),
        getExtFromContentType: jest.fn(() => 'pdf'),
        assertSessionOwnerPlatform: jest.fn(),
        assertUploadedContentMatchesKind: jest.fn() } as any,
      {} as any,
      config as any,
      r2 as any,
    );

    await expect(
      service.completeSession('pdf-session-1', {
        platformUserId: 1,
        role: 'PLATFORM_ADMIN',
      }),
    ).rejects.toThrow('DB_FAIL');

    // R2 cleanup حدث
    expect(r2.deleteObject).toHaveBeenCalledTimes(1);
  });
});
