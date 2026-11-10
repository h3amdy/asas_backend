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
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaKind, MediaUploadStatus, ProcessingStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { InitUploadSessionDto } from '../../school/media/dto/init-upload-session.dto';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { MediaProcessingService } from '../../shared/media/media-processing.service';
import { StorageService } from '../../shared/media/storage.service';
import { UploadValidationHelper } from '../../shared/media/upload-validation.helper';
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
   * ④ Complete Session — محمية بـ W-063
   */
  async completeSession(sessionUuid: string, actor: PlatformUploadActor) {
    const session = await this.getOwnedSession(sessionUuid, actor);

    return this.validation.withSessionLock(session.uuid, async () => {
      if (session.kind === MediaKind.VIDEO) {
        return this.video.completeVideoSession(session.id);
      }

      if (session.status === MediaUploadStatus.COMPLETED) {
        return {
          media_asset_uuid: session.mediaAsset.uuid,
          processing_status: session.processingStatus || ProcessingStatus.DONE,
        };
      }

      const expected = session.totalSizeBytes
        ? Number(session.totalSizeBytes)
        : 0;
      const received = Number(session.bytesReceived);

      if (expected > 0 && received < expected) {
        throw new BadRequestException({
          error: 'INCOMPLETE_UPLOAD',
          bytes_received: received,
          total_size_bytes: expected,
        });
      }

      if (
        expected > 0 &&
        typeof this.storage.reconcileTempFile === 'function'
      ) {
        await this.storage.reconcileTempFile(session.uuid, expected);
      }

      // Storage key: platform/{assetUuid}/{variant}.{ext}
      const ext = this.validation.getExtFromContentType(session.contentType);
      const originalStorageKey = this.storage.buildStorageKey(
        'platform',
        session.mediaAsset.uuid,
        'original',
        ext,
      );

      await this.storage.moveToFinal(session.uuid, originalStorageKey);

      await this.prisma.mediaUploadSession.update({
        where: { id: session.id },
        data: {
          status: MediaUploadStatus.COMPLETED,
          completedAt: new Date(),
          processingStatus: ProcessingStatus.PROCESSING,
        },
      });

      await this.prisma.mediaAsset.update({
        where: { id: session.mediaAssetId },
        data: {
          storageKey: originalStorageKey,
          updatedAt: new Date(),
        },
      });

      // DOCUMENT (PDF) — لا يحتاج processing، يكتمل فوراً
      if (session.kind === MediaKind.DOCUMENT) {
        const filePath = this.storage.resolvePath(originalStorageKey);
        const fileBuffer = await fs.promises.readFile(filePath);
        const etag = `"${createHash('sha256').update(fileBuffer).digest('hex').substring(0, 32)}"`;

        const variantsJson = JSON.stringify({
          original: {
            storage_key: originalStorageKey,
            etag: etag,
            size_bytes: fileBuffer.length,
            content_type: session.contentType,
          },
        });

        await this.prisma.mediaUploadSession.update({
          where: { id: session.id },
          data: { processingStatus: ProcessingStatus.DONE },
        });
        await this.prisma.mediaAsset.update({
          where: { id: session.mediaAssetId },
          data: {
            processingStatus: ProcessingStatus.DONE,
            variantsJson: variantsJson,
            sizeBytes: BigInt(fileBuffer.length),
            etag: etag,
          },
        });
        return {
          media_asset_uuid: session.mediaAsset.uuid,
          processing_status: 'DONE',
        };
      }

      // Trigger processing pipeline (async) — IMAGE/AUDIO فقط
      this.processing
        .processAsset(
          session.mediaAssetId,
          'platform',
          session.mediaAsset.uuid,
          originalStorageKey,
          session.kind,
          session.contentType,
        )
        .catch((err) => {
          this.logger.error(
            `Background processing failed for ${session.mediaAsset.uuid}:`,
            err,
          );
        });

      return {
        media_asset_uuid: session.mediaAsset.uuid,
        processing_status: 'PROCESSING',
      };
    });
  }

  /**
   * ⑤ Cancel Session — محمية بـ W-063 + تسلسل قفل الجلسة
   */
  async cancelSession(sessionUuid: string, actor: PlatformUploadActor) {
    const session = await this.getOwnedSession(sessionUuid, actor);

    return this.validation.executeSerializedCancelSession(
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
