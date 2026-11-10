/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
// src/shared/media/disk-space-guard.service.spec.ts
// ═══════════════════════════════════════════════════════════════
// 💾 VIDEO P4-3 — اختبارات DiskSpaceGuardService (§4.2, §10.1)
// ═══════════════════════════════════════════════════════════════

import { HttpException, HttpStatus } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DiskSpaceGuardService,
  VIDEO_UPLOAD_RESERVATION_LOCK_KEY,
  evaluateDiskAdmission,
} from './disk-space-guard.service';

describe('VIDEO P4-3 — DiskSpaceGuardService (statfs + حجز تزامني)', () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'disk-guard-spec-'),
    );
    await fs.promises.mkdir(path.join(tmpRoot, 'tmp'), { recursive: true });
  });

  afterAll(async () => {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  function buildGuard(opts: {
    freeBytes?: bigint;
    reservedUploads?: bigint;
    activeVideoSessions?: number;
    transcodeJobs?: number;
    env?: Record<string, string>;
  }) {
    const prevEnv: Record<string, string | undefined> = {};
    const envToSet: Record<string, string> = {
      MEDIA_STORAGE_PATH: tmpRoot,
      ...(opts.env ?? {}),
    };
    for (const [k, v] of Object.entries(envToSet)) {
      prevEnv[k] = process.env[k];
      process.env[k] = v;
    }

    const queries: string[] = [];
    const tx = {
      $queryRaw: jest.fn(
        async (strings: TemplateStringsArray, ...vals: any[]) => {
          const sql = strings.join('?');
          queries.push(sql);
          if (sql.includes('pg_advisory_xact_lock')) {
            expect(vals[0]).toBe(VIDEO_UPLOAD_RESERVATION_LOCK_KEY);
            return [{ locked: '' }];
          }
          if (sql.includes('FROM media_upload_sessions')) {
            return [
              {
                reserved: opts.reservedUploads ?? 0n,
                video_count: BigInt(opts.activeVideoSessions ?? 0),
              },
            ];
          }
          if (sql.includes('FROM media_processing_jobs')) {
            return [{ cnt: BigInt(opts.transcodeJobs ?? 0) }];
          }
          return [];
        },
      ),
    };

    const prisma = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };

    try {
      const guard = new DiskSpaceGuardService(prisma as any);
      if (opts.freeBytes !== undefined) {
        jest
          .spyOn(guard as any, 'measureFreeBytes')
          .mockResolvedValue(opts.freeBytes);
      }
      return { guard, prisma, tx, queries };
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it('يقيس المساحة الفعلية على المسار الحقيقي لـ /storage/tmp عبر statfs (bavail × bsize)', async () => {
    const { guard, tx } = buildGuard({});
    const snap = await guard.snapshot(tx as any);
    expect(guard.stagingTmpDir).toBe(path.join(tmpRoot, 'tmp'));
    expect(snap.actualFreeBytes).toBeGreaterThan(0n);
  });

  it('يقبل الجلسة وينفّذ callback الإنشاء داخل نفس المعاملة والقفل عندما يبقى ≥ 5GB', async () => {
    // متاح 6.5GB، حجوزات رفع 500MB، مهمتان قيد التحويل (2×350MB=700MB)، مطلوب 150MB → المتبقي 5.15GB >= 5GB
    const { guard, queries } = buildGuard({
      freeBytes: BigInt(6_500_000_000),
      reservedUploads: BigInt(500_000_000),
      activeVideoSessions: 2,
      transcodeJobs: 2,
    });
    const createFn = jest.fn(async () => ({ sessionId: 42 }));

    const res = await guard.reserveAndRun(BigInt(150_000_000), createFn);

    expect(res).toEqual({ sessionId: 42 });
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(queries[0]).toContain('pg_advisory_xact_lock');
  });

  it('يرفض بـ 507 INSUFFICIENT_STORAGE دون استدعاء create عندما يكسر مجموع الحجوزات حد الـ 5GB', async () => {
    // متاح 6.0GB، حجوزات رفع 400MB، مهمتان تحويل (700MB) → متبقي قبل الطلب 4.9GB < 5GB
    const { guard } = buildGuard({
      freeBytes: BigInt(6_000_000_000),
      reservedUploads: BigInt(400_000_000),
      activeVideoSessions: 1,
      transcodeJobs: 2,
    });
    const createFn = jest.fn();

    const err = (await guard
      .reserveAndRun(BigInt(100_000_000), createFn)
      .catch((e: unknown) => e)) as HttpException;

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
    expect(err.getResponse()).toMatchObject({
      error: 'INSUFFICIENT_STORAGE',
    });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('يرفض بـ 507 MAX_ACTIVE_VIDEO_UPLOADS_REACHED عند وصول عدد جلسات الفيديو النشطة للسقف (5)', async () => {
    const { guard } = buildGuard({
      freeBytes: BigInt(50_000_000_000),
      activeVideoSessions: 5,
    });
    const createFn = jest.fn();

    const err = (await guard
      .reserveAndRun(BigInt(10_000_000), createFn)
      .catch((e: unknown) => e)) as HttpException;

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
    expect(err.getResponse()).toMatchObject({
      error: 'MAX_ACTIVE_VIDEO_UPLOADS_REACHED',
    });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('evaluateDiskAdmission: يطبق حد الـ 5GB بدقة حجرية (يساوي 5GB مقبول، أقل ببايت واحد مرفوض)', () => {
    const cfg = {
      minFreeFloorBytes: BigInt(5_000_000_000),
      transcodeScratchBytes: BigInt(350_000_000),
      maxActiveVideoUploads: 5,
    };
    const snap = {
      actualFreeBytes: BigInt(5_150_000_000),
      reservedByActiveUploads: 0n,
      reservedForTranscoding: 0n,
      activeVideoSessionCount: 0,
    };

    expect(evaluateDiskAdmission(snap, BigInt(150_000_000), cfg)).toBeNull();
    expect(evaluateDiskAdmission(snap, BigInt(150_000_001), cfg)).toBe(
      'INSUFFICIENT_STORAGE',
    );
  });

  it('يحترم متغيرات البيئة المخصصة (MEDIA_TMP_MIN_FREE_BYTES, MEDIA_VIDEO_TRANSCODE_SCRATCH_BYTES, MEDIA_VIDEO_MAX_ACTIVE_UPLOADS)', () => {
    const { guard } = buildGuard({
      env: {
        MEDIA_TMP_MIN_FREE_BYTES: '8000000000',
        MEDIA_VIDEO_TRANSCODE_SCRATCH_BYTES: '400000000',
        MEDIA_VIDEO_MAX_ACTIVE_UPLOADS: '3',
      },
    });
    expect(guard.config).toEqual({
      minFreeFloorBytes: BigInt(8_000_000_000),
      transcodeScratchBytes: BigInt(400_000_000),
      maxActiveVideoUploads: 3,
    });
  });
});
