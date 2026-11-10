// src/shared/media/video-upload.service.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-3 — منطق جلسات رفع الفيديو المشترك بين المدرسة والمنصة
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §4.2, §4.3, §6.3)
//        docs/features/video/06-VIDEO-API-001.md (§2.1, §2.2)
// ═══════════════════════════════════════════════════════════════
// - initVideoSession: حجز المساحة + إنشاء الأصل والجلسة في معاملة واحدة تحت القفل.
// - completeVideoSession: قفل صف الجلسة FOR UPDATE (Idempotent) → تحقق الحجم الفعلي
//   → ffprobe السداسي → rename ذرّي إلى tmp/video-staging/{assetUuid}/source.{ext}
//   → storageProvider='R2' + PROCESSING → مهمة TRANSCODE_VIDEO بمفتاح idempotency فريد.
// - لا رفع إلى R2 ولا تحويل هنا (ذلك عمل العامل في P4-4).
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaKind,
  MediaUploadStatus,
  Prisma,
  ProcessingStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { DiskSpaceGuardService } from './disk-space-guard.service';
import { FfprobeService } from './ffprobe.service';
import { StorageService } from './storage.service';
import { UploadValidationHelper } from './upload-validation.helper';
import {
  MAX_VIDEO_CHUNK_SIZE_BYTES,
  MIN_VIDEO_CHUNK_SIZE_BYTES,
  VideoMediaConfig,
} from './video-media.config';

export const TRANSCODE_VIDEO_JOB = 'TRANSCODE_VIDEO';
/** مهلة جلسة الفيديو غير المكتملة (W-064) — افتراضياً 6 ساعات */
export const DEFAULT_VIDEO_SESSION_EXPIRY_HOURS = 6;
/** مهلة معاملة complete: تتسع لـ ffprobe (مهلته 30s) + rename + كتابات DB */
const COMPLETE_TX_TIMEOUT_MS = 60_000;

export interface InitVideoSessionParams {
  ownerType: 'SCHOOL' | 'PLATFORM';
  schoolId: number | null;
  uploaderUserId: number | null;
  platformUserId: number | null;
  contentType: string;
  totalSizeBytes: number;
  chunkSizeBytes?: number;
}

export interface VideoCompleteResult {
  asset_uuid: string;
  media_asset_uuid: string;
  processing_status: string;
  status_url: string;
  already_completed: boolean;
}

interface LockedSessionRow {
  id: number;
  uuid: string;
  media_asset_id: number;
  owner_type: string;
  status: string;
  total_size_bytes: bigint | null;
  bytes_received: bigint;
  content_type: string;
  expires_at: Date;
}

function readExpiryHours(): number {
  const raw = (process.env.MEDIA_VIDEO_SESSION_EXPIRY_HOURS ?? '').trim();
  const v = Number(raw);
  return /^\d+$/.test(raw) && v >= 1 && v <= 48
    ? v
    : DEFAULT_VIDEO_SESSION_EXPIRY_HOURS;
}

@Injectable()
export class VideoUploadService {
  private readonly logger = new Logger('VideoUploadService');
  readonly sessionExpiryHours = readExpiryHours();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly videoConfig: VideoMediaConfig,
    private readonly diskGuard: DiskSpaceGuardService,
    private readonly ffprobe: FfprobeService,
    private readonly validation: UploadValidationHelper,
  ) {}

  /**
   * الفحص الأول: هل ميزة رفع الفيديو مفعّلة؟ (يرمي 503 VIDEO_FEATURE_DISABLED عند التعطيل).
   */
  assertFeatureEnabled(): void {
    this.videoConfig.assertUploadEnabled();
  }

  /**
   * فحص الحجم ونوع المحتوى للفيديو (400 FILE_TOO_LARGE / CONTENT_TYPE_MISMATCH).
   * يُستدعى بعد فحص 503 وفحص الصلاحيات 403 (§4.3).
   */
  validateVideoInitInput(
    contentType: string,
    totalSizeBytes: number,
    ownerType: 'SCHOOL' | 'PLATFORM',
  ): void {
    this.validation.validateFileSize(totalSizeBytes, MediaKind.VIDEO);
    this.validation.validateContentType(
      contentType,
      MediaKind.VIDEO,
      ownerType,
    );
  }

  /** ① إنشاء جلسة فيديو تحت حارس القرص الذرّي (507 بلا أي صف عند الرفض) */
  async initVideoSession(p: InitVideoSessionParams) {
    this.assertFeatureEnabled();
    this.validateVideoInitInput(p.contentType, p.totalSizeBytes, p.ownerType);

    const chunkSize =
      p.chunkSizeBytes !== undefined &&
      Number.isInteger(p.chunkSizeBytes) &&
      p.chunkSizeBytes >= MIN_VIDEO_CHUNK_SIZE_BYTES &&
      p.chunkSizeBytes <= MAX_VIDEO_CHUNK_SIZE_BYTES
        ? p.chunkSizeBytes
        : this.videoConfig.chunkSizeBytes;

    const expiresAt = new Date(
      Date.now() + this.sessionExpiryHours * 60 * 60 * 1000,
    );
    // W-064: tempStorageKey يطابق المسار الفعلي tmp/{sessionUuid}.part
    const sessionUuid = randomUUID();

    const { asset, session } = await this.diskGuard.reserveAndRun(
      BigInt(p.totalSizeBytes),
      async (tx) => {
        const asset = await tx.mediaAsset.create({
          data: {
            schoolId: p.schoolId,
            ownerType: p.ownerType,
            kind: MediaKind.VIDEO,
            contentType: p.contentType,
            sizeBytes: BigInt(p.totalSizeBytes),
            processingStatus: ProcessingStatus.PENDING,
            storageProvider: 'LOCAL', // يبقى LOCAL حتى نجاح complete (§4.2.3)
          },
        });
        const session = await tx.mediaUploadSession.create({
          data: {
            uuid: sessionUuid,
            mediaAssetId: asset.id,
            schoolId: p.schoolId,
            ownerType: p.ownerType,
            uploaderUserId: p.uploaderUserId,
            platformUserId: p.platformUserId,
            kind: MediaKind.VIDEO,
            contentType: p.contentType,
            totalSizeBytes: BigInt(p.totalSizeBytes),
            chunkSizeBytes: chunkSize,
            status: MediaUploadStatus.INITIATED,
            tempStorageKey: `tmp/${sessionUuid}.part`,
            expiresAt,
          },
        });
        return { asset, session };
      },
    );

    return {
      upload_session_uuid: session.uuid,
      media_asset_uuid: asset.uuid,
      chunk_size_bytes: chunkSize,
      max_size_bytes: this.videoConfig.maxSizeBytes,
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * فحوصات W-057 الخاصة بـ chunk قبل الكتابة في /storage/tmp.
   */
  validateVideoChunk(
    session: {
      status: MediaUploadStatus;
      expiresAt: Date;
      bytesReceived: bigint;
      totalSizeBytes: bigint | null;
      chunkSizeBytes: number;
    },
    contentRange: string,
    chunkLength: number,
  ): void {
    this.validation.validateChunkUpload(
      { ...session, kind: MediaKind.VIDEO },
      contentRange,
      chunkLength,
    );
  }

  /**
   * ④ إكمال جلسة فيديو — متكرر التنفيذ بأمان (Idempotent عبر FOR UPDATE).
   * ملكية الجلسة (W-063) يفحصها المستدعي قبل الاستدعاء.
   */
  async completeVideoSession(sessionId: number): Promise<VideoCompleteResult> {
    type TxOutcome =
      | { kind: 'done'; result: VideoCompleteResult }
      | {
          kind: 'rejected';
          errors: string[];
          session: LockedSessionRow;
        };

    type StagingMoveRef = {
      sessionUuid: string;
      assetUuid: string;
      ext: string;
    };
    let movedToStaging = null as StagingMoveRef | null;

    let outcome: TxOutcome;
    try {
      outcome = await this.prisma.$transaction<TxOutcome>(
        async (tx) => {
          const rows = await tx.$queryRaw<LockedSessionRow[]>`
            SELECT id, uuid, media_asset_id, owner_type, status::text AS status,
                   total_size_bytes, bytes_received, content_type, expires_at
            FROM media_upload_sessions
            WHERE id = ${sessionId}
            FOR UPDATE
          `;
          const s = rows[0];
          if (!s) throw new NotFoundException('SESSION_NOT_FOUND');

          const asset = await tx.mediaAsset.findUniqueOrThrow({
            where: { id: s.media_asset_id },
            select: { id: true, uuid: true, processingStatus: true },
          });

          const statusPrefix =
            s.owner_type === 'PLATFORM' ? '/platform/media' : '/school/media';
          const statusUrl = `${statusPrefix}/${asset.uuid}/status`;

          // Idempotent: الطلب المكرر (أو المتزامن الذي انتظر القفل) يرى COMPLETED
          if (s.status === MediaUploadStatus.COMPLETED) {
            return {
              kind: 'done',
              result: {
                asset_uuid: asset.uuid,
                media_asset_uuid: asset.uuid,
                processing_status: asset.processingStatus,
                status_url: statusUrl,
                already_completed: true,
              },
            };
          }
          if (s.status === MediaUploadStatus.CANCELED) {
            throw new ConflictException('SESSION_CANCELED');
          }
          if (s.expires_at < new Date()) {
            throw new GoneException('SESSION_EXPIRED');
          }

          const expected = s.total_size_bytes ? Number(s.total_size_bytes) : 0;
          const received = Number(s.bytes_received);
          if (expected <= 0 || received !== expected) {
            throw new BadRequestException({
              error: 'INCOMPLETE_UPLOAD',
              bytes_received: received,
              total_size_bytes: expected,
            });
          }

          // مصالحة حجم الملف الفعلي على القرص مع العداد الملتزم به في DB قبل الفحص
          if (typeof this.storage.reconcileTempFile === 'function') {
            await this.storage.reconcileTempFile(s.uuid, expected);
          }

          // الحجم الفعلي على القرص يجب أن يطابق المعلن
          const tempPath = this.storage.getTempPath(s.uuid);
          const actualSize = await fs.promises
            .stat(tempPath)
            .then((st) => st.size)
            .catch(() => -1);
          if (actualSize !== expected) {
            throw new ConflictException({
              error:
                actualSize < 0 ? 'TEMP_FILE_MISSING' : 'FILE_SIZE_MISMATCH',
              expected_bytes: expected,
              actual_bytes: Math.max(actualSize, 0),
            });
          }

          // الفحص السداسي — عند الرفض تُعلَّم الجلسة CANCELED والأصل isDeleted داخل نفس قفل المعاملة
          const probe = await this.ffprobe.probe(tempPath);
          if (!probe.valid || !probe.info) {
            const now = new Date();
            await tx.mediaUploadSession.updateMany({
              where: { id: s.id, status: { not: MediaUploadStatus.COMPLETED } },
              data: {
                status: MediaUploadStatus.CANCELED,
                canceledAt: now,
                lastError: JSON.stringify({
                  stage: 'ffprobe',
                  errors: probe.errors,
                }).slice(0, 2000),
              },
            });
            await tx.mediaAsset.update({
              where: { id: s.media_asset_id },
              data: { isDeleted: true, deletedAt: now },
            });
            return { kind: 'rejected', errors: probe.errors, session: s };
          }
          const info = probe.info;
          const ext = this.validation.getExtFromContentType(s.content_type);
          const ladder = this.ffprobe.buildQualityLadder(info);
          const variantSpecs = this.ffprobe.buildQualityVariantSpecs(info);

          // rename ذرّي → video-staging (خارج نطاق cleanupExpiredSessions — W-064)
          const stagingKey = await this.storage.moveToVideoStaging(
            s.uuid,
            asset.uuid,
            ext,
          );
          movedToStaging = {
            sessionUuid: s.uuid,
            assetUuid: asset.uuid,
            ext,
          };
          try {
            await tx.mediaAsset.update({
              where: { id: asset.id },
              data: {
                storageKey: stagingKey,
                storageProvider: 'R2',
                processingStatus: ProcessingStatus.PROCESSING,
                width: info.width,
                height: info.height,
                durationSec: Math.ceil(info.durationSec),
                rowVersion: { increment: 1 },
              },
            });
            await tx.mediaUploadSession.update({
              where: { id: s.id },
              data: {
                status: MediaUploadStatus.COMPLETED,
                completedAt: new Date(),
                processingStatus: ProcessingStatus.PROCESSING,
              },
            });
            const idempotencyKey = `${TRANSCODE_VIDEO_JOB}:${asset.uuid}`;
            await tx.mediaProcessingJob.upsert({
              where: { idempotencyKey },
              create: {
                mediaAssetId: asset.id,
                jobType: TRANSCODE_VIDEO_JOB,
                status: 'PENDING',
                idempotencyKey,
                payloadJson: JSON.stringify({
                  assetUuid: asset.uuid,
                  ownerType: s.owner_type,
                  sourceKey: stagingKey,
                  contentType: s.content_type,
                  sizeBytes: expected,
                  probe: info,
                  qualityLadder: ladder,
                  variantSpecs,
                }),
                nextRetryAt: new Date(),
              },
              update: {},
            });
          } catch (err) {
            // تعويض: أعد الملف إلى مكانه حتى يمكن إعادة محاولة complete
            await this.restoreFromStaging(s.uuid, asset.uuid, ext);
            movedToStaging = null;
            throw err;
          }

          return {
            kind: 'done',
            result: {
              asset_uuid: asset.uuid,
              media_asset_uuid: asset.uuid,
              processing_status: ProcessingStatus.PROCESSING,
              status_url: statusUrl,
              already_completed: false,
            },
          };
        },
        { timeout: COMPLETE_TX_TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (err) {
      if (movedToStaging) {
        const currentStatus = await this.readSessionStatusFromDb(sessionId);
        // لا نعيد الملف من video-staging إلا إذا تأكدنا أن معاملة الإكمال تراجعت فعلاً ولم تصبح COMPLETED
        if (
          currentStatus !== null &&
          currentStatus !== MediaUploadStatus.COMPLETED
        ) {
          await this.restoreFromStaging(
            movedToStaging.sessionUuid,
            movedToStaging.assetUuid,
            movedToStaging.ext,
          );
        }
      }
      throw err;
    }

    if (outcome.kind === 'done') return outcome.result;

    // فشل ffprobe (422): الجلسة أُلغيت داخل معاملة القفل؛ نحذف ملف .part المؤقت الآن
    await this.storage.deleteTempFile(outcome.session.uuid);
    const hasCodecError = outcome.errors.some((e) =>
      e.startsWith('UNSUPPORTED_VIDEO_CODEC'),
    );
    throw new HttpException(
      {
        error: hasCodecError ? 'UNSUPPORTED_VIDEO_CODEC' : 'INVALID_VIDEO',
        code: 'VIDEO_VALIDATION_FAILED',
        details: outcome.errors,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private async readSessionStatusFromDb(
    sessionId: number,
  ): Promise<MediaUploadStatus | null> {
    try {
      if (typeof this.prisma.$queryRaw === 'function') {
        const rows = await this.prisma.$queryRaw<Array<{ status: string }>>`
          SELECT status::text AS status
          FROM media_upload_sessions
          WHERE id = ${sessionId}
        `;
        if (rows[0]?.status) {
          return rows[0].status as MediaUploadStatus;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async restoreFromStaging(
    sessionUuid: string,
    assetUuid: string,
    ext: string,
  ): Promise<void> {
    try {
      await fs.promises.rename(
        this.storage.getVideoStagingPath(assetUuid, ext),
        this.storage.getTempPath(sessionUuid),
      );
      await this.storage.deleteVideoStagingDir(assetUuid);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `تعذّر إعادة ملف الفيديو من staging للأصل ${assetUuid}: ${msg}`,
      );
    }
  }
}

/** نوع مساعد للاختبارات */
export type VideoTx = Prisma.TransactionClient;
