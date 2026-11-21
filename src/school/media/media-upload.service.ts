// src/school/media/media-upload.service.ts
// ═══════════════════════════════════════════════════════════════
// 📤 VIDEO P4-3 — خدمة رفع الوسائط المدرسية
// ═══════════════════════════════════════════════════════════════
// - مسار IMAGE/AUDIO: السلوك الأصلي مع إغلاق ثغرات W-050 (إلغاء السقوط الصامت لحد AUDIO)
//   و W-057 (فحوصات السقف الخمسة للأجزاء) و W-063 (ملكية الجلسة) و W-064 (توحيد tempStorageKey).
// - مسار VIDEO: مفوّض بالكامل إلى VideoUploadService بالترتيب المعتمد (§4.3):
//   503 (VIDEO_UPLOAD_ENABLED) → 403 (صلاحية المعلم المسند) → 400 (الحجم/النوع) → 507 (statfs).
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaKind,
  MediaUploadStatus,
  Prisma,
  ProcessingStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { MediaProcessingService } from '../../shared/media/media-processing.service';
import { StorageService } from '../../shared/media/storage.service';
import { UploadValidationHelper } from '../../shared/media/upload-validation.helper';
import { VideoUploadService } from '../../shared/media/video-upload.service';
import { InitUploadSessionDto } from './dto/init-upload-session.dto';

const DEFAULT_CHUNK_SIZE = 1048576; // 1MB
const SESSION_EXPIRY_HOURS = 24;

/** المستخدم الحالي كما يحدده الـ Controller من JWT */
export interface SchoolUploadActor {
  userId: number;
  /** نوع المستخدم من JWT (ut): OWNER | ADMIN | TEACHER | STUDENT | PARENT */
  role: string;
}

@Injectable()
export class MediaUploadService {
  private readonly logger = new Logger(MediaUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly processing: MediaProcessingService,
    private readonly video: VideoUploadService,
    private readonly validation: UploadValidationHelper,
    private readonly accessPolicy: MediaAccessPolicyService,
  ) {}

  /**
   * ① Init Upload Session
   * - Creates MediaAsset (placeholder)
   * - Creates MediaUploadSession
   * - Prepares temp storage location
   */
  async initSession(
    dto: InitUploadSessionDto,
    schoolId: number,
    schoolUuid: string,
    actor: SchoolUploadActor,
  ) {
    if (dto.kind === MediaKind.VIDEO) {
      // §4.3: 503 (تعطيل الميزة) ← 403 (صلاحية الإسناد الفعلي) ← 400 (النوع/الحجم) ← 507 (statfs)
      this.video.assertFeatureEnabled();
      await this.accessPolicy.assertSchoolUploadAllowed(
        { userId: actor.userId, schoolId, role: actor.role },
        dto.kind,
        { subjectUuid: dto.subjectUuid, lessonUuid: dto.lessonUuid },
      );
      return this.video.initVideoSession({
        ownerType: 'SCHOOL',
        schoolId,
        uploaderUserId: actor.userId,
        platformUserId: null,
        contentType: dto.contentType,
        totalSizeBytes: dto.totalSizeBytes,
        chunkSizeBytes: dto.chunkSizeBytes,
      });
    }

    // W-050: فحص الحجم والنوع بدون سقوط صامت إلى AUDIO
    this.validation.validateFileSize(dto.totalSizeBytes, dto.kind);
    this.validation.validateContentType(dto.contentType, dto.kind, 'SCHOOL');

    const chunkSize = dto.chunkSizeBytes || DEFAULT_CHUNK_SIZE;
    const expiresAt = new Date(
      Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    // Create MediaAsset placeholder
    const asset = await this.prisma.mediaAsset.create({
      data: {
        schoolId,
        ownerType: 'SCHOOL',
        kind: dto.kind,
        contentType: dto.contentType,
        sizeBytes: BigInt(dto.totalSizeBytes),
        processingStatus: ProcessingStatus.PENDING,
      },
    });

    // W-064: tempStorageKey يطابق المسار الفعلي tmp/{sessionUuid}.part
    const sessionUuid = randomUUID();
    const tempKey = `tmp/${sessionUuid}.part`;

    // Create upload session
    const session = await this.prisma.mediaUploadSession.create({
      data: {
        uuid: sessionUuid,
        mediaAssetId: asset.id,
        schoolId,
        ownerType: 'SCHOOL',
        uploaderUserId: actor.userId,
        kind: dto.kind,
        contentType: dto.contentType,
        totalSizeBytes: BigInt(dto.totalSizeBytes),
        chunkSizeBytes: chunkSize,
        status: MediaUploadStatus.INITIATED,
        tempStorageKey: tempKey,
        expiresAt,
      },
    });

    return {
      upload_session_uuid: session.uuid,
      media_asset_uuid: asset.uuid,
      chunk_size_bytes: chunkSize,
      max_size_bytes: this.validation.getMaxSizeBytes(dto.kind),
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * ② Probe Session (for resume) — محمية بـ W-063 + مصالحة حجم الملف الفعلي
   */
  async probeSession(
    sessionUuid: string,
    schoolId: number,
    currentUserId: number,
  ) {
    const session = await this.getOwnedSession(
      sessionUuid,
      schoolId,
      currentUserId,
    );

    const reconciled = await this.validation.reconcileSessionOnProbe(
      this.prisma,
      this.storage,
      {
        id: session.id,
        uuid: session.uuid,
        mediaAssetId: session.mediaAssetId,
        kind: session.kind,
        status: session.status,
        expiresAt: session.expiresAt,
        bytesReceived: session.bytesReceived,
        totalSizeBytes: session.totalSizeBytes,
        chunkSizeBytes: session.chunkSizeBytes,
        processingStatus: session.processingStatus,
      },
    );

    return {
      upload_session_uuid: session.uuid,
      status: reconciled.status,
      bytes_received: Number(reconciled.bytesReceived),
      total_size_bytes: reconciled.totalSizeBytes
        ? Number(reconciled.totalSizeBytes)
        : null,
      chunk_size_bytes: reconciled.chunkSizeBytes,
      processing_status:
        reconciled.processingStatus ?? session.processingStatus,
      media_asset_uuid: session.mediaAsset.uuid,
      expires_at: reconciled.expiresAt.toISOString(),
    };
  }

  /**
   * ③ Upload Chunk — محمية بـ W-063 و W-057 + تسلسل ذرّي ومصالحة ملف القرص
   */
  async uploadChunk(
    sessionUuid: string,
    schoolId: number,
    contentRange: string,
    chunk: Buffer,
    currentUserId: number,
  ) {
    return this.validation.executeSerializedChunkUpload(
      this.prisma,
      this.storage,
      {
        uuid: sessionUuid,
        load: async () => {
          const session = await this.getOwnedSession(
            sessionUuid,
            schoolId,
            currentUserId,
          );
          return {
            id: session.id,
            uuid: session.uuid,
            mediaAssetId: session.mediaAssetId,
            kind: session.kind,
            status: session.status,
            expiresAt: session.expiresAt,
            bytesReceived: session.bytesReceived,
            totalSizeBytes: session.totalSizeBytes,
            chunkSizeBytes: session.chunkSizeBytes,
            processingStatus: session.processingStatus,
          };
        },
      },
      contentRange,
      chunk,
    );
  }

  /**
   * ④ Complete Session — محمية بـ W-063 وقفل تزامني كامل (withSessionLock + FOR UPDATE + File Recovery)
   * - VIDEO: VideoUploadService (FOR UPDATE + ffprobe + staging + TRANSCODE_VIDEO) → 202
   * - IMAGE/AUDIO: قفل ذرّي + فحص انتهاء الصلاحية + استعادة الملف المؤقت عند تراجع DB
   */
  async completeSession(
    sessionUuid: string,
    schoolId: number,
    schoolUuid: string,
    currentUserId: number,
  ) {
    return this.validation.withSessionLock(sessionUuid, async () => {
      const session = await this.getOwnedSession(
        sessionUuid,
        schoolId,
        currentUserId,
      );

      if (session.kind === MediaKind.VIDEO) {
        return this.video.completeVideoSession(session.id);
      }

      const initialSnapshot = {
        id: session.id,
        uuid: session.uuid,
        mediaAssetId: session.mediaAssetId,
        kind: session.kind,
        status: session.status,
        expiresAt: session.expiresAt,
        bytesReceived: session.bytesReceived,
        totalSizeBytes: session.totalSizeBytes,
        chunkSizeBytes: session.chunkSizeBytes,
        processingStatus: session.processingStatus,
      };

      type SchoolCompleteOutcome =
        | {
            kind: 'already_completed';
            response: { media_asset_uuid: string; processing_status: string };
          }
        | { kind: 'invalid_content'; detected: string | null }
        | {
            kind: 'completed';
            originalStorageKey: string;
            assetId: number;
            assetUuid: string;
            kindValue: MediaKind;
            contentType: string;
          };

      let movedToFinalKey: string | null = null;

      const runInTx = async (
        tx: Prisma.TransactionClient,
      ): Promise<SchoolCompleteOutcome> => {
        const locked =
          typeof this.validation.lockSessionRow === 'function'
            ? await this.validation.lockSessionRow(tx, initialSnapshot)
            : initialSnapshot;

        if (locked.status === MediaUploadStatus.COMPLETED) {
          let processingStatus =
            locked.processingStatus || ProcessingStatus.DONE;
          if (typeof tx.mediaAsset?.findUnique === 'function') {
            const freshAsset = await tx.mediaAsset.findUnique({
              where: { id: locked.mediaAssetId },
              select: { processingStatus: true },
            });
            if (freshAsset?.processingStatus) {
              processingStatus = freshAsset.processingStatus;
            }
          }
          return {
            kind: 'already_completed',
            response: {
              media_asset_uuid: session.mediaAsset.uuid,
              processing_status: processingStatus,
            },
          };
        }
        if (locked.status === MediaUploadStatus.CANCELED) {
          throw new ConflictException('SESSION_CANCELED');
        }
        if (locked.status === MediaUploadStatus.FAILED) {
          throw new ConflictException('SESSION_FAILED');
        }
        if (locked.expiresAt < new Date()) {
          throw new GoneException('SESSION_EXPIRED');
        }

        const expected = locked.totalSizeBytes
          ? Number(locked.totalSizeBytes)
          : 0;
        const received = Number(locked.bytesReceived);

        if (expected > 0 && received < expected) {
          throw new BadRequestException({
            error: 'INCOMPLETE_UPLOAD',
            bytes_received: received,
            total_size_bytes: expected,
          });
        }

        const ext = this.validation.getExtFromContentType(session.contentType);
        const originalStorageKey = this.storage.buildStorageKey(
          schoolUuid,
          session.mediaAsset.uuid,
          'original',
          ext,
        );

        if (
          expected > 0 &&
          typeof this.storage.recoverOrphanFinalToTempIfNeeded === 'function'
        ) {
          await this.storage.recoverOrphanFinalToTempIfNeeded(
            locked.uuid,
            originalStorageKey,
            expected,
          );
        }

        if (
          expected > 0 &&
          typeof this.storage.reconcileTempFile === 'function'
        ) {
          await this.storage.reconcileTempFile(locked.uuid, expected);
        }

        // SEC-MEDIA-04 + SEC-MED-04: التحقق من المحتوى الحقيقي تحت القفل بدون تعامل متداخل
        if (typeof this.validation.sniffUploadedContentForKind === 'function') {
          const sniff = await this.validation.sniffUploadedContentForKind(
            this.storage,
            { uuid: locked.uuid, kind: locked.kind },
          );
          if (!sniff.ok) {
            await tx.mediaUploadSession.update({
              where: { id: locked.id },
              data: {
                status: MediaUploadStatus.FAILED,
                processingStatus: ProcessingStatus.ERROR,
              },
            });
            await tx.mediaAsset.update({
              where: { id: locked.mediaAssetId },
              data: { processingStatus: ProcessingStatus.ERROR },
            });
            return { kind: 'invalid_content', detected: sniff.detected };
          }
        } else {
          await this.validation.assertUploadedContentMatchesKind(
            this.prisma,
            this.storage,
            {
              id: locked.id,
              uuid: locked.uuid,
              mediaAssetId: locked.mediaAssetId,
              kind: locked.kind,
            },
          );
        }

        if (locked.expiresAt < new Date()) {
          throw new GoneException('SESSION_EXPIRED');
        }

        await this.storage.moveToFinal(locked.uuid, originalStorageKey);
        movedToFinalKey = originalStorageKey;

        try {
          const completedAt = new Date();
          if (typeof tx.mediaUploadSession.updateMany === 'function') {
            const updated = await tx.mediaUploadSession.updateMany({
              where: {
                id: locked.id,
                status: {
                  in: [MediaUploadStatus.INITIATED, MediaUploadStatus.UPLOADING],
                },
              },
              data: {
                status: MediaUploadStatus.COMPLETED,
                completedAt,
                processingStatus: ProcessingStatus.PROCESSING,
              },
            });
            if (updated.count !== 1) {
              throw new ConflictException('CONCURRENT_SESSION_STATE_CHANGED');
            }
          } else {
            await tx.mediaUploadSession.update({
              where: { id: locked.id },
              data: {
                status: MediaUploadStatus.COMPLETED,
                completedAt,
                processingStatus: ProcessingStatus.PROCESSING,
              },
            });
          }

          await tx.mediaAsset.update({
            where: { id: locked.mediaAssetId },
            data: {
              storageKey: originalStorageKey,
              updatedAt: completedAt,
            },
          });
        } catch (dbErr) {
          if (typeof this.storage.restoreFromFinal === 'function') {
            await this.storage.restoreFromFinal(locked.uuid, originalStorageKey);
          }
          movedToFinalKey = null;
          throw dbErr;
        }

        return {
          kind: 'completed',
          originalStorageKey,
          assetId: locked.mediaAssetId,
          assetUuid: session.mediaAsset.uuid,
          kindValue: locked.kind,
          contentType: session.contentType,
        };
      };

      let outcome: SchoolCompleteOutcome;
      try {
        if (typeof this.prisma.$transaction === 'function') {
          outcome = await this.prisma.$transaction(runInTx, {
            timeout: 30_000,
            maxWait: 10_000,
          });
        } else {
          outcome = await runInTx(
            this.prisma as unknown as Prisma.TransactionClient,
          );
        }
      } catch (err) {
        if (
          movedToFinalKey &&
          typeof this.storage.restoreFromFinal === 'function'
        ) {
          const dbStatus =
            typeof this.validation.readSessionStatusFromDb === 'function'
              ? await this.validation.readSessionStatusFromDb(
                  this.prisma,
                  session.id,
                )
              : null;
          if (dbStatus !== MediaUploadStatus.COMPLETED) {
            await this.storage.restoreFromFinal(session.uuid, movedToFinalKey);
          }
        }
        throw err;
      }

      if (outcome.kind === 'invalid_content') {
        await this.storage.deleteTempFile(session.uuid).catch(() => undefined);
        throw new UnprocessableEntityException({
          error: 'UNSUPPORTED_MEDIA_CONTENT',
          kind: session.kind,
          detected: outcome.detected,
          message: 'محتوى الملف لا يطابق نوعه المعلن أو أنه صيغة غير مدعومة',
        });
      }

      if (outcome.kind === 'already_completed') {
        return outcome.response;
      }

      // Trigger processing pipeline (async — don't block response)
      this.processing
        .processAsset(
          outcome.assetId,
          schoolUuid,
          outcome.assetUuid,
          outcome.originalStorageKey,
          outcome.kindValue,
          outcome.contentType,
        )
        .catch((err) => {
          this.logger.error(
            `Background processing failed for ${outcome.assetUuid}:`,
            err,
          );
        });

      return {
        media_asset_uuid: outcome.assetUuid,
        processing_status: 'PROCESSING',
      };
    });
  }

  /**
   * ⑤ Cancel Session — محمية بـ W-063 + قفل الجلسة الكامل (withSessionLock + FOR UPDATE)
   */
  async cancelSession(
    sessionUuid: string,
    schoolId: number,
    currentUserId: number,
  ) {
    return this.validation.executeSerializedCancelSession(
      this.prisma,
      this.storage,
      {
        uuid: sessionUuid,
        load: async () => {
          const session = await this.getOwnedSession(
            sessionUuid,
            schoolId,
            currentUserId,
          );
          return {
            id: session.id,
            uuid: session.uuid,
            mediaAssetId: session.mediaAssetId,
            kind: session.kind,
            status: session.status,
            expiresAt: session.expiresAt,
            bytesReceived: session.bytesReceived,
            totalSizeBytes: session.totalSizeBytes,
            chunkSizeBytes: session.chunkSizeBytes,
            processingStatus: session.processingStatus,
          };
        },
      },
    );
  }

  // ── Helpers ──

  /** جلب الجلسة ضمن المدرسة + فحص ملكيتها (W-063) */
  private async getOwnedSession(
    sessionUuid: string,
    schoolId: number,
    currentUserId: number,
  ) {
    const session = await this.getSession(sessionUuid, schoolId);
    this.validation.assertSessionOwnerSchool(
      session.uploaderUserId,
      currentUserId,
    );
    return session;
  }

  private async getSession(sessionUuid: string, schoolId: number) {
    const session = await this.prisma.mediaUploadSession.findFirst({
      where: { uuid: sessionUuid, schoolId, ownerType: 'SCHOOL' },
      include: { mediaAsset: { select: { id: true, uuid: true } } },
    });

    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    return session;
  }
}
