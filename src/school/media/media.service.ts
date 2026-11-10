// src/school/media/media.service.ts
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
 * 📦 خدمة الوسائط الأساسية — المدارس
 * - عزل القراءة S4 (ملكية المدرسة أو توزيع نشط أو درس مستنسخ Policy A)
 * - جلب حالة المعالجة (/status) والبيانات الوصفية (/meta) والروابط الموقّعة (/download-url)
 * - تقديم الملفات المحلية للتنزيل المباشر
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
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
   * جلب الأصل مع فرض عزل القراءة S4 (يرمي 404 ASSET_NOT_FOUND عند عدم الوجود أو الحذف أو خارج نطاق المدرسة/التوزيع).
   */
  async getAsset(assetUuid: string, schoolId: number): Promise<MediaAsset> {
    return this.accessPolicy.getAccessibleSchoolAsset(assetUuid, schoolId);
  }

  /**
   * SRS-SUB-005 §8.0 — هل الأصل مرتبط بمحتوى تعليمي محمي؟
   *
   * نعيد `true` إذا كان الأصل مرتبطاً بأي من:
   *   - محتوى درس (LessonContent / LessonBlockItem)
   *   - كتاب (SchoolBook PDF أو غلاف)
   *   - أسئلة (Question / QuestionOption / MatchingPair / OrderingItem)
   *
   * الشعارات والصور الرمزية وأغلفة المواد → لا.
   *
   * P4-5 Hardening (F-P45-04): أي أصل VIDEO تعليمي بطبيعته (الفيديو لا يُربط إلا بعناصر الدرس)،
   * فلا يُتجاوز فحص الاشتراك لفيديو جاهز لم يُربط بعد. لا يتغير سلوك IMAGE/AUDIO/DOCUMENT.
   */
  async isEducationalAsset(assetId: number, kind?: string): Promise<boolean> {
    if (kind !== undefined && String(kind) === 'VIDEO') return true;

    const inLesson = await this.prisma.lessonContent.findFirst({
      where: { mediaAssetId: assetId, isDeleted: false },
      select: { id: true },
    });
    if (inLesson) return true;

    const inBlock = await this.prisma.lessonBlockItem.findFirst({
      where: { mediaAssetId: assetId, isDeleted: false },
      select: { id: true },
    });
    if (inBlock) return true;

    const inBook = await this.prisma.schoolBook.findFirst({
      where: {
        isDeleted: false,
        OR: [{ pdfMediaAssetId: assetId }, { coverMediaAssetId: assetId }],
      },
      select: { id: true },
    });
    if (inBook) return true;

    const inQuestion = await this.prisma.question.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { explanationAudioAssetId: assetId },
          { explanationImageAssetId: assetId },
          { questionAudioAssetId: assetId },
          { questionImageAssetId: assetId },
        ],
      },
      select: { id: true },
    });
    if (inQuestion) return true;

    const inOption = await this.prisma.questionOption.findFirst({
      where: {
        isDeleted: false,
        OR: [{ audioAssetId: assetId }, { imageAssetId: assetId }],
      },
      select: { id: true },
    });
    if (inOption) return true;

    const inPair = await this.prisma.questionMatchingPair.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { leftAudioAssetId: assetId },
          { leftImageAssetId: assetId },
          { rightAudioAssetId: assetId },
          { rightImageAssetId: assetId },
        ],
      },
      select: { id: true },
    });
    if (inPair) return true;

    const inOrdering = await this.prisma.questionOrderingItem.findFirst({
      where: {
        isDeleted: false,
        OR: [{ audioAssetId: assetId }, { imageAssetId: assetId }],
      },
      select: { id: true },
    });
    if (inOrdering) return true;

    return false;
  }

  /**
   * GET /school/media/:uuid/status — حالة معالجة الأصل والجودات الجاهزة والمخططة دون تسريب مسارات التخزين.
   */
  async getAssetStatus(
    assetUuid: string,
    schoolId: number,
    preloadedAsset?: MediaAsset,
  ): Promise<MediaAssetStatusResponse> {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid, schoolId));
    return buildMediaAssetStatusResponse(this.prisma, asset);
  }

  /**
   * GET /school/media/:uuid/download-url?variant=... — توليد رابط موقّع من R2 بعد التحقق من الجاهزية والجودة.
   */
  async getDownloadUrl(
    assetUuid: string,
    schoolId: number,
    variant?: string,
    actorLabel = 'school-user',
    preloadedAsset?: MediaAsset,
  ): Promise<MediaDownloadUrlResponse> {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid, schoolId));
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
   * Get asset metadata for client (used by /meta endpoint)
   */
  async getAssetMeta(
    assetUuid: string,
    schoolId: number,
    preloadedAsset?: MediaAsset,
  ) {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid, schoolId));
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
    schoolId: number,
    variant: string,
    preloadedAsset?: MediaAsset,
  ): Promise<{
    storageKey: string;
    etag: string;
    contentType: string;
    sizeBytes: number;
  }> {
    const asset = preloadedAsset ?? (await this.getAsset(assetUuid, schoolId));

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
