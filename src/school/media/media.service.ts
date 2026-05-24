// src/school/media/media.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';

/**
 * 📦 خدمة الوسائط الأساسية
 * - جلب metadata
 * - تقديم الملفات للتنزيل
 */
@Injectable()
export class MediaService {
    private readonly logger = new Logger(MediaService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
    ) { }

    /**
     * Get asset by UUID (scoped to school)
     */
    async getAsset(assetUuid: string, schoolId: number) {
        this.logger.log(`[DEBUG] getAsset called: uuid=${assetUuid}, schoolId=${schoolId}`);
        
        const asset = await this.prisma.mediaAsset.findFirst({
            where: {
                uuid: assetUuid,
                isDeleted: false,
                OR: [
                    { schoolId, ownerType: 'SCHOOL' },
                    { ownerType: 'PLATFORM' },
                ],
            },
        });

        if (!asset) {
            // Debug: check if asset exists at all (ignoring filters)
            const anyAsset = await this.prisma.mediaAsset.findFirst({
                where: { uuid: assetUuid },
                select: { id: true, uuid: true, ownerType: true, schoolId: true, isDeleted: true, kind: true },
            });
            this.logger.warn(`[DEBUG] ASSET_NOT_FOUND. Raw lookup: ${JSON.stringify(anyAsset)}`);
            throw new NotFoundException('ASSET_NOT_FOUND');
        }

        this.logger.log(`[DEBUG] Asset found: id=${asset.id}, ownerType=${asset.ownerType}, kind=${asset.kind}`);
        return asset;
    }

    /**
     * Get asset metadata for client (used by /meta endpoint)
     */
    async getAssetMeta(assetUuid: string, schoolId: number) {
        const asset = await this.getAsset(assetUuid, schoolId);

        const variants = asset.variantsJson ? JSON.parse(asset.variantsJson) : {};

        // Strip storage_key from variant data (client should not know internal paths)
        const clientVariants: Record<string, any> = {};
        for (const [key, val] of Object.entries(variants)) {
            const v = val as any;
            clientVariants[key] = {
                etag: v.etag,
                size_bytes: v.size_bytes,
                content_type: v.content_type,
                width: v.width,
                height: v.height,
            };
        }

        return {
            asset_uuid: asset.uuid,
            kind: asset.kind,
            content_type: asset.contentType,
            variants: clientVariants,
            processing_status: asset.processingStatus,
            updated_at: asset.updatedAt,
        };
    }

    /**
     * Resolve variant storage key for download
     */
    async resolveVariantStorageKey(assetUuid: string, schoolId: number, variant: string): Promise<{
        storageKey: string;
        etag: string;
        contentType: string;
        sizeBytes: number;
    }> {
        const asset = await this.getAsset(assetUuid, schoolId);

        if (!asset.variantsJson) {
            throw new NotFoundException('VARIANTS_NOT_READY');
        }

        const variants = JSON.parse(asset.variantsJson);
        const variantData = variants[variant];

        if (!variantData) {
            // Fallback: try default variant based on kind
            const defaultVariant = asset.kind === 'IMAGE' ? 'medium'
                : asset.kind === 'DOCUMENT' ? 'original'
                : 'low';
            const fallback = variants[defaultVariant] || variants['original'];
            if (!fallback) {
                throw new NotFoundException(`VARIANT_NOT_FOUND: ${variant}`);
            }
            return {
                storageKey: fallback.storage_key,
                etag: fallback.etag,
                contentType: fallback.content_type || asset.contentType,
                sizeBytes: fallback.size_bytes || 0,
            };
        }

        return {
            storageKey: variantData.storage_key,
            etag: variantData.etag,
            contentType: variantData.content_type || asset.contentType,
            sizeBytes: variantData.size_bytes || 0,
        };
    }

    /**
     * Soft-delete an asset
     */
    async softDeleteAsset(assetUuid: string, schoolId: number) {
        const asset = await this.getAsset(assetUuid, schoolId);
        return this.prisma.mediaAsset.update({
            where: { id: asset.id },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                rowVersion: { increment: 1 },
            },
        });
    }
}
