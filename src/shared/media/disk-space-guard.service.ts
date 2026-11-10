// src/shared/media/disk-space-guard.service.ts
// ═══════════════════════════════════════════════════════════════
// 💾 VIDEO P4-3 — حارس مساحة القرص التزامني
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §4.2)
// ═══════════════════════════════════════════════════════════════
// معادلة القبول (داخل pg_advisory_xact_lock واحد مع إنشاء الجلسة نفسها):
//   actualFreeBytes − reservedByActiveUploads − reservedForTranscoding − requested ≥ minFreeFloor
//   + activeVideoUploadSessions < maxActiveVideoUploads
//
// الذرّية: الفحص وإنشاء صف الجلسة يحدثان في نفس المعاملة وتحت نفس القفل،
// فلا يمكن لطلبين متزامنين أن يمرّا معاً بناءً على نفس القراءة.
// عند الرفض: 507 قبل إنشاء أي صف أو ملف.
// ═══════════════════════════════════════════════════════════════

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

export interface DiskSpaceSnapshot {
  actualFreeBytes: bigint;
  reservedByActiveUploads: bigint;
  reservedForTranscoding: bigint;
  activeVideoSessionCount: number;
}

export type DiskRejectReason =
  | 'INSUFFICIENT_STORAGE'
  | 'MAX_ACTIVE_VIDEO_UPLOADS_REACHED';

export interface DiskSpaceGuardConfig {
  minFreeFloorBytes: bigint;
  transcodeScratchBytes: bigint;
  maxActiveVideoUploads: number;
}

/** مفتاح ثابت لقفل حجز رفع الفيديو (pg_advisory_xact_lock) */
export const VIDEO_UPLOAD_RESERVATION_LOCK_KEY = BigInt('7283910465');
/** مهلة معاملة الحجز (القفل قصير: قراءتان + إدراج صفين) */
const RESERVATION_TX_TIMEOUT_MS = 15_000;

function readBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = (process.env[name] ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const v = BigInt(raw);
  return v > 0n ? v : fallback;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const v = Number(raw);
  return Number.isSafeInteger(v) && v > 0 ? v : fallback;
}

/**
 * قرار القبول — دالة نقية قابلة للاختبار مباشرة.
 * يعيد null عند القبول أو سبب الرفض.
 */
export function evaluateDiskAdmission(
  snap: DiskSpaceSnapshot,
  requestedBytes: bigint,
  cfg: DiskSpaceGuardConfig,
): DiskRejectReason | null {
  if (snap.activeVideoSessionCount >= cfg.maxActiveVideoUploads) {
    return 'MAX_ACTIVE_VIDEO_UPLOADS_REACHED';
  }
  const remaining =
    snap.actualFreeBytes -
    snap.reservedByActiveUploads -
    snap.reservedForTranscoding -
    requestedBytes;
  return remaining >= cfg.minFreeFloorBytes ? null : 'INSUFFICIENT_STORAGE';
}

@Injectable()
export class DiskSpaceGuardService {
  private readonly logger = new Logger('DiskSpaceGuard');
  readonly config: DiskSpaceGuardConfig;
  /** المسار الفعلي لـ /storage/tmp (نفس ما يستخدمه StorageService) */
  readonly stagingTmpDir: string;

  constructor(private readonly prisma: PrismaService) {
    const basePath = path.resolve(
      process.env.MEDIA_STORAGE_PATH || './storage',
    );
    this.stagingTmpDir = path.join(basePath, 'tmp');
    this.config = {
      minFreeFloorBytes: readBigIntEnv(
        'MEDIA_TMP_MIN_FREE_BYTES',
        BigInt(5_000_000_000),
      ),
      transcodeScratchBytes: readBigIntEnv(
        'MEDIA_VIDEO_TRANSCODE_SCRATCH_BYTES',
        BigInt(350_000_000),
      ),
      maxActiveVideoUploads: readIntEnv('MEDIA_VIDEO_MAX_ACTIVE_UPLOADS', 5),
    };
  }

  /** المساحة الحرة لغير الجذر (bavail × bsize) — protected لتسهيل الاختبار */
  protected async measureFreeBytes(): Promise<bigint> {
    const st = await fs.promises.statfs(this.stagingTmpDir);
    return BigInt(st.bavail) * BigInt(st.bsize);
  }

  /**
   * يحجز مساحة لجلسة فيديو جديدة وينفّذ `create` داخل نفس المعاملة والقفل.
   * يرمي 507 دون استدعاء `create` عند الرفض.
   */
  async reserveAndRun<T>(
    requestedBytes: bigint,
    create: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${VIDEO_UPLOAD_RESERVATION_LOCK_KEY})::text AS locked`;

        const snap = await this.snapshot(tx);
        const reason = evaluateDiskAdmission(snap, requestedBytes, this.config);
        if (reason) {
          this.logger.warn(
            `رفض جلسة فيديو (${reason}): free=${snap.actualFreeBytes} ` +
              `uploads=${snap.reservedByActiveUploads} transcode=${snap.reservedForTranscoding} ` +
              `requested=${requestedBytes} active=${snap.activeVideoSessionCount}`,
          );
          throw new HttpException(
            {
              error: reason,
              message: 'لا توجد مساحة كافية لبدء رفع الفيديو حالياً',
            },
            HttpStatus.INSUFFICIENT_STORAGE,
          );
        }
        return create(tx);
      },
      {
        timeout: RESERVATION_TX_TIMEOUT_MS,
        maxWait: RESERVATION_TX_TIMEOUT_MS,
      },
    );
  }

  /** قراءة الحجوزات الحالية + statfs (تُستدعى بعد اكتساب القفل) */
  async snapshot(tx: Prisma.TransactionClient): Promise<DiskSpaceSnapshot> {
    const actualFreeBytes = await this.measureFreeBytes();

    // كل الجلسات النشطة تستهلك /storage/tmp (أياً كان نوعها)، والعدّ للفيديو فقط
    const uploads = await tx.$queryRaw<
      Array<{ reserved: bigint | null; video_count: bigint | null }>
    >`
      SELECT
        COALESCE(SUM(GREATEST(COALESCE(total_size_bytes, 0) - bytes_received, 0)), 0)::bigint AS reserved,
        COUNT(*) FILTER (WHERE kind = 'VIDEO')::bigint AS video_count
      FROM media_upload_sessions
      WHERE status IN ('INITIATED', 'UPLOADING')
        AND expires_at > now()
    `;
    const jobs = await tx.$queryRaw<Array<{ cnt: bigint | null }>>`
      SELECT COUNT(*)::bigint AS cnt
      FROM media_processing_jobs
      WHERE job_type = 'TRANSCODE_VIDEO'
        AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
    `;

    return {
      actualFreeBytes,
      reservedByActiveUploads: BigInt(uploads[0]?.reserved ?? 0),
      reservedForTranscoding:
        BigInt(jobs[0]?.cnt ?? 0) * this.config.transcodeScratchBytes,
      activeVideoSessionCount: Number(uploads[0]?.video_count ?? 0),
    };
  }
}
