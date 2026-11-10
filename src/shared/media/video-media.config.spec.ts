/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
// src/shared/media/video-media.config.spec.ts
// 🎬 VIDEO P4-1 — اختبارات وحدة VideoMediaConfig وعزل إعدادات R2
// مرجع: 10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md v1.2 §2.4 و §10.1 (VideoMediaConfigSpec)
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DEFAULT_VIDEO_CHUNK_SIZE_BYTES,
  DEFAULT_VIDEO_MAX_SIZE_BYTES,
  REQUIRED_R2_ENV_VARS,
  VideoMediaConfig,
  VideoMediaConfigError,
  assertSafeR2SandboxEnvironment,
  computeEstimatedVariantBytes,
  computeHardVariantCapBytes,
  computeLiveRequiredFreeBytes,
  computePreStepRequiredFreeBytes,
  getVariantEncodingProfile,
  parseVideoMediaEnv,
  parseFfmpegTuning,
} from './video-media.config';

const VIDEO_ENV_KEYS = [
  'VIDEO_UPLOAD_ENABLED',
  'MEDIA_VIDEO_MAX_SIZE_BYTES',
  'MEDIA_VIDEO_CHUNK_SIZE_BYTES',
  'MEDIA_FFPROBE_BIN',
  ...REQUIRED_R2_ENV_VARS,
];

const FULL_R2 = {
  R2_ACCOUNT_ID: 'acc-123',
  R2_ACCESS_KEY_ID: 'AKIA_TEST_ID',
  R2_SECRET_ACCESS_KEY: 'super-secret-value-xyz',
  R2_BUCKET_NAME: 'asas-media-test',
};

describe('parseVideoMediaEnv (دالة نقية)', () => {
  it('القيم الافتراضية: معطّل، 150,000,000 بايت، 1MiB، ffprobe', () => {
    const p = parseVideoMediaEnv({});
    expect(p.settings).toEqual({
      uploadEnabled: false,
      maxSizeBytes: 150_000_000,
      chunkSizeBytes: 1_048_576,
      ffprobeBin: 'ffprobe',
    });
    expect(DEFAULT_VIDEO_MAX_SIZE_BYTES).toBe(150_000_000);
    expect(DEFAULT_VIDEO_CHUNK_SIZE_BYTES).toBe(1_048_576);
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(p.r2).toBeNull();
  });

  it.each(['false', 'FALSE', '0', 'yes', '1', ' ', 'enabled'])(
    'أي قيمة غير "true" تعني معطّل: %p',
    (raw) => {
      expect(
        parseVideoMediaEnv({ VIDEO_UPLOAD_ENABLED: raw }).settings
          .uploadEnabled,
      ).toBe(false);
    },
  );

  it.each(['true', 'TRUE', ' True '])(
    '"true" (بأي حالة أحرف) تعني مفعّل: %p',
    (raw) => {
      expect(
        parseVideoMediaEnv({ VIDEO_UPLOAD_ENABLED: raw }).settings
          .uploadEnabled,
      ).toBe(true);
    },
  );

  it('معطّل + غياب كل متغيرات R2 → لا أخطاء، و r2=null (عزل كامل)', () => {
    const p = parseVideoMediaEnv({ VIDEO_UPLOAD_ENABLED: 'false' });
    expect(p.errors).toEqual([]);
    expect(p.r2).toBeNull();
    expect(p.missingR2Vars).toEqual([...REQUIRED_R2_ENV_VARS]);
  });

  it('معطّل + متغيرات R2 موجودة → لا تُحمَّل بيانات الاعتماد (r2=null)', () => {
    const p = parseVideoMediaEnv({ VIDEO_UPLOAD_ENABLED: 'false', ...FULL_R2 });
    expect(p.r2).toBeNull();
  });

  it('مفعّل + غياب متغيرات R2 → خطأ يسرد الأسماء الناقصة فقط', () => {
    const p = parseVideoMediaEnv({
      VIDEO_UPLOAD_ENABLED: 'true',
      R2_ACCOUNT_ID: 'acc',
    });
    expect(p.r2).toBeNull();
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('R2_ACCESS_KEY_ID');
    expect(p.errors[0]).toContain('R2_SECRET_ACCESS_KEY');
    expect(p.errors[0]).toContain('R2_BUCKET_NAME');
    expect(p.errors[0]).not.toContain('R2_ACCOUNT_ID');
  });

  it('مفعّل + قيم R2 فارغة/مسافات فقط تُعدّ ناقصة', () => {
    const p = parseVideoMediaEnv({
      VIDEO_UPLOAD_ENABLED: 'true',
      ...FULL_R2,
      R2_BUCKET_NAME: '   ',
    });
    expect(p.missingR2Vars).toEqual(['R2_BUCKET_NAME']);
    expect(p.r2).toBeNull();
  });

  it('مفعّل + كل متغيرات R2 → r2 مكتمل بلا أخطاء', () => {
    const p = parseVideoMediaEnv({ VIDEO_UPLOAD_ENABLED: 'true', ...FULL_R2 });
    expect(p.errors).toEqual([]);
    expect(p.r2).toEqual({
      accountId: 'acc-123',
      accessKeyId: 'AKIA_TEST_ID',
      secretAccessKey: 'super-secret-value-xyz',
      bucketName: 'asas-media-test',
    });
  });

  it('الحد مرن مركزياً: MEDIA_VIDEO_MAX_SIZE_BYTES=300000000 دون تعديل كود', () => {
    const p = parseVideoMediaEnv({ MEDIA_VIDEO_MAX_SIZE_BYTES: '300000000' });
    expect(p.settings.maxSizeBytes).toBe(300_000_000);
  });

  it.each([
    ['abc', 'MEDIA_VIDEO_MAX_SIZE_BYTES'],
    ['-5', 'MEDIA_VIDEO_MAX_SIZE_BYTES'],
    ['1.5', 'MEDIA_VIDEO_MAX_SIZE_BYTES'],
    ['0', 'MEDIA_VIDEO_MAX_SIZE_BYTES'],
    ['99999999999', 'MEDIA_VIDEO_MAX_SIZE_BYTES'],
  ])(
    'معطّل + قيمة غير صالحة %p لـ %s → تحذير + الافتراضي (لا يُسقط الخادم)',
    (raw, key) => {
      const p = parseVideoMediaEnv({ [key]: raw });
      expect(p.errors).toEqual([]);
      expect(p.warnings).toHaveLength(1);
      expect(p.settings.maxSizeBytes).toBe(DEFAULT_VIDEO_MAX_SIZE_BYTES);
    },
  );

  it('مفعّل + قيمة رقمية غير صالحة → خطأ (Fail-Fast)', () => {
    const p = parseVideoMediaEnv({
      VIDEO_UPLOAD_ENABLED: 'true',
      ...FULL_R2,
      MEDIA_VIDEO_MAX_SIZE_BYTES: '150MB',
    });
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]).toContain('MEDIA_VIDEO_MAX_SIZE_BYTES');
  });

  it('حجم الجزء خارج حدود Nginx/DTO [65536..52428800] → مرفوض', () => {
    expect(
      parseVideoMediaEnv({ MEDIA_VIDEO_CHUNK_SIZE_BYTES: '1024' }).warnings,
    ).toHaveLength(1);
    expect(
      parseVideoMediaEnv({ MEDIA_VIDEO_CHUNK_SIZE_BYTES: '60000000' }).warnings,
    ).toHaveLength(1);
    expect(
      parseVideoMediaEnv({ MEDIA_VIDEO_CHUNK_SIZE_BYTES: '2097152' }).settings
        .chunkSizeBytes,
    ).toBe(2_097_152);
  });

  it('حجم الجزء أكبر من الحد الأقصى للملف → مرفوض ويعود لقيمة آمنة', () => {
    const p = parseVideoMediaEnv({
      MEDIA_VIDEO_MAX_SIZE_BYTES: '500000',
      MEDIA_VIDEO_CHUNK_SIZE_BYTES: '1048576',
    });
    expect(
      p.warnings.some((w) => w.includes('MEDIA_VIDEO_CHUNK_SIZE_BYTES')),
    ).toBe(true);
    expect(p.settings.chunkSizeBytes).toBeLessThanOrEqual(
      p.settings.maxSizeBytes,
    );
  });

  it('MEDIA_FFPROBE_BIN قابل للضبط', () => {
    expect(
      parseVideoMediaEnv({ MEDIA_FFPROBE_BIN: '/opt/ffmpeg/bin/ffprobe' })
        .settings.ffprobeBin,
    ).toBe('/opt/ffmpeg/bin/ffprobe');
  });
});

describe('VideoMediaConfig (سلوك الإقلاع)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of VIDEO_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of VIDEO_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  function build(env: Record<string, string>): VideoMediaConfig {
    Object.assign(process.env, env);
    return new VideoMediaConfig();
  }

  function spyFfprobe(result: string | null) {
    return jest
      .spyOn(VideoMediaConfig.prototype as any, 'checkFfprobe')
      .mockResolvedValue(result);
  }

  it('معطّل وبدون أي R2_* → onModuleInit ينجح ولا يفحص ffprobe', async () => {
    const ffprobe = spyFfprobe('should not be called');
    const cfg = build({});
    await expect(cfg.onModuleInit()).resolves.toBeUndefined();
    expect(ffprobe).not.toHaveBeenCalled();
    expect(cfg.isUploadEnabled).toBe(false);
    expect(cfg.maxSizeBytes).toBe(150_000_000);
    expect(cfg.chunkSizeBytes).toBe(1_048_576);
  });

  it('معطّل → assertUploadEnabled يرمي 503 VIDEO_FEATURE_DISABLED', async () => {
    const cfg = build({ VIDEO_UPLOAD_ENABLED: 'false' });
    await cfg.onModuleInit();
    try {
      cfg.assertUploadEnabled();
      fail('expected ServiceUnavailableException');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceUnavailableException);
      expect((e as ServiceUnavailableException).getStatus()).toBe(503);
      expect((e as ServiceUnavailableException).getResponse()).toMatchObject({
        error: 'VIDEO_FEATURE_DISABLED',
      });
    }
  });

  it('معطّل → getR2Credentials يرمي 503 STORAGE_PROVIDER_UNAVAILABLE (لا يُسقط العملية)', async () => {
    const cfg = build({ ...FULL_R2 });
    await cfg.onModuleInit();
    expect(() => cfg.getR2Credentials()).toThrow(ServiceUnavailableException);
  });

  it('مفعّل + R2 ناقص → onModuleInit يرمي VideoMediaConfigError برسالة صريحة', async () => {
    spyFfprobe(null);
    const cfg = build({ VIDEO_UPLOAD_ENABLED: 'true' });
    const err = await cfg.onModuleInit().catch((e) => e);
    expect(err).toBeInstanceOf(VideoMediaConfigError);
    expect(err.message).toContain('VIDEO_UPLOAD_ENABLED=true');
    for (const name of REQUIRED_R2_ENV_VARS) {
      expect(err.message).toContain(name);
    }
  });

  it('مفعّل + R2 مكتمل لكن ffprobe غير متاح → يفشل الإقلاع برسالة ffprobe', async () => {
    spyFfprobe('تعذّر تشغيل ffprobe ("ffprobe -version", code=ENOENT).');
    const cfg = build({ VIDEO_UPLOAD_ENABLED: 'true', ...FULL_R2 });
    const err = await cfg.onModuleInit().catch((e) => e);
    expect(err).toBeInstanceOf(VideoMediaConfigError);
    expect(err.problems).toHaveLength(1);
    expect(err.message).toContain('ffprobe');
  });

  it('مفعّل + R2 مكتمل + ffprobe متاح → ينجح ويتيح بيانات الاعتماد', async () => {
    const ffprobe = spyFfprobe(null);
    const cfg = build({ VIDEO_UPLOAD_ENABLED: 'true', ...FULL_R2 });
    await expect(cfg.onModuleInit()).resolves.toBeUndefined();
    expect(ffprobe).toHaveBeenCalledWith('ffprobe');
    expect(cfg.isUploadEnabled).toBe(true);
    expect(() => cfg.assertUploadEnabled()).not.toThrow();
    expect(cfg.getR2Credentials().bucketName).toBe('asas-media-test');
  });

  it('checkFfprobe الحقيقي مع ملف تنفيذي غير موجود → رسالة ENOENT واضحة', async () => {
    const cfg = build({});
    const msg = await (cfg as any).checkFfprobe(
      '/nonexistent/definitely-not-ffprobe',
    );
    expect(msg).toContain('ENOENT');
    expect(msg).toContain('MEDIA_FFPROBE_BIN');
  });

  it('لا تُسرَّب الأسرار: describe() ورسائل الخطأ والسجلات خالية من قيم المفاتيح', async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);

    // حالة نجاح
    spyFfprobe(null);
    const ok = build({ VIDEO_UPLOAD_ENABLED: 'true', ...FULL_R2 });
    await ok.onModuleInit();
    const described = JSON.stringify(ok.describe());

    // حالة فشل (R2 ناقص جزئياً + قيمة رقمية خاطئة)
    process.env.R2_BUCKET_NAME = '';
    process.env.MEDIA_VIDEO_MAX_SIZE_BYTES = 'bad';
    const bad = new VideoMediaConfig();
    const err = await bad.onModuleInit().catch((e) => e);

    const everything = [described, err.message, ...logs].join('\n');
    expect(everything).not.toContain(FULL_R2.R2_SECRET_ACCESS_KEY);
    expect(everything).not.toContain(FULL_R2.R2_ACCESS_KEY_ID);
    expect(ok.describe()).toMatchObject({
      r2Configured: true,
      uploadEnabled: true,
    });
  });
});

describe('P4-4: معادلات تقدير الحجم وسقف النسخة ومساحة القرص وحارس R2 Sandbox (v1.7)', () => {
  it('يحسب V_est و V_hard_cap و preStepRequiredFreeBytes و liveRequiredFreeBytes بدقة دون احتساب مزدوج', () => {
    // 600s 720p: R_est = 377,775 B/s => V_est = 600 * 377,775 + 16,000,000 = 242,665,000 B
    const est720 = computeEstimatedVariantBytes('720p', 600, false);
    expect(est720).toBe(600 * 377_775 + 16_000_000);

    // V_hard_cap = min(600MB, ceil(1.25 * 242,665,000)) = 303,331,250 B
    const hardCap720 = computeHardVariantCapBytes('720p', 600);
    expect(hardCap720).toBe(Math.ceil(1.25 * est720));

    // Pre-step (currentPartFileBytes = 0): max(2GB, 1GB + 2 * V_hard_cap)
    const preReq = computePreStepRequiredFreeBytes('720p', 600);
    expect(preReq).toBe(
      Math.max(2_000_000_000, 1_000_000_000 + 2 * hardCap720),
    );

    // Live (currentPartFileBytes = 100MB): 1GB + 2 * V_hard_cap - 100MB (بدون احتساب مزدوج)
    const liveReq0 = computeLiveRequiredFreeBytes('720p', 600, 0);
    const liveReq100M = computeLiveRequiredFreeBytes('720p', 600, 100_000_000);
    expect(liveReq0 - liveReq100M).toBe(100_000_000);
    expect(liveReq100M).toBe(1_000_000_000 + 2 * hardCap720 - 100_000_000);
  });

  it('ملف الملف البديل (Fallback CRF 28) يخفض معدل البت لكن يبقي V_hard_cap ثابتاً', () => {
    const std480 = getVariantEncodingProfile('480p', false);
    const fb480 = getVariantEncodingProfile('480p', true);
    expect(std480.crf).toBe(23);
    expect(fb480.crf).toBe(28);
    expect(fb480.maxrateKbps).toBeLessThan(std480.maxrateKbps);
    expect(computeHardVariantCapBytes('480p', 1200)).toBe(
      Math.min(
        600_000_000,
        Math.ceil(1.25 * computeEstimatedVariantBytes('480p', 1200, false)),
      ),
    );
  });

  it('assertSafeR2SandboxEnvironment (Fail-Closed): يرفض وجود أي متغير إنتاجي R2_* في البيئة', () => {
    const validSandboxEnv = {
      R2_SANDBOX_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_SANDBOX_ALLOWED_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_SANDBOX_BUCKET_NAME: 'asas-media-test-sandbox',
      R2_SANDBOX_ENDPOINT:
        'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
      R2_SANDBOX_ACCESS_KEY_ID: 'sandbox-key-id',
      R2_SANDBOX_SECRET_ACCESS_KEY: 'sandbox-secret-key',
    };

    expect(() => assertSafeR2SandboxEnvironment(validSandboxEnv)).not.toThrow();

    // قبول اسم الحاوية الاختبارية المحدد asas-media-poc (P4-7A)
    expect(
      assertSafeR2SandboxEnvironment({
        ...validSandboxEnv,
        R2_SANDBOX_BUCKET_NAME: 'asas-media-poc',
      }).bucketName,
    ).toBe('asas-media-poc');

    // رفض أسماء قريبة غير معتمدة مثل asas-media-poc-prod أو asas-media-poc-other
    expect(() =>
      assertSafeR2SandboxEnvironment({
        ...validSandboxEnv,
        R2_SANDBOX_BUCKET_NAME: 'asas-media-poc-other',
      }),
    ).toThrow(VideoMediaConfigError);

    // وجود متغير إنتاجي واحد مثل R2_BUCKET_NAME أو R2_ACCOUNT_ID في البيئة يجب أن يفشل فوراً
    expect(() =>
      assertSafeR2SandboxEnvironment({
        ...validSandboxEnv,
        R2_BUCKET_NAME: 'asas-media-prod',
      }),
    ).toThrow(VideoMediaConfigError);

    // رفض اسم bucket إنتاجي أو غير مطابق للبادئة الاختبارية
    expect(() =>
      assertSafeR2SandboxEnvironment({
        ...validSandboxEnv,
        R2_SANDBOX_BUCKET_NAME: 'asas-media-prod',
      }),
    ).toThrow(VideoMediaConfigError);

    expect(() =>
      assertSafeR2SandboxEnvironment({
        ...validSandboxEnv,
        R2_SANDBOX_BUCKET_NAME: 'asas-test-prod-mirror',
      }),
    ).toThrow(VideoMediaConfigError);

    // رفض عدم تطابق Account ID أو Endpoint
    expect(() =>
      assertSafeR2SandboxEnvironment({
        ...validSandboxEnv,
        R2_SANDBOX_ALLOWED_ACCOUNT_ID: 'fedcba9876543210fedcba9876543210',
      }),
    ).toThrow(VideoMediaConfigError);
  });

  it('validateWorkerStartup يتحقق من قدرات FFmpeg ومجلد staging المحلي', async () => {
    const prevProvider = process.env.MEDIA_VIDEO_STORAGE_PROVIDER;
    const prevEnabled = process.env.VIDEO_UPLOAD_ENABLED;
    process.env.MEDIA_VIDEO_STORAGE_PROVIDER = 'LOCAL';
    process.env.VIDEO_UPLOAD_ENABLED = 'true';
    try {
      const cfg = new VideoMediaConfig();
      jest.spyOn(cfg as any, 'checkFfprobe').mockResolvedValue(null);
      jest.spyOn(cfg as any, 'checkFfmpegCapabilities').mockResolvedValue([]);

      await expect(cfg.validateWorkerStartup()).resolves.toBeUndefined();
    } finally {
      if (prevProvider === undefined) {
        delete process.env.MEDIA_VIDEO_STORAGE_PROVIDER;
      } else {
        process.env.MEDIA_VIDEO_STORAGE_PROVIDER = prevProvider;
      }
      if (prevEnabled === undefined) {
        delete process.env.VIDEO_UPLOAD_ENABLED;
      } else {
        process.env.VIDEO_UPLOAD_ENABLED = prevEnabled;
      }
    }
  });
});

describe('parseFfmpegTuning (VIDEO PERFORMANCE — chat339)', () => {
  it('القيم الافتراضية تطابق السلوك السابق', () => {
    const problems: string[] = [];
    expect(parseFfmpegTuning({}, problems)).toEqual({
      preset: 'veryfast',
      encoderThreads: 1,
      filterThreads: 1,
      decodeThreads: 0,
      transcodeConcurrency: 1,
    });
    expect(problems).toEqual([]);
  });

  it('يقرأ القيم الصالحة من البيئة', () => {
    const problems: string[] = [];
    expect(
      parseFfmpegTuning(
        {
          VIDEO_FFMPEG_PRESET: 'Fast',
          VIDEO_FFMPEG_THREADS: '2',
          VIDEO_FFMPEG_FILTER_THREADS: '1',
          VIDEO_FFMPEG_DECODE_THREADS: '1',
          VIDEO_TRANSCODE_CONCURRENCY: '1',
        },
        problems,
      ),
    ).toEqual({
      preset: 'fast',
      encoderThreads: 2,
      filterThreads: 1,
      decodeThreads: 1,
      transcodeConcurrency: 1,
    });
    expect(problems).toEqual([]);
  });

  it('يرفض القيم غير الصالحة ويعود للقيم الآمنة مع تسجيل المشكلة', () => {
    const problems: string[] = [];
    const t = parseFfmpegTuning(
      {
        VIDEO_FFMPEG_PRESET: 'ultrafast',
        VIDEO_FFMPEG_THREADS: '0',
        VIDEO_FFMPEG_FILTER_THREADS: '99',
        VIDEO_FFMPEG_DECODE_THREADS: '-1',
        VIDEO_TRANSCODE_CONCURRENCY: '2',
      },
      problems,
    );
    expect(t).toEqual({
      preset: 'veryfast',
      encoderThreads: 1,
      filterThreads: 1,
      decodeThreads: 0,
      transcodeConcurrency: 1,
    });
    expect(problems).toHaveLength(5);
  });

  it('validateWorkerStartup يفشل الإقلاع عند إعداد ضبط غير صالح (Fail-Closed)', async () => {
    const keys = [
      'MEDIA_VIDEO_STORAGE_PROVIDER',
      'VIDEO_UPLOAD_ENABLED',
      'VIDEO_TRANSCODE_CONCURRENCY',
    ];
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) prev[k] = process.env[k];
    process.env.MEDIA_VIDEO_STORAGE_PROVIDER = 'LOCAL';
    process.env.VIDEO_UPLOAD_ENABLED = 'true';
    process.env.VIDEO_TRANSCODE_CONCURRENCY = '2';
    try {
      const cfg = new VideoMediaConfig();
      jest.spyOn(cfg as any, 'checkFfprobe').mockResolvedValue(null);
      jest.spyOn(cfg as any, 'checkFfmpegCapabilities').mockResolvedValue([]);
      await expect(cfg.validateWorkerStartup()).rejects.toThrow(
        VideoMediaConfigError,
      );
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
});
