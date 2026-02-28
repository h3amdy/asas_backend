// src/school/media/media-upload.service.ts
import {
    Injectable, NotFoundException, ConflictException, GoneException,
    BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { MediaProcessingService } from './media-processing.service';
import { MediaKind, MediaUploadStatus, ProcessingStatus } from '@prisma/client';
import { InitUploadSessionDto } from './dto/init-upload-session.dto';

const DEFAULT_CHUNK_SIZE = 1048576; // 1MB
const SESSION_EXPIRY_HOURS = 24;

/** Per-kind max file size (bytes) */
const MAX_FILE_SIZE: Record<string, number> = {
    IMAGE: 20_971_520,  // 20MB
    AUDIO: 52_428_800,  // 50MB
};

@Injectable()
export class MediaUploadService {
    private readonly logger = new Logger(MediaUploadService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
        private readonly processing: MediaProcessingService,
    ) { }

    /**
     * ① Init Upload Session
     * - Creates MediaAsset (placeholder)
     * - Creates MediaUploadSession
     * - Prepares temp storage location
     */
    async initSession(dto: InitUploadSessionDto, schoolId: number, schoolUuid: string, uploaderUserId: number) {
        // Validate per-kind file size limit
        const maxSize = MAX_FILE_SIZE[dto.kind] || MAX_FILE_SIZE['AUDIO'];
        if (dto.totalSizeBytes > maxSize) {
            throw new BadRequestException({
                error: 'FILE_TOO_LARGE',
                max_size_bytes: maxSize,
                kind: dto.kind,
            });
        }

        const chunkSize = dto.chunkSizeBytes || DEFAULT_CHUNK_SIZE;
        const expiresAt = new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000);

        // Create MediaAsset placeholder
        const asset = await this.prisma.mediaAsset.create({
            data: {
                schoolId,
                kind: dto.kind,
                contentType: dto.contentType,
                sizeBytes: BigInt(dto.totalSizeBytes),
                processingStatus: ProcessingStatus.PENDING,
            },
        });

        // Temp storage key
        const tempKey = `tmp/${asset.uuid}.part`;

        // Create upload session
        const session = await this.prisma.mediaUploadSession.create({
            data: {
                mediaAssetId: asset.id,
                schoolId,
                uploaderUserId,
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
            expires_at: expiresAt.toISOString(),
        };
    }

    /**
     * ② Probe Session (for resume)
     */
    async probeSession(sessionUuid: string, schoolId: number) {
        const session = await this.getSession(sessionUuid, schoolId);

        // Check expiry
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
     * - Validates Content-Range
     * - Appends to temp file
     * - Updates bytes_received
     */
    async uploadChunk(
        sessionUuid: string,
        schoolId: number,
        contentRange: string,
        chunk: Buffer,
    ) {
        const session = await this.getSession(sessionUuid, schoolId);

        // Validate session state
        if (session.status === MediaUploadStatus.COMPLETED) {
            throw new ConflictException('SESSION_ALREADY_COMPLETED');
        }
        if (session.status === MediaUploadStatus.CANCELED) {
            throw new ConflictException('SESSION_CANCELED');
        }
        if (session.expiresAt < new Date()) {
            throw new GoneException('SESSION_EXPIRED');
        }

        // Parse Content-Range: bytes <start>-<end>/<total>
        const rangeMatch = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!rangeMatch) {
            throw new BadRequestException('INVALID_CONTENT_RANGE');
        }

        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        const total = parseInt(rangeMatch[3], 10);

        const currentBytesReceived = Number(session.bytesReceived);

        // Validate: start must equal bytes_received (sequential chunks only)
        if (start !== currentBytesReceived) {
            // Return 409 with current position for client to resync
            throw new ConflictException({
                error: 'OUT_OF_ORDER',
                bytes_received: currentBytesReceived,
                next_expected_byte: currentBytesReceived,
            });
        }

        // Write chunk to temp file
        await this.storage.appendToTemp(session.uuid, chunk);

        // Update session
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
     * - Validates all bytes received
     * - Moves temp to original location
     * - Triggers processing pipeline
     */
    async completeSession(sessionUuid: string, schoolId: number, schoolUuid: string) {
        const session = await this.getSession(sessionUuid, schoolId);

        if (session.status === MediaUploadStatus.COMPLETED) {
            return {
                media_asset_uuid: session.mediaAsset.uuid,
                processing_status: session.processingStatus || ProcessingStatus.DONE,
            };
        }

        // Validate bytes
        const expected = session.totalSizeBytes ? Number(session.totalSizeBytes) : 0;
        const received = Number(session.bytesReceived);

        if (expected > 0 && received < expected) {
            throw new BadRequestException({
                error: 'INCOMPLETE_UPLOAD',
                bytes_received: received,
                total_size_bytes: expected,
            });
        }

        // Determine extension and move temp → original
        const ext = this.getExtFromContentType(session.contentType);
        const originalStorageKey = this.storage.buildStorageKey(
            schoolUuid, session.mediaAsset.uuid, 'original', ext,
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
        this.processing.processAsset(
            session.mediaAssetId,
            schoolUuid,
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
    async cancelSession(sessionUuid: string, schoolId: number) {
        const session = await this.getSession(sessionUuid, schoolId);

        // Cleanup temp file
        await this.storage.deleteTempFile(session.uuid);

        // Update session
        await this.prisma.mediaUploadSession.update({
            where: { id: session.id },
            data: {
                status: MediaUploadStatus.CANCELED,
                canceledAt: new Date(),
            },
        });

        // Soft-delete the placeholder asset
        await this.prisma.mediaAsset.update({
            where: { id: session.mediaAssetId },
            data: { isDeleted: true, deletedAt: new Date() },
        });

        return { status: 'CANCELED' };
    }

    // ── Helpers ──

    private async getSession(sessionUuid: string, schoolId: number) {
        const session = await this.prisma.mediaUploadSession.findFirst({
            where: { uuid: sessionUuid, schoolId },
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
}
