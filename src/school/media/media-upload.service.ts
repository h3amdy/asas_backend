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
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaKind, MediaUploadStatus, ProcessingStatus } from '@prisma/client';
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
   * ④ Complete Session — محمية بـ W-063
   * - VIDEO: VideoUploadService (FOR UPDATE + ffprobe + staging + TRANSCODE_VIDEO) → 202
   * - IMAGE/AUDIO: السلوك الأصلي (move + processing)
   */
  async completeSession(
    sessionUuid: string,
    schoolId: number,
    schoolUuid: string,
    currentUserId: number,
  ) {
    const session = await this.getOwnedSession(
      sessionUuid,
      schoolId,
      currentUserId,
    );

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

      // Validate bytes
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

      // Determine extension and move temp → original
      const ext = this.validation.getExtFromContentType(session.contentType);
      const originalStorageKey = this.storage.buildStorageKey(
        schoolUuid,
        session.mediaAsset.uuid,
        'original',
        ext,
      );

      await this.storage.moveToFinal(session.uuid, originalStorageKey);

      // Update session
      await this.prisma.mediaUploadSession.update({
        where: { id: session.id },
        data: {
          status: MediaUploadStatus.COMPLETED,
          completedAt: new Date(),
          processingStatus: ProcessingStatus.PROCESSING,
        },
      });

      // Update asset storage key
      await this.prisma.mediaAsset.update({
        where: { id: session.mediaAssetId },
        data: {
          storageKey: originalStorageKey,
          updatedAt: new Date(),
        },
      });

      // Trigger processing pipeline (async — don't block response)
      this.processing
        .processAsset(
          session.mediaAssetId,
          schoolUuid,
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
  async cancelSession(
    sessionUuid: string,
    schoolId: number,
    currentUserId: number,
  ) {
    const session = await this.getOwnedSession(
      sessionUuid,
      schoolId,
      currentUserId,
    );

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
