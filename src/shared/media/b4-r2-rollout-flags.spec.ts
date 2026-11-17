/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// src/shared/media/b4-r2-rollout-flags.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 B4 — أعلام التفعيل التدريجي لـ R2 (MEDIA_R2_KINDS / MEDIA_R2_OWNERS)
//    و resolveTargetProvider(kind, ownerType)
// ═══════════════════════════════════════════════════════════════

import {
  parseMediaR2Rollout,
  parseVideoMediaEnv,
  REQUIRED_R2_ENV_VARS,
  VideoMediaConfig,
  VideoMediaConfigError,
} from './video-media.config';

const FULL_R2 = {
  R2_ACCOUNT_ID: 'acc-123',
  R2_ACCESS_KEY_ID: 'AKIA_TEST_ID',
  R2_SECRET_ACCESS_KEY: 'super-secret-value-xyz',
  R2_BUCKET_NAME: 'asas-media-test',
};

const ENV_KEYS = [
  'VIDEO_UPLOAD_ENABLED',
  'MEDIA_R2_KINDS',
  'MEDIA_R2_OWNERS',
  ...REQUIRED_R2_ENV_VARS,
];

describe('B4 — parseMediaR2Rollout (دالة نقية)', () => {
  it('الافتراضي: لا أنواع، والمالكون PLATFORM و SCHOOL', () => {
    const r = parseMediaR2Rollout({});
    expect(r.kinds).toEqual([]);
    expect(r.owners).toEqual(['PLATFORM', 'SCHOOL']);
    expect(r.problems).toEqual([]);
  });

  it('يقرأ قائمة مفصولة بفواصل بغض النظر عن حالة الأحرف والمسافات ويحذف المكرر', () => {
    const r = parseMediaR2Rollout({ MEDIA_R2_KINDS: ' image, Audio ,IMAGE,,' });
    expect(r.kinds).toEqual(['IMAGE', 'AUDIO']);
    expect(r.problems).toEqual([]);
  });

  it('يتجاهل VIDEO مع ملاحظة (يحكمه VIDEO_UPLOAD_ENABLED)', () => {
    const r = parseMediaR2Rollout({ MEDIA_R2_KINDS: 'VIDEO,DOCUMENT' });
    expect(r.kinds).toEqual(['DOCUMENT']);
    expect(r.notes.length).toBe(1);
    expect(r.problems).toEqual([]);
  });

  it('يسجّل مشكلة لأي نوع أو مالك غير معروف', () => {
    const r = parseMediaR2Rollout({
      MEDIA_R2_KINDS: 'IMAGE,PDF',
      MEDIA_R2_OWNERS: 'SCHOOL,TEACHER',
    });
    expect(r.kinds).toEqual(['IMAGE']);
    expect(r.owners).toEqual(['SCHOOL']);
    expect(r.problems).toHaveLength(2);
    expect(r.problems.join(' ')).toContain('PDF');
    expect(r.problems.join(' ')).toContain('TEACHER');
  });

  it('MEDIA_R2_OWNERS فارغ يعود للافتراضي', () => {
    expect(parseMediaR2Rollout({ MEDIA_R2_OWNERS: ' , ' }).owners).toEqual([
      'PLATFORM',
      'SCHOOL',
    ]);
  });
});

describe('B4 — parseVideoMediaEnv: متى يكون R2 مطلوباً', () => {
  it('الفيديو معطّل و MEDIA_R2_KINDS فارغ ← R2 غير مطلوب ولا تُحمّل بياناته', () => {
    const p = parseVideoMediaEnv({ ...FULL_R2 });
    expect(p.r2Required).toBe(false);
    expect(p.r2).toBeNull();
    expect(p.errors).toEqual([]);
  });

  it('الفيديو معطّل و MEDIA_R2_KINDS غير فارغ ← R2 مطلوب وتُحمّل بياناته', () => {
    const p = parseVideoMediaEnv({ ...FULL_R2, MEDIA_R2_KINDS: 'IMAGE' });
    expect(p.r2Required).toBe(true);
    expect(p.r2?.bucketName).toBe('asas-media-test');
    expect(p.errors).toEqual([]);
  });

  it('MEDIA_R2_KINDS غير فارغ مع نقص متغيرات R2 ← خطأ', () => {
    const p = parseVideoMediaEnv({ MEDIA_R2_KINDS: 'AUDIO' });
    expect(p.r2Required).toBe(true);
    expect(p.r2).toBeNull();
    expect(p.errors.join(' ')).toContain('R2_ACCOUNT_ID');
  });

  it('قيمة غير معروفة: خطأ عندما يكون R2 مطلوباً، وتحذير عندما لا يكون', () => {
    const required = parseVideoMediaEnv({
      ...FULL_R2,
      MEDIA_R2_KINDS: 'IMAGE,BOGUS',
    });
    expect(required.errors.join(' ')).toContain('BOGUS');

    const notRequired = parseVideoMediaEnv({ MEDIA_R2_OWNERS: 'BOGUS' });
    expect(notRequired.errors).toEqual([]);
    expect(notRequired.warnings.join(' ')).toContain('BOGUS');
  });

  it('لا يُكسر سلوك الفيديو: مفعّل + R2 كامل ← r2Required بلا أنواع إضافية', () => {
    const p = parseVideoMediaEnv({ ...FULL_R2, VIDEO_UPLOAD_ENABLED: 'true' });
    expect(p.r2Required).toBe(true);
    expect(p.rollout.kinds).toEqual([]);
    expect(p.errors).toEqual([]);
  });
});

describe('B4 — VideoMediaConfig.resolveTargetProvider و الإقلاع', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  function build(env: Record<string, string>): VideoMediaConfig {
    Object.assign(process.env, env);
    return new VideoMediaConfig();
  }

  it('الافتراضي: كل غير الفيديو ← LOCAL، والفيديو ← R2', () => {
    const cfg = build({ ...FULL_R2 });
    for (const kind of ['IMAGE', 'AUDIO', 'DOCUMENT']) {
      expect(cfg.resolveTargetProvider(kind, 'PLATFORM')).toBe('LOCAL');
      expect(cfg.resolveTargetProvider(kind, 'SCHOOL')).toBe('LOCAL');
    }
    expect(cfg.resolveTargetProvider('VIDEO', 'SCHOOL')).toBe('R2');
    expect(cfg.mediaR2Kinds.size).toBe(0);
  });

  it('IMAGE مفعّل للمنصة فقط ← صور المنصة R2، وصور المدارس والصوت LOCAL', () => {
    const cfg = build({
      ...FULL_R2,
      MEDIA_R2_KINDS: 'IMAGE',
      MEDIA_R2_OWNERS: 'PLATFORM',
    });
    expect(cfg.resolveTargetProvider('IMAGE', 'PLATFORM')).toBe('R2');
    expect(cfg.resolveTargetProvider('image', 'platform')).toBe('R2');
    expect(cfg.resolveTargetProvider('IMAGE', 'SCHOOL')).toBe('LOCAL');
    expect(cfg.resolveTargetProvider('AUDIO', 'PLATFORM')).toBe('LOCAL');
    expect([...cfg.mediaR2Owners]).toEqual(['PLATFORM']);
  });

  it('fail-safe: نوع مفعّل لكن بيانات R2 ناقصة ← LOCAL (ولا يُرمى من الدالة)', () => {
    const cfg = build({ MEDIA_R2_KINDS: 'IMAGE,AUDIO' });
    expect(cfg.resolveTargetProvider('IMAGE', 'PLATFORM')).toBe('LOCAL');
  });

  it('onModuleInit: الفيديو معطّل + أنواع مفعّلة + R2 ناقص ← يفشل الإقلاع', async () => {
    const cfg = build({ MEDIA_R2_KINDS: 'IMAGE' });
    jest.spyOn((cfg as any).logger, 'error').mockImplementation(() => {});
    await expect(cfg.onModuleInit()).rejects.toBeInstanceOf(
      VideoMediaConfigError,
    );
  });

  it('onModuleInit: الفيديو معطّل + أنواع مفعّلة + R2 كامل ← يقلع دون فحص ffprobe', async () => {
    const cfg = build({ ...FULL_R2, MEDIA_R2_KINDS: 'DOCUMENT' });
    const ffprobeSpy = jest.spyOn(cfg as any, 'checkFfprobe');
    jest.spyOn((cfg as any).logger, 'log').mockImplementation(() => {});
    await expect(cfg.onModuleInit()).resolves.toBeUndefined();
    expect(ffprobeSpy).not.toHaveBeenCalled();
    // رفع الفيديو يبقى معطّلاً
    expect(cfg.isUploadEnabled).toBe(false);
    expect(cfg.getR2Credentials().bucketName).toBe('asas-media-test');
  });

  it('describe() لا يكشف أسراراً ويعرض الأعلام', () => {
    const cfg = build({ ...FULL_R2, MEDIA_R2_KINDS: 'AUDIO' });
    const d = JSON.stringify(cfg.describe());
    expect(d).toContain('AUDIO');
    expect(d).not.toContain('super-secret-value-xyz');
    expect(d).not.toContain('AKIA_TEST_ID');
  });
});
