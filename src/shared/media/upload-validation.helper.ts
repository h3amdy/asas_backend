// src/shared/media/upload-validation.helper.ts
// ═══════════════════════════════════════════════════════════════
// 🛡️ VIDEO P4-3 — مساعد التحقق من صلاحيات وحدود الرفع
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §4.1, §4.3)
//        docs/features/video/06-VIDEO-API-001.md (§2.1 — W-050, W-057, W-058, W-063)
// ═══════════════════════════════════════════════════════════════
// المسؤوليات:
//   1. فحص حد الحجم حسب النوع بلا سقوط صامت (W-050 / W-058)
//   2. التحقق من contentType مع kind (D-P2-005: الفيديو video/mp4 أو video/quicktime فقط)
//   3. حماية ملكية الجلسة (W-063): التحقق من أن المستدعي هو مالك الجلسة
//   4. فحوصات حدود الأجزاء الخمسة (W-057) قبل الكتابة في /storage/tmp
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaKind, MediaUploadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { VideoMediaConfig } from './video-media.config';

export interface LockedChunkSessionRow {
  id: number;
  uuid: string;
  media_asset_id: number;
  owner_type: string;
  kind?: string;
  status: string;
  total_size_bytes: bigint | null;
  bytes_received: bigint;
  chunk_size_bytes?: number;
  content_type: string;
  expires_at: Date;
}

export interface SessionSnapshotForLock {
  id: number;
  uuid: string;
  mediaAssetId: number;
  kind: MediaKind;
  status: MediaUploadStatus;
  expiresAt: Date;
  bytesReceived: bigint;
  totalSizeBytes: bigint | null;
  chunkSizeBytes: number;
  processingStatus?: string | null;
}

/** حدود الحجم حسب النوع لغير الفيديو (بايت) */
export const NON_VIDEO_MAX_FILE_SIZE: Readonly<Record<string, number>> = {
  IMAGE: 20_971_520, // 20 MiB
  AUDIO: 52_428_800, // 50 MiB
  DOCUMENT: 52_428_800, // 50 MiB
};

/** صيغ الفيديو المسموحة في المرحلة الأولى (D-P2-005) */
export const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
]);

/** خريطة امتدادات contentType (تشمل الفيديو) */
const CONTENT_TYPE_EXT_MAP: Readonly<Record<string, string>> = {
  // صور
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  // صوت
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  // مستندات
  'application/pdf': 'pdf',
  // فيديو
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

@Injectable()
export class UploadValidationHelper {
  /** طابور تسلسل داخل العملية لكل جلسة (FIFO) مكمل لقفل SELECT ... FOR UPDATE في PostgreSQL */
  private readonly sessionLocks = new Map<string, Promise<unknown>>();

  /** خطاف اختياري للاختبارات التكاملية لمحاكاة انقطاع العملية بعد كتابة القرص وقبل تحديث DB */
  onAfterDiskWriteBeforeDbUpdate?: (ctx: {
    sessionUuid: string;
    offset: number;
    chunkLength: number;
  }) => Promise<void> | void;

  constructor(private readonly videoConfig: VideoMediaConfig) {}

  /**
   * يضمن تنفيذ عمليات الجلسة الواحدة (chunk / probe / complete / cancel) بالتسلسل الصارم.
   */
  async withSessionLock<T>(
    sessionUuid: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.sessionLocks.get(sessionUuid) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => current);
    this.sessionLocks.set(sessionUuid, chained);

    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.sessionLocks.get(sessionUuid) === chained) {
        this.sessionLocks.delete(sessionUuid);
      }
    }
  }

  // ── 1. التحقق من حد الحجم حسب النوع (W-050 / W-058) ──

  /**
   * يعيد الحد الأقصى لحجم الملف بالبايت حسب النوع.
   * VIDEO يستخدم الحد من VideoMediaConfig؛ لا يوجد سقوط صامت إلى AUDIO.
   */
  getMaxSizeBytes(kind: MediaKind): number {
    if (kind === MediaKind.VIDEO) {
      return this.videoConfig.maxSizeBytes;
    }
    const max = NON_VIDEO_MAX_FILE_SIZE[kind];
    if (!max) {
      throw new BadRequestException({
        error: 'UNSUPPORTED_MEDIA_KIND',
        kind,
      });
    }
    return max;
  }

  /**
   * يتحقق من أن حجم الملف موجب ولا يتجاوز الحد المسموح لنوعه.
   * يرمي BadRequestException('FILE_TOO_LARGE') مع max_size_bytes عند التجاوز.
   */
  validateFileSize(totalSizeBytes: number, kind: MediaKind): void {
    const maxSize = this.getMaxSizeBytes(kind);
    if (
      !Number.isInteger(totalSizeBytes) ||
      totalSizeBytes <= 0 ||
      totalSizeBytes > maxSize
    ) {
      throw new BadRequestException({
        error: 'FILE_TOO_LARGE',
        max_size_bytes: maxSize,
        kind,
      });
    }
  }

  // ── 2. التحقق من contentType ──

  /**
   * يتحقق من أن نوع المحتوى يتوافق مع النوع المحدد والسياق (SCHOOL / PLATFORM).
   * - IMAGE: image/*
   * - AUDIO: audio/*
   * - DOCUMENT: application/pdf (مسموح في PLATFORM؛ في SCHOOL غير مفعل في الرفع المباشر)
   * - VIDEO: video/mp4 أو video/quicktime حصراً (D-P2-005)
   */
  validateContentType(
    contentType: string,
    kind: MediaKind,
    ownerType: 'SCHOOL' | 'PLATFORM' = 'SCHOOL',
  ): void {
    const ct = (contentType ?? '').trim();
    let valid = false;

    if (kind === MediaKind.IMAGE) {
      valid = ct.startsWith('image/');
    } else if (kind === MediaKind.AUDIO) {
      valid = ct.startsWith('audio/');
    } else if (kind === MediaKind.DOCUMENT) {
      valid = ownerType === 'PLATFORM' && ct === 'application/pdf';
    } else if (kind === MediaKind.VIDEO) {
      valid = ALLOWED_VIDEO_MIME_TYPES.has(ct);
    }

    if (!valid) {
      throw new BadRequestException({
        error: 'CONTENT_TYPE_MISMATCH',
        code: 'UNSUPPORTED_MEDIA_TYPE',
        kind,
        content_type: contentType,
      });
    }
  }

  /**
   * يستخرج امتداد الملف من contentType.
   */
  getExtFromContentType(contentType: string): string {
    return (
      CONTENT_TYPE_EXT_MAP[contentType] ??
      (contentType?.startsWith('image/') ? 'webp' : 'bin')
    );
  }

  // ── 3. ملكية الجلسة (W-063) ──

  /**
   * يتحقق من أن المستدعي هو مالك الجلسة في المدرسة.
   * المدرسة: uploaderUserId === currentUserId (جلسة بلا مالك تُرفض Fail-Closed)
   */
  assertSessionOwnerSchool(
    sessionUploaderUserId: number | null,
    currentUserId: number,
  ): void {
    if (
      sessionUploaderUserId == null ||
      sessionUploaderUserId !== currentUserId
    ) {
      throw new ForbiddenException({
        error: 'SESSION_FORBIDDEN',
        message: 'لا يمكنك التعامل مع جلسة رفع مستخدم آخر',
      });
    }
  }

  /**
   * يتحقق من أن المستدعي هو مالك الجلسة أو PLATFORM_ADMIN في المنصة.
   */
  assertSessionOwnerPlatform(
    sessionPlatformUserId: number | null,
    currentPlatformUserId: number,
    isPlatformAdmin: boolean,
  ): void {
    if (isPlatformAdmin) return;
    if (
      sessionPlatformUserId == null ||
      sessionPlatformUserId !== currentPlatformUserId
    ) {
      throw new ForbiddenException({
        error: 'SESSION_FORBIDDEN',
        message: 'لا يمكنك التعامل مع جلسة رفع مستخدم آخر',
      });
    }
  }

  // ── 4. فحوصات الجلسة وحدود الأجزاء الخمسة (W-057) ──

  /**
   * يتحقق من حالة الجلسة قبل قبول chunk.
   */
  validateSessionForChunk(session: {
    status: MediaUploadStatus;
    expiresAt: Date;
  }): void {
    if (session.status === MediaUploadStatus.COMPLETED) {
      throw new ConflictException('SESSION_ALREADY_COMPLETED');
    }
    if (session.status === MediaUploadStatus.CANCELED) {
      throw new ConflictException('SESSION_CANCELED');
    }
    if (session.expiresAt < new Date()) {
      throw new GoneException('SESSION_EXPIRED');
    }
  }

  /**
   * يحلل ترويسة Content-Range: bytes <start>-<end>/<total>
   */
  parseContentRange(contentRange: string): {
    start: number;
    end: number;
    total: number;
  } {
    const match = (contentRange ?? '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) {
      throw new BadRequestException('INVALID_CONTENT_RANGE');
    }
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    const total = parseInt(match[3], 10);
    if (end < start || total <= 0) {
      throw new BadRequestException('INVALID_CONTENT_RANGE');
    }
    return { start, end, total };
  }

  /**
   * فحوصات W-057 الخمسة الشاملة قبل كتابة أي بايت في /storage/tmp:
   *   1) حالة الجلسة (غير مكتملة/ملغاة/منتهية)
   *   2) start === currentBytesReceived (وإلا 409 OUT_OF_ORDER مع الموضع لاستكمال الرفع)
   *   3) chunk.length === (end - start + 1)
   *   4) chunk.length <= session.chunkSizeBytes
   *   5) total === session.totalSizeBytes و (currentBytesReceived + chunk.length) <= total <= maxForKind
   */
  validateChunkUpload(
    session: {
      kind: MediaKind;
      status: MediaUploadStatus;
      expiresAt: Date;
      bytesReceived: bigint;
      totalSizeBytes: bigint | null;
      chunkSizeBytes: number;
    },
    contentRange: string,
    chunkLength: number,
  ): {
    start: number;
    end: number;
    total: number;
    currentBytesReceived: number;
  } {
    this.validateSessionForChunk(session);
    const range = this.parseContentRange(contentRange);
    const currentBytesReceived = Number(session.bytesReceived);
    const sessionTotal = session.totalSizeBytes
      ? Number(session.totalSizeBytes)
      : 0;
    const maxForKind = this.getMaxSizeBytes(session.kind);

    // الفحص 1: الترتيب التسلسلي (409 OUT_OF_ORDER قبل أي فحص آخر لتمكين المزامنة السلسة عند إعادة الإرسال)
    if (range.start !== currentBytesReceived) {
      throw new ConflictException({
        error: 'OUT_OF_ORDER',
        bytes_received: currentBytesReceived,
        next_expected_byte: currentBytesReceived,
      });
    }

    // الفحص 2: تطابق طول الجزء الفعلي مع مدى Content-Range (end - start + 1)
    if (range.end - range.start + 1 !== chunkLength) {
      throw new BadRequestException({
        error: 'CONTENT_RANGE_LENGTH_MISMATCH',
        expected_chunk_bytes: range.end - range.start + 1,
        received_chunk_bytes: chunkLength,
      });
    }

    // الفحص 3: عدم تجاوز حجم الجزء المسموح للجلسة
    if (chunkLength > session.chunkSizeBytes) {
      throw new BadRequestException({
        error: 'CHUNK_TOO_LARGE',
        max_chunk_bytes: session.chunkSizeBytes,
        received_chunk_bytes: chunkLength,
      });
    }

    // الفحص 4: تطابق total المعلن في Content-Range مع totalSizeBytes للجلسة
    if (sessionTotal > 0 && range.total !== sessionTotal) {
      throw new BadRequestException({
        error: 'TOTAL_SIZE_MISMATCH',
        expected_total_bytes: sessionTotal,
        received_total_bytes: range.total,
      });
    }

    // الفحص 5: عدم تجاوز المجموع التراكمي لحجم الجلسة أو الحد الأقصى للنوع (حماية /storage/tmp)
    const nextTotal = currentBytesReceived + chunkLength;
    if (
      (sessionTotal > 0 && nextTotal > sessionTotal) ||
      nextTotal > maxForKind
    ) {
      throw new BadRequestException({
        error: 'FILE_TOO_LARGE',
        max_size_bytes:
          sessionTotal > 0 ? Math.min(sessionTotal, maxForKind) : maxForKind,
        total_size_bytes: sessionTotal,
        would_be_bytes: nextTotal,
      });
    }

    return { ...range, currentBytesReceived };
  }

  /**
   * دالة التوافق مع الاختبارات المباشرة لحدود الأجزاء.
   */
  validateChunkBounds(
    chunkStart: number,
    chunkLength: number,
    bytesReceived: number,
    totalSizeBytes: number,
    chunkSizeBytes: number,
    maxForKind?: number,
  ): void {
    if (chunkStart !== bytesReceived) {
      throw new ConflictException({
        error: 'OUT_OF_ORDER',
        bytes_received: bytesReceived,
        next_expected_byte: bytesReceived,
      });
    }
    if (chunkLength > chunkSizeBytes) {
      throw new BadRequestException({
        error: 'CHUNK_TOO_LARGE',
        max_chunk_bytes: chunkSizeBytes,
        received_chunk_bytes: chunkLength,
      });
    }
    const nextTotal = bytesReceived + chunkLength;
    const cap =
      maxForKind !== undefined && totalSizeBytes > 0
        ? Math.min(totalSizeBytes, maxForKind)
        : totalSizeBytes > 0
          ? totalSizeBytes
          : maxForKind;
    if (cap !== undefined && cap > 0 && nextTotal > cap) {
      throw new BadRequestException({
        error: 'FILE_TOO_LARGE',
        max_size_bytes: cap,
        total_size_bytes: totalSizeBytes,
        would_be_bytes: nextTotal,
      });
    }
  }

  // ── 5. منسق التسلسل والمصالحة الذرّية لعمليات الجلسة (School + Platform) ──

  /**
   * ينفذ رفع جزء واحد داخل قفل الجلسة المزدوج (FIFO + PostgreSQL SELECT ... FOR UPDATE)
   * مع مصالحة حجم الملف الفعلي قبل الكتابة، والكتابة عند الإزاحة الصريحة، والتراجع الفوري
   * عن الكتابة على القرص إذا فشل تحديث قاعدة البيانات أو التزام المعاملة.
   */
  async executeSerializedChunkUpload(
    prisma: PrismaService,
    storage: StorageService,
    sessionOrLoader:
      | SessionSnapshotForLock
      | { uuid: string; load: () => Promise<SessionSnapshotForLock> },
    contentRange: string,
    chunk: Buffer,
  ): Promise<{ bytes_received: number; next_expected_byte: number }> {
    return this.withSessionLock(sessionOrLoader.uuid, async () => {
      const initialSession =
        'load' in sessionOrLoader
          ? await sessionOrLoader.load()
          : sessionOrLoader;
      let writtenOnDisk = false;
      let rollbackOffset = Number(initialSession.bytesReceived);

      const runInTx = async (tx: Prisma.TransactionClient) => {
        const locked = await this.lockSessionRow(tx, initialSession);
        const currentBytesReceived = Number(locked.bytesReceived);
        rollbackOffset = currentBytesReceived;

        // 1) التحقق من حالة الجلسة وصلاحيتها الزمنية قبل لمس الملف
        this.validateSessionForChunk(locked);

        // 2) مصالحة الملف الفعلي على القرص مع العداد الملتزم به في DB (معالجة أي انقطاع سابق)
        if (typeof storage.reconcileTempFile === 'function') {
          await storage.reconcileTempFile(locked.uuid, currentBytesReceived);
        }

        // 3) فحوصات حدود الأجزاء الخمسة (W-057) بناءً على القيمة المقفلة الحديثة
        this.validateChunkUpload(locked, contentRange, chunk.length);

        // 4) الكتابة عند الإزاحة الصريحة والتحقق من الحجم الفعلي على القرص
        if (typeof storage.writeChunkAtOffset === 'function') {
          await storage.writeChunkAtOffset(
            locked.uuid,
            chunk,
            currentBytesReceived,
          );
        } else {
          await storage.appendToTemp(locked.uuid, chunk);
        }
        writtenOnDisk = true;

        // خطاف اختباري لمحاكاة انقطاع العملية بعد كتابة القرص وقبل تحديث DB
        if (this.onAfterDiskWriteBeforeDbUpdate) {
          await this.onAfterDiskWriteBeforeDbUpdate({
            sessionUuid: locked.uuid,
            offset: currentBytesReceived,
            chunkLength: chunk.length,
          });
        }

        // 5) تحديث ذرّي مشروط لعداد الجلسة في قاعدة البيانات
        const newBytesReceived = currentBytesReceived + chunk.length;
        if (typeof tx.mediaUploadSession.updateMany === 'function') {
          const updated = await tx.mediaUploadSession.updateMany({
            where: {
              id: locked.id,
              bytesReceived: locked.bytesReceived,
              status: {
                in: [MediaUploadStatus.INITIATED, MediaUploadStatus.UPLOADING],
              },
            },
            data: {
              bytesReceived: BigInt(newBytesReceived),
              lastChunkAt: new Date(),
              status: MediaUploadStatus.UPLOADING,
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException('CONCURRENT_SESSION_STATE_CHANGED');
          }
        } else {
          await tx.mediaUploadSession.update({
            where: { id: locked.id },
            data: {
              bytesReceived: BigInt(newBytesReceived),
              lastChunkAt: new Date(),
              status: MediaUploadStatus.UPLOADING,
            },
          });
        }

        return {
          bytes_received: newBytesReceived,
          next_expected_byte: newBytesReceived,
        };
      };

      try {
        if (typeof prisma.$transaction === 'function') {
          return await prisma.$transaction(runInTx, {
            timeout: 30_000,
            maxWait: 10_000,
          });
        }
        return await runInTx(prisma as unknown as Prisma.TransactionClient);
      } catch (err) {
        if (writtenOnDisk && typeof storage.rollbackChunkWrite === 'function') {
          // فحص Ambiguous COMMIT: لا نقص الملف إلى B إلا إذا أكدنا من PostgreSQL أن المعاملة تراجعت فعلاً (bytes_received === B).
          // - إذا كانت قيمة DB تساوي B + L (نجح COMMIT وضاع التأكيد): نحتفظ بالجزء المكتوب على القرص.
          // - إذا كانت قيمة DB تساوي B (تراجعت المعاملة فعلاً): نقص الذيل غير الملتزم إلى B.
          // - إذا تعذر الاتصال بـ PostgreSQL (committedBytes === null): لا نقص الملف ونترك المصالحة للاستدعاء التالي.
          const committedBytes = await this.readCommittedBytesFromDb(
            prisma,
            initialSession.id,
          );
          if (committedBytes !== null && committedBytes === rollbackOffset) {
            await storage.rollbackChunkWrite(
              initialSession.uuid,
              rollbackOffset,
            );
          }
        }
        throw err;
      }
    });
  }

  /**
   * يستعلم عن العداد الملتزم فعلياً في PostgreSQL لحسم حالة Ambiguous COMMIT قبل أي قص للملف المؤقت.
   * يعيد null إذا تعذر الاتصال بقاعدة البيانات أو تعذر تحديد النتيجة.
   */
  private async readCommittedBytesFromDb(
    prisma: PrismaService,
    sessionId: number,
  ): Promise<number | null> {
    try {
      if (typeof prisma.$queryRaw === 'function') {
        const rows = await prisma.$queryRaw<Array<{ bytes_received: bigint }>>`
          SELECT bytes_received
          FROM media_upload_sessions
          WHERE id = ${sessionId}
        `;
        if (rows[0]?.bytes_received !== undefined) {
          return Number(rows[0].bytes_received);
        }
      }
      const sessionDelegate = (
        prisma as unknown as {
          mediaUploadSession?: {
            findUnique?: (args: {
              where: { id: number };
              select: { bytesReceived: true };
            }) => Promise<{ bytesReceived: bigint } | null>;
          };
        }
      ).mediaUploadSession;
      if (typeof sessionDelegate?.findUnique === 'function') {
        const row = await sessionDelegate.findUnique({
          where: { id: sessionId },
          select: { bytesReceived: true },
        });
        if (row?.bytesReceived !== undefined) {
          return Number(row.bytesReceived);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * مصالحة حالة الجلسة والملف المؤقت عند استدعاء probeSession (استعادة الجلسة بعد انقطاع).
   */
  async reconcileSessionOnProbe(
    prisma: PrismaService,
    storage: StorageService,
    initialSession: SessionSnapshotForLock,
  ): Promise<SessionSnapshotForLock> {
    return this.withSessionLock(initialSession.uuid, async () => {
      const runInTx = async (tx: Prisma.TransactionClient) => {
        const locked = await this.lockSessionRow(tx, initialSession);
        if (
          locked.expiresAt < new Date() &&
          locked.status !== MediaUploadStatus.COMPLETED
        ) {
          throw new GoneException('SESSION_EXPIRED');
        }

        if (
          (locked.status === MediaUploadStatus.INITIATED ||
            locked.status === MediaUploadStatus.UPLOADING) &&
          typeof storage.reconcileTempFile === 'function'
        ) {
          await storage.reconcileTempFile(
            locked.uuid,
            Number(locked.bytesReceived),
          );
        }
        return locked;
      };

      if (typeof prisma.$transaction === 'function') {
        return prisma.$transaction(runInTx, {
          timeout: 15_000,
          maxWait: 10_000,
        });
      }
      return runInTx(prisma as unknown as Prisma.TransactionClient);
    });
  }

  /**
   * إلغاء الجلسة بشكل متسلسل وذرّي تحت قفل الجلسة لمنع التداخل مع uploadChunk أو completeSession.
   */
  async executeSerializedCancelSession(
    prisma: PrismaService,
    storage: StorageService,
    initialSession: SessionSnapshotForLock,
  ): Promise<{ status: 'CANCELED' }> {
    return this.withSessionLock(initialSession.uuid, async () => {
      const runInTx = async (tx: Prisma.TransactionClient) => {
        const locked = await this.lockSessionRow(tx, initialSession);
        if (
          locked.kind === MediaKind.VIDEO &&
          locked.status === MediaUploadStatus.COMPLETED
        ) {
          throw new ConflictException('SESSION_ALREADY_COMPLETED');
        }

        const now = new Date();
        await tx.mediaUploadSession.update({
          where: { id: locked.id },
          data: {
            status: MediaUploadStatus.CANCELED,
            canceledAt: now,
          },
        });
        await tx.mediaAsset.update({
          where: { id: locked.mediaAssetId },
          data: { isDeleted: true, deletedAt: now },
        });
      };

      if (typeof prisma.$transaction === 'function') {
        await prisma.$transaction(runInTx, {
          timeout: 15_000,
          maxWait: 10_000,
        });
      } else {
        await runInTx(prisma as unknown as Prisma.TransactionClient);
      }

      await storage.deleteTempFile(initialSession.uuid);
      return { status: 'CANCELED' };
    });
  }

  private async lockSessionRow(
    tx: Prisma.TransactionClient,
    fallback: SessionSnapshotForLock,
  ): Promise<SessionSnapshotForLock> {
    if (typeof tx.$queryRaw === 'function') {
      const rows = await tx.$queryRaw<LockedChunkSessionRow[]>`
        SELECT id, uuid, media_asset_id, owner_type, kind::text AS kind, status::text AS status,
               total_size_bytes, bytes_received, chunk_size_bytes, content_type, expires_at
        FROM media_upload_sessions
        WHERE id = ${fallback.id}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        throw new NotFoundException('SESSION_NOT_FOUND');
      }
      return {
        id: row.id,
        uuid: row.uuid,
        mediaAssetId: row.media_asset_id,
        kind: (row.kind as MediaKind | undefined) ?? fallback.kind,
        status: row.status as MediaUploadStatus,
        expiresAt: row.expires_at,
        bytesReceived: row.bytes_received,
        totalSizeBytes: row.total_size_bytes,
        chunkSizeBytes: row.chunk_size_bytes ?? fallback.chunkSizeBytes,
        processingStatus: fallback.processingStatus,
      };
    }
    return fallback;
  }
}
