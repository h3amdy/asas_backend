// src/platform/media/platform-media.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { MediaAsset } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { R2StorageProvider } from '../../shared/media/r2-storage.provider';
import { StorageService } from '../../shared/media/storage.service';
import {
  buildMediaAssetStatusResponse,
  buildSanitizedVariantsMap,
  generateMediaDownloadUrlResponse,
  MediaAssetStatusResponse,
  MediaDownloadUrlResponse,
} from '../../shared/media/video-delivery.helper';
import { VideoMediaConfig } from '../../shared/media/video-media.config';

/**
 * 📦 خدمة وسائط المنصة — بدون school_id (ownerType = 'PLATFORM' فقط)
 */
@Injectable()
export class PlatformMediaService {
  private readonly logger = new Logger(PlatformMediaService.name);
  private readonly accessPolicy: MediaAccessPolicyService;
  private readonly videoConfig: VideoMediaConfig;
  private readonly r2Storage: R2StorageProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() accessPolicy?: MediaAccessPolicyService,
    @Optional() videoConfig?: VideoMediaConfig,
    @Optional() r2Storage?: R2StorageProvider,
  ) {
    this.accessPolicy = accessPolicy ?? new MediaAccessPolicyService(prisma);
    this.videoConfig = videoConfig ?? new VideoMediaConfig();
    this.r2Storage = r2Storage ?? new R2StorageProvider(this.videoConfig);
  }

  /**
   * Get asset by UUID (platform scope — ownerType === 'PLATFORM' && !isDeleted)
   */
  async getAsset(assetUuid: string): Promise<MediaAsset> {
    return this.accessPolicy.getAccessiblePlatformAsset(assetUuid);
  }

  /**
   * GET /platform/media/:uuid/status — حالة معالجة الأصل والجودات الجاهزة والمخططة دون تسريب مسارات التخزين.
   */
  async getAssetStatus(
    assetUuid: string,
    preloadedAsset?: MediaAsset,
  ): Promise<MediaAssetStatusResponse> {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid));
    return buildMediaAssetStatusResponse(this.prisma, asset);
  }

  /**
   * GET /platform/media/:uuid/download-url?variant=... — توليد رابط موقّع من R2 لأصول المنصة.
   */
  async getDownloadUrl(
    assetUuid: string,
    variant?: string,
    actorLabel = 'platform-user',
    preloadedAsset?: MediaAsset,
  ): Promise<MediaDownloadUrlResponse> {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid));
    return generateMediaDownloadUrlResponse({
      asset,
      requestedVariant: variant,
      r2Storage: this.r2Storage,
      videoConfig: this.videoConfig,
      logger: this.logger,
      actorLabel,
    });
  }

  /**
   * Get asset metadata for client
   */
  async getAssetMeta(assetUuid: string, preloadedAsset?: MediaAsset) {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid));
    const clientVariants = buildSanitizedVariantsMap(
      asset.kind,
      asset.variantsJson,
    );

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
   * Resolve variant storage key for local download
   */
  async resolveVariantStorageKey(
    assetUuid: string,
    variant: string,
    preloadedAsset?: MediaAsset,
  ): Promise<{
    storageKey: string;
    etag: string;
    contentType: string;
    sizeBytes: number;
  }> {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid));

    if (!asset.variantsJson) {
      throw new NotFoundException('VARIANTS_NOT_READY');
    }

    const variants = JSON.parse(asset.variantsJson) as Record<
      string,
      {
        storage_key: string;
        etag: string;
        content_type?: string;
        size_bytes?: number;
      }
    >;
    const variantData = variants[variant];

    if (!variantData) {
      const defaultVariant =
        asset.kind === 'IMAGE'
          ? 'medium'
          : asset.kind === 'DOCUMENT'
            ? 'original'
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
}
