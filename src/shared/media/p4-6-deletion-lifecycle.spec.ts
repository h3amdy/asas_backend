// src/shared/media/p4-6-deletion-lifecycle.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 VIDEO P4-6 — اختبارات الوحدة: R2DeleteErrorClassificationSpec (§10.1) + الإعدادات + جمع المفاتيح
// ═══════════════════════════════════════════════════════════════

import { HeadOutcome } from './object-storage.interface';
import { VideoMediaConfig } from './video-media.config';
import {
  classifyHeadForDeletion,
  deleteObjectsIdempotencyKey,
  extractRegistryKeys,
} from './worker/delete-objects.processor';

describe('P4-6 — R2DeleteErrorClassificationSpec (404 وحده دليل الحذف)', () => {
  it('404 NOT_FOUND هو النتيجة الوحيدة المعتمدة كحذف ناجح', () => {
    expect(classifyHeadForDeletion({ kind: 'NOT_FOUND' })).toBe(
      'VERIFIED_DELETED',
    );
  });

  it.each<[string, HeadOutcome, string]>([
    ['403 Forbidden', { kind: 'FORBIDDEN' }, 'R2_DELETE_FORBIDDEN'],
    [
      '500',
      {
        kind: 'ERROR',
        code: 'InternalError',
        retryable: true,
        httpStatus: 500,
      },
      'TRANSIENT_ERROR',
    ],
    [
      '503',
      {
        kind: 'ERROR',
        code: 'ServiceUnavailable',
        retryable: true,
        httpStatus: 503,
      },
      'TRANSIENT_ERROR',
    ],
    [
      '429',
      { kind: 'ERROR', code: 'SlowDown', retryable: true, httpStatus: 429 },
      'TRANSIENT_ERROR',
    ],
    [
      'Timeout',
      { kind: 'ERROR', code: 'ETIMEDOUT', retryable: true },
      'TRANSIENT_ERROR',
    ],
    [
      'ECONNRESET',
      { kind: 'ERROR', code: 'ECONNRESET', retryable: true },
      'TRANSIENT_ERROR',
    ],
    [
      'خطأ غير قابل لإعادة المحاولة',
      { kind: 'ERROR', code: 'Unknown', retryable: false },
      'TRANSIENT_ERROR',
    ],
    [
      '200 (الكائن ما زال موجوداً)',
      { kind: 'FOUND', info: { key: 'k', sizeBytes: 1, etag: null } },
      'STILL_EXISTS',
    ],
  ])('%s لا يُعد حذفاً ناجحاً', (_label, head, expected) => {
    const result = classifyHeadForDeletion(head);
    expect(result).toBe(expected);
    expect(result).not.toBe('VERIFIED_DELETED');
  });
});

describe('P4-6 — جمع المفاتيح المعروفة والمسجلة (بلا ListObjectsV2)', () => {
  it('extractRegistryKeys يجمع كل مفاتيح كل الأجيال المسجلة', () => {
    const json = JSON.stringify({
      generations_registry: {
        '1': { keys: { a: {}, b: {} } },
        '2': { keys: { c: {} } },
      },
    });
    expect(extractRegistryKeys(json).sort()).toEqual(['a', 'b', 'c']);
  });

  it('extractRegistryKeys آمن مع JSON فارغ أو تالف', () => {
    expect(extractRegistryKeys(null)).toEqual([]);
    expect(extractRegistryKeys('{not json')).toEqual([]);
    expect(extractRegistryKeys('{}')).toEqual([]);
  });

  it('مفتاح المثالية ثابت لكل أصل: DELETE_OBJECTS:{assetUuid}', () => {
    expect(deleteObjectsIdempotencyKey('abc')).toBe('DELETE_OBJECTS:abc');
  });
});

describe('P4-6 — إعدادات دورة الحذف', () => {
  const vars = [
    'MEDIA_DELETE_GRACE_DAYS',
    'MEDIA_UNLINKED_ASSET_TTL_HOURS',
    'MEDIA_DELETE_MAX_ATTEMPTS',
  ] as const;
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of vars) prev[v] = process.env[v];
  });
  afterEach(() => {
    for (const v of vars) {
      if (prev[v] === undefined) delete process.env[v];
      else process.env[v] = prev[v];
    }
  });

  it('القيم الافتراضية: 30 يوماً، 24 ساعة، 10 محاولات', () => {
    for (const v of vars) delete process.env[v];
    const cfg = new VideoMediaConfig();
    expect(cfg.mediaDeleteGraceDays).toBe(30);
    expect(cfg.unlinkedAssetTtlHours).toBe(24);
    expect(cfg.mediaDeleteMaxAttempts).toBe(10);
  });

  it('قيم مخصصة صالحة تُقرأ، والقيم الخارجة عن النطاق تعود للافتراضي', () => {
    process.env.MEDIA_DELETE_GRACE_DAYS = '7';
    process.env.MEDIA_UNLINKED_ASSET_TTL_HOURS = '48';
    process.env.MEDIA_DELETE_MAX_ATTEMPTS = '0';
    const cfg = new VideoMediaConfig();
    expect(cfg.mediaDeleteGraceDays).toBe(7);
    expect(cfg.unlinkedAssetTtlHours).toBe(48);
    expect(cfg.mediaDeleteMaxAttempts).toBe(10);

    process.env.MEDIA_DELETE_GRACE_DAYS = '0';
    expect(new VideoMediaConfig().mediaDeleteGraceDays).toBe(30);
  });
});
