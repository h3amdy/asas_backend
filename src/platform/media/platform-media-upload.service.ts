// src/platform/media/platform-media-upload.service.ts
// ═══════════════════════════════════════════════════════════════
// 📤 VIDEO P4-3 — خدمة رفع وسائط المنصة
// ═══════════════════════════════════════════════════════════════
// الإصلاحات والتوسعات:
//   - W-058: إزالة enum MediaKind المحلي المكرر واستيراد الأنواع من @prisma/client،
//     وفرض حدود الحجم حسب النوع في المنصة كما في المدرسة.
//   - W-057: فحوصات السقف الخمسة للأجزاء في uploadChunk قبل الكتابة في /storage/tmp.
//   - W-063: التحقق من ملكية الجلسة (أو PLATFORM_ADMIN) في probe/chunks/complete/cancel.
//   - W-064: توحيد tempStorageKey ليطابق tmp/{sessionUuid}.part وعزل video-staging.
//   - VIDEO: مفوّض إلى VideoUploadService بالترتيب المعتمد (503 ← 403 ← 400 ← 507).
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
import { InitUploadSessionDto } from '../../school/media/dto/init-upload-session.dto';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { computeFileDigest } from '../../shared/media/file-digest.util';
import {
  MediaProcessingService,
  PLATFORM_OWNER_ID,
} from '../../shared/media/media-processing.service';
import { R2StorageProvider } from '../../shared/media/r2-storage.provider';
import { StorageService } from '../../shared/media/storage.service';
import { UploadValidationHelper } from '../../shared/media/upload-validation.helper';
import { VideoMediaConfig } from '../../shared/media/video-media.config';
import { VideoUploadService } from '../../shared/media/video-upload.service';

const DEFAULT_CHUNK_SIZE = 1048576; // 1MB
const SESSION_EXPIRY_HOURS = 24;

export interface PlatformUploadActor {
  platformUserId: number;
  role: string; // PLATFORM_ADMIN | PLATFORM_TEACHER
}

@Injectable()
export class PlatformMediaUploadService {
  private readonly logger = new Logger(PlatformMediaUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly processing: MediaProcessingService,
    private readonly video: VideoUploadService,
    private readonly validation: UploadValidationHelper,
    private readonly accessPolicy: MediaAccessPolicyService,
    private readonly config: VideoMediaConfig,
    private readonly r2Storage: R2StorageProvider,
  ) {}

  /**
   * ① Init upload session
   */
  async initSession(dto: InitUploadSessionDto, actor: PlatformUploadActor) {
    const kind = dto.kind;

    if (kind === MediaKind.VIDEO) {
      // §4.3: 503 ← 403 (PLATFORM_ADMIN أو PLATFORM_TEACHER مسند) ← 400 ← 507
      this.video.assertFeatureEnabled();
      await this.accessPolicy.assertPlatformUploadAllowed(
        { platformUserId: actor.platformUserId, role: actor.role },
        kind,
        { subjectUuid: dto.subjectUuid, lessonUuid: dto.lessonUuid },
      );
      return this.video.initVideoSession({
        ownerType: 'PLATFORM',
        schoolId: null,
        uploaderUserId: null,
        platformUserId: actor.platformUserId,
        contentType: dto.contentType,
        totalSizeBytes: dto.totalSizeBytes,
        chunkSizeBytes: dto.chunkSizeBytes,
      });
    }

    // W-058: فحص الحجم ونوع المحتوى في المنصة
    this.validation.validateFileSize(dto.totalSizeBytes, kind);
    this.validation.validateContentType(dto.contentType, kind, 'PLATFORM');

    const chunkSize = dto.chunkSizeBytes || DEFAULT_CHUNK_SIZE;
    const expiresAt = new Date(
      Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    // Create placeholder asset
    const asset = await this.prisma.mediaAsset.create({
      data: {
        kind,
        ownerType: 'PLATFORM',
        schoolId: null,
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
        schoolId: null,
        ownerType: 'PLATFORM',
        platformUserId: actor.platformUserId,
        kind,
        contentType: dto.contentType,
        totalSizeBytes: BigInt(dto.totalSizeBytes),
        chunkSizeBytes: chunkSize,
        status: MediaUploadStatus.INITIATED,
        expiresAt,
        tempStorageKey: tempKey,
      },
    });

    return {
      upload_session_uuid: session.uuid,
      media_asset_uuid: asset.uuid,
      chunk_size_bytes: chunkSize,
      max_size_bytes: this.validation.getMaxSizeBytes(kind),
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * ② Probe Session (for resume) — محمية بـ W-063 + مصالحة حجم الملف الفعلي
   */
  async probeSession(sessionUuid: string, actor: PlatformUploadActor) {
    const session = await this.getOwnedSession(sessionUuid, actor);

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
    contentRange: string,
    chunk: Buffer,
    actor: PlatformUploadActor,
  ) {
    return this.validation.executeSerializedChunkUpload(
      this.prisma,
      this.storage,
      {
        uuid: sessionUuid,
        load: async () => {
          const session = await this.getOwnedSession(sessionUuid, actor);
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
   */
  async completeSession(sessionUuid: string, actor: PlatformUploadActor) {
    return this.validation.withSessionLock(sessionUuid, async () => {
      const session = await this.getOwnedSession(sessionUuid, actor);

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

      type PlatformCompleteOutcome =
        | {
            kind: 'already_completed';
            response: { media_asset_uuid: string; processing_status: string };
          }
        | { kind: 'invalid_content'; detected: string | null }
        | {
            kind: 'completed';
            originalStorageKey: string;
            sessionId: number;
            assetId: number;
            assetUuid: string;
            kindValue: MediaKind;
            contentType: string;
          };

      let movedToFinalKey: string | null = null;

      const runInTx = async (
        tx: Prisma.TransactionClient,
      ): Promise<PlatformCompleteOutcome> => {
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
          'platform',
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
          sessionId: locked.id,
          assetId: locked.mediaAssetId,
          assetUuid: session.mediaAsset.uuid,
          kindValue: locked.kind,
          contentType: session.contentType,
        };
      };

      let outcome: PlatformCompleteOutcome;
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

      const originalStorageKey = outcome.originalStorageKey;

      // DOCUMENT (PDF) — لا يحتاج processing، يكتمل فوراً
      if (outcome.kindValue === MediaKind.DOCUMENT) {
        const filePath = this.storage.resolvePath(originalStorageKey);
        // SEC-MEDIA-07: البصمة بالتدفق بدل تحميل الـ PDF كاملاً في الذاكرة
        const digest = await computeFileDigest(filePath);
        const etag = `"${digest.sha256Hex.substring(0, 32)}"`;

        // بناء variants ككائن أولاً لإمكانية إثرائه بحالة التحقق بعد R2
        const variantData: Record<string, any> = {
          original: {
            storage_key: originalStorageKey,
            etag: etag,
            size_bytes: digest.sizeBytes,
            sha256: digest.sha256Hex,
            content_type: outcome.contentType,
          },
        };

        // ── B6: رفع PDF إلى R2 إذا كان الهدف R2 ──
        const targetProvider = this.config.resolveTargetProvider(
          'DOCUMENT',
          'PLATFORM',
        );
        let storageProvider: 'LOCAL' | 'R2' = 'LOCAL';

        if (targetProvider === 'R2') {
          try {
            await this.r2Storage.uploadFromFile(filePath, originalStorageKey, {
              contentType: outcome.contentType,
              digest,
            });
            storageProvider = 'R2';
            // إثراء variant بحالة التحقق — مطلوب لـ resolveFlatR2Variant
            variantData.original.status = 'VERIFIED';
            variantData.original.verified_at = new Date().toISOString();
            this.logger.log(
              `R2 upload OK for PDF ${outcome.assetUuid} → ${originalStorageKey}`,
            );
          } catch (r2Error) {
            const msg =
              r2Error instanceof Error ? r2Error.message : String(r2Error);
            this.logger.warn(
              `R2 upload failed for PDF ${outcome.assetUuid}, keeping LOCAL: ${msg}`,
            );
            // يبقى LOCAL — fail-safe
          }
        }

        const variantsJson = JSON.stringify(variantData);

        await this.prisma.mediaUploadSession.update({
          where: { id: outcome.sessionId },
          data: { processingStatus: ProcessingStatus.DONE },
        });

        try {
          await this.prisma.mediaAsset.update({
            where: { id: outcome.assetId },
            data: {
              processingStatus: ProcessingStatus.DONE,
              variantsJson: variantsJson,
              sizeBytes: BigInt(digest.sizeBytes),
              etag: etag,
              storageProvider,
            },
          });
        } catch (dbError) {
          // فشل تحديث DB بعد نجاح رفع R2 → تنظيف R2 لمنع orphan objects
          if (storageProvider === 'R2') {
            this.logger.error(
              `DB update failed after R2 upload for PDF ${outcome.assetUuid}. Cleaning up R2 key.`,
            );
            try {
              await this.r2Storage.deleteObject(originalStorageKey);
            } catch (cleanupErr) {
              this.logger.error(
                `R2 cleanup failed for ${originalStorageKey}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
              );
            }
          }
          throw dbError;
        }

        return {
          media_asset_uuid: outcome.assetUuid,
          processing_status: 'DONE',
        };
      }

      // Trigger processing pipeline (async) — IMAGE/AUDIO فقط
      this.processing
        .processAsset(
          outcome.assetId,
          'platform',
          outcome.assetUuid,
          originalStorageKey,
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
  async cancelSession(sessionUuid: string, actor: PlatformUploadActor) {
    return this.validation.executeSerializedCancelSession(
      this.prisma,
      this.storage,
      {
        uuid: sessionUuid,
        load: async () => {
          const session = await this.getOwnedSession(sessionUuid, actor);
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

  private async getOwnedSession(
    sessionUuid: string,
    actor: PlatformUploadActor,
  ) {
    const session = await this.getSession(sessionUuid);
    this.validation.assertSessionOwnerPlatform(
      session.platformUserId,
      actor.platformUserId,
      actor.role === 'PLATFORM_ADMIN',
    );
    return session;
  }

  private async getSession(sessionUuid: string) {
    const session = await this.prisma.mediaUploadSession.findFirst({
      where: { uuid: sessionUuid, ownerType: 'PLATFORM' },
      include: { mediaAsset: { select: { id: true, uuid: true } } },
    });

    if (!session) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }

    return session;
  }
}
