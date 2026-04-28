// src/platform/media/platform-media-upload.service.ts
import {
    Injectable, Logger,
    NotFoundException, BadRequestException,
    ConflictException, GoneException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { MediaProcessingService } from '../../shared/media/media-processing.service';

enum MediaKind { IMAGE = 'IMAGE', AUDIO = 'AUDIO' }
enum MediaUploadStatus { INITIATED = 'INITIATED', UPLOADING = 'UPLOADING', COMPLETED = 'COMPLETED', CANCELED = 'CANCELED' }
enum ProcessingStatus { PENDING = 'PENDING', PROCESSING = 'PROCESSING', DONE = 'DONE', ERROR = 'ERROR' }

/**
 * 📤 خدمة رفع وسائط المنصة
 * نفس منطق school لكن:
 * - ownerType = 'PLATFORM'
 * - schoolId = null
 * - storage key: platform/{assetUuid}/{variant}.{ext}
 */
@Injectable()
export class PlatformMediaUploadService {
    private readonly logger = new Logger(PlatformMediaUploadService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
        private readonly processing: MediaProcessingService,
    ) {}

    /**
     * ① Init upload session
     */
    async initSession(dto: {
        kind: string;
        contentType: string;
        totalSizeBytes: number;
        chunkSizeBytes?: number;
    }, platformUserId: number) {
        const kind = dto.kind as MediaKind;

        if (!this.isContentTypeValidForKind(dto.contentType, kind)) {
            throw new BadRequestException('INVALID_CONTENT_TYPE_FOR_KIND');
        }

        const chunkSize = dto.chunkSizeBytes || 1024 * 1024; // 1MB default
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        // Create placeholder asset
        const asset = await this.prisma.mediaAsset.create({
            data: {
                kind,
                ownerType: 'PLATFORM',
                schoolId: null,
                contentType: dto.contentType,
                sizeBytes: BigInt(dto.totalSizeBytes),
                processingStatus: 'PENDING',
            },
        });

        const tempKey = this.storage.getTempPath(asset.uuid);

        // Create upload session
        const session = await this.prisma.mediaUploadSession.create({
            data: {
                mediaAssetId: asset.id,
                schoolId: null,
                ownerType: 'PLATFORM',
                platformUserId,
                kind,
                contentType: dto.contentType,
                totalSizeBytes: BigInt(dto.totalSizeBytes),
                chunkSizeBytes: chunkSize,
                expiresAt,
                tempStorageKey: tempKey,
            },
        });

        return {
            upload_session_uuid: session.uuid,
            media_asset_uuid: asset.uuid,
            chunk_size_bytes: chunkSize,
            expires_at: expiresAt.toISOString(),
        };
    }

    /**
     * ② Probe Session (for resume)
     */
    async probeSession(sessionUuid: string) {
        const session = await this.getSession(sessionUuid);

        if (session.expiresAt < new Date() && session.status !== MediaUploadStatus.COMPLETED) {
            throw new GoneException('SESSION_EXPIRED');
        }

        return {
            upload_session_uuid: session.uuid,
            status: session.status,
            bytes_received: Number(session.bytesReceived),
            total_size_bytes: session.totalSizeBytes ? Number(session.totalSizeBytes) : null,
            chunk_size_bytes: session.chunkSizeBytes,
            processing_status: session.processingStatus,
            media_asset_uuid: session.mediaAsset.uuid,
            expires_at: session.expiresAt.toISOString(),
        };
    }

    /**
     * ③ Upload Chunk
     */
    async uploadChunk(
        sessionUuid: string,
        contentRange: string,
        chunk: Buffer,
    ) {
        const session = await this.getSession(sessionUuid);

        if (session.status === MediaUploadStatus.COMPLETED) {
            throw new ConflictException('SESSION_ALREADY_COMPLETED');
        }
        if (session.status === MediaUploadStatus.CANCELED) {
            throw new ConflictException('SESSION_CANCELED');
        }
        if (session.expiresAt < new Date()) {
            throw new GoneException('SESSION_EXPIRED');
        }

        const rangeMatch = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!rangeMatch) {
            throw new BadRequestException('INVALID_CONTENT_RANGE');
        }

        const start = parseInt(rangeMatch[1], 10);
        const currentBytesReceived = Number(session.bytesReceived);

        if (start !== currentBytesReceived) {
            throw new ConflictException({
                error: 'OUT_OF_ORDER',
                bytes_received: currentBytesReceived,
                next_expected_byte: currentBytesReceived,
            });
        }

        await this.storage.appendToTemp(session.uuid, chunk);

        const newBytesReceived = currentBytesReceived + chunk.length;
        await this.prisma.mediaUploadSession.update({
            where: { id: session.id },
            data: {
                bytesReceived: BigInt(newBytesReceived),
                lastChunkAt: new Date(),
                status: MediaUploadStatus.UPLOADING,
            },
        });

        return {
            bytes_received: newBytesReceived,
            next_expected_byte: newBytesReceived,
        };
    }

    /**
     * ④ Complete Session
     */
    async completeSession(sessionUuid: string) {
        const session = await this.getSession(sessionUuid);

        if (session.status === MediaUploadStatus.COMPLETED) {
            return {
                media_asset_uuid: session.mediaAsset.uuid,
                processing_status: session.processingStatus || ProcessingStatus.DONE,
            };
        }

        const expected = session.totalSizeBytes ? Number(session.totalSizeBytes) : 0;
        const received = Number(session.bytesReceived);

        if (expected > 0 && received < expected) {
            throw new BadRequestException({
                error: 'INCOMPLETE_UPLOAD',
                bytes_received: received,
                total_size_bytes: expected,
            });
        }

        // Storage key: platform/{assetUuid}/{variant}.{ext}
        const ext = this.getExtFromContentType(session.contentType);
        const originalStorageKey = this.storage.buildStorageKey(
            'platform', session.mediaAsset.uuid, 'original', ext,
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

        // Trigger processing pipeline (async)
        this.processing.processAsset(
            session.mediaAssetId,
            'platform',  // pseudo schoolUuid for storage path
            session.mediaAsset.uuid,
            originalStorageKey,
            session.kind,
            session.contentType,
        ).catch(err => {
            this.logger.error(`Background processing failed for ${session.mediaAsset.uuid}:`, err);
        });

        return {
            media_asset_uuid: session.mediaAsset.uuid,
            processing_status: 'PROCESSING',
        };
    }

    /**
     * ⑤ Cancel Session
     */
    async cancelSession(sessionUuid: string) {
        const session = await this.getSession(sessionUuid);

        await this.storage.deleteTempFile(session.uuid);

        await this.prisma.mediaUploadSession.update({
            where: { id: session.id },
            data: {
                status: MediaUploadStatus.CANCELED,
                canceledAt: new Date(),
            },
        });

        await this.prisma.mediaAsset.update({
            where: { id: session.mediaAssetId },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        return { status: 'CANCELED' };
    }

    // ── Helpers ──

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

    private getExtFromContentType(contentType: string): string {
        const map: Record<string, string> = {
            'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
            'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
            'audio/wav': 'wav', 'audio/mp4': 'm4a',
        };
        return map[contentType] || 'bin';
    }

    private isContentTypeValidForKind(contentType: string, kind: MediaKind): boolean {
        const allowedPrefixes: Record<string, string> = {
            IMAGE: 'image/',
            AUDIO: 'audio/',
        };
        const prefix = allowedPrefixes[kind];
        return prefix ? contentType.startsWith(prefix) : false;
    }
}
