// src/shared/media/video-delivery.helper.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-5b — دوال التسليم المشتركة (حالة المعالجة، تنقية النسخ، والروابط الموقّعة)
// مرجع: docs/features/video/06-VIDEO-API-001.md (§3.4, §3.5, §7, §8)
//        docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §4.3)
// ═══════════════════════════════════════════════════════════════

import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { MediaAsset } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JobStepState,
  parseJobStepState,
} from './queue/media-job-queue.service';
import { R2StorageProvider } from './r2-storage.provider';
import { VideoMediaConfig } from './video-media.config';
import {
  parseVariantsManifest,
  TranscodeJobPayload,
} from './worker/video-transcode.processor';

export interface SanitizedVariantMeta {
  etag: string | null;
  size_bytes: number;
  sha256?: string;
  content_type: string;
  width?: number;
  height?: number;
}

export interface MediaAssetStatusResponse {
  asset_uuid: string;
  kind: string;
  processing_status: string;
  variants_ready: string[];
  variants_planned: string[];
  preferred_variant: string | null;
  duration_sec: number | null;
  error_code: string | null;
}

export interface MediaDownloadUrlResponse {
  url: string;
  expires_at: string;
  variant: string;
  size_bytes: number;
  sha256: string;
  etag: string | null;
  content_type: string;
}

/**
 * يستخرج قائمة الجودات والبيانات الوصفية الآمنة للعميل من variants_json
 * مع تجريد كافة المسارات الداخلية (storage_key, source, verified_at) بالكامل.
 */
export function buildSanitizedVariantsMap(
  kind: string,
  variantsJson: string | null,
): Record<string, SanitizedVariantMeta> {
  if (!variantsJson) return {};

  if (kind === 'VIDEO') {
    const manifest = parseVariantsManifest(variantsJson);
    if (!manifest) return {};

    const clientVariants: Record<string, SanitizedVariantMeta> = {};
    for (const [tier, rec] of Object.entries(manifest.variants)) {
      if (rec && rec.status === 'VERIFIED') {
        clientVariants[tier] = {
          etag: rec.etag ?? null,
          size_bytes: rec.size_bytes,
          sha256: rec.sha256,
          content_type: 'video/mp4',
          width: rec.width,
          height: rec.height,
        };
      }
    }

    if (manifest.thumb && manifest.thumb.status === 'VERIFIED') {
      clientVariants.thumb = {
        etag: manifest.thumb.etag ?? null,
        size_bytes: manifest.thumb.size_bytes,
        sha256: manifest.thumb.sha256,
        content_type: 'image/webp',
      };
    }

    return clientVariants;
  }

  try {
    const parsed = JSON.parse(variantsJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const clientVariants: Record<string, SanitizedVariantMeta> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const v = val as Record<string, unknown>;
        clientVariants[key] = {
          etag: typeof v.etag === 'string' ? v.etag : null,
          size_bytes: typeof v.size_bytes === 'number' ? v.size_bytes : 0,
          content_type:
            typeof v.content_type === 'string' ? v.content_type : '',
          width: typeof v.width === 'number' ? v.width : undefined,
          height: typeof v.height === 'number' ? v.height : undefined,
        };
      }
    }
    return clientVariants;
  } catch {
    return {};
  }
}

/**
 * يستخرج رمز خطأ نظيف وآمن للعرض من رسالة خطأ المهمة دون تسريب أي مسارات داخلية.
 */
function extractSafeErrorCode(lastError: string | null | undefined): string {
  if (!lastError) return 'TRANSCODE_FAILED';
  const bracketMatch = lastError.match(/\[([A-Z0-9_]{3,64})\]/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }
  const codeMatch = lastError.match(/^([A-Z0-9_]{3,64}):/);
  if (codeMatch?.[1]) {
    return codeMatch[1];
  }
  return 'TRANSCODE_FAILED';
}

/**
 * يبني استجابة GET /{school|platform}/media/:uuid/status بدون أي مفاتيح تخزين داخلية.
 */
export async function buildMediaAssetStatusResponse(
  prisma: PrismaService,
  asset: MediaAsset,
): Promise<MediaAssetStatusResponse> {
  if (String(asset.kind) !== 'VIDEO') {
    const sanitized = buildSanitizedVariantsMap(asset.kind, asset.variantsJson);
    const keys = Object.keys(sanitized);
    return {
      asset_uuid: asset.uuid,
      kind: asset.kind,
      processing_status: asset.processingStatus,
      variants_ready: keys,
      variants_planned: keys,
      preferred_variant: asset.preferredVariant ?? null,
      duration_sec: asset.durationSec ?? null,
      error_code:
        String(asset.processingStatus) === 'ERROR' ? 'PROCESSING_FAILED' : null,
    };
  }

  if (asset.variantsJson && asset.variantsJson.trim() !== '') {
    const manifest = parseVariantsManifest(asset.variantsJson);
    const planned = manifest.quality_ladder.map((h) => `${h}p`);
    const ready = Object.entries(manifest.variants)
      .filter(([, rec]) => rec?.status === 'VERIFIED')
      .map(([tier]) => tier);

    return {
      asset_uuid: asset.uuid,
      kind: asset.kind,
      processing_status: asset.processingStatus,
      variants_ready: ready,
      variants_planned: planned,
      preferred_variant:
        asset.preferredVariant ?? manifest.preferred_variant ?? null,
      duration_sec: asset.durationSec ?? null,
      error_code: null,
    };
  }

  // أثناء PENDING / PROCESSING / ERROR قبل كتابة variants_json النهائي: نقرأ التقدم من أحدث مهمة TRANSCODE_VIDEO
  const latestJob = await prisma.mediaProcessingJob.findFirst({
    where: {
      mediaAssetId: asset.id,
      jobType: 'TRANSCODE_VIDEO',
    },
    orderBy: { id: 'desc' },
    select: {
      payloadJson: true,
      stepStateJson: true,
      lastError: true,
    },
  });

  let variantsPlanned: string[] = [];
  if (latestJob?.payloadJson) {
    try {
      const payload = JSON.parse(latestJob.payloadJson) as TranscodeJobPayload;
      if (Array.isArray(payload.qualityLadder)) {
        variantsPlanned = payload.qualityLadder.map((h) => `${h}p`);
      }
    } catch {
      variantsPlanned = [];
    }
  }

  const stepState = parseJobStepState(
    latestJob?.stepStateJson ?? null,
  ) as JobStepState & {
    variants?: Record<string, string | boolean>;
  };
  const verifiedMap: Record<string, string | boolean> =
    stepState.variants_verified ?? stepState.variants ?? {};
  const variantsReady = Object.entries(verifiedMap)
    .filter(([, val]) => val === true || val === 'VERIFIED')
    .map(([tier]) => tier);

  const errorCode =
    String(asset.processingStatus) === 'ERROR'
      ? extractSafeErrorCode(latestJob?.lastError)
      : null;

  return {
    asset_uuid: asset.uuid,
    kind: asset.kind,
    processing_status: asset.processingStatus,
    variants_ready: variantsReady,
    variants_planned: variantsPlanned,
    preferred_variant: asset.preferredVariant ?? null,
    duration_sec: asset.durationSec ?? null,
    error_code: errorCode,
  };
}

/**
 * يبني استجابة GET /{school|platform}/media/:uuid/download-url?variant=...
 * مع تطبيق جميع حراس الجاهزية والجودة وتوليد رابط R2 موقّع محلياً دون تسجيل الرابط في أي سجل.
 */
export async function generateMediaDownloadUrlResponse(params: {
  asset: MediaAsset;
  requestedVariant?: string;
  r2Storage: R2StorageProvider;
  videoConfig: VideoMediaConfig;
  logger: Logger;
  actorLabel: string;
}): Promise<MediaDownloadUrlResponse> {
  const {
    asset,
    requestedVariant,
    r2Storage,
    videoConfig,
    logger,
    actorLabel,
  } = params;

  if (asset.storageProvider !== 'R2') {
    throw new BadRequestException({
      error: 'DIRECT_STREAM_ASSET',
      message:
        'هذا الوسيط مخزّن محلياً ويُنزَّل عبر مسار التنزيل المباشر وليس عبر download-url',
    });
  }

  if (String(asset.processingStatus) !== 'DONE') {
    throw new ConflictException({
      error: 'NOT_READY',
      processing_status: asset.processingStatus,
      message: 'الفيديو لا يزال قيد المعالجة أو غير جاهز للتنزيل',
    });
  }

  if (!asset.variantsJson || asset.variantsJson.trim() === '') {
    throw new ConflictException({
      error: 'NOT_READY',
      processing_status: asset.processingStatus,
      message: 'بيانات نسخ الفيديو غير جاهزة بعد',
    });
  }

  const manifest = parseVariantsManifest(asset.variantsJson);

  const availableVariants: string[] = [
    ...Object.keys(manifest.variants).filter(
      (tier) => manifest.variants[tier]?.status === 'VERIFIED',
    ),
    ...(manifest.thumb?.status === 'VERIFIED' ? ['thumb'] : []),
  ];

  const targetVariant =
    (requestedVariant ?? '').trim() ||
    asset.preferredVariant ||
    manifest.preferred_variant ||
    availableVariants[0] ||
    '360p';

  let storageKey: string;
  let sizeBytes: number;
  let sha256: string;
  let etag: string | null;
  let contentType: string;

  if (targetVariant === 'thumb' && manifest.thumb?.status === 'VERIFIED') {
    storageKey = manifest.thumb.storage_key;
    sizeBytes = manifest.thumb.size_bytes;
    sha256 = manifest.thumb.sha256;
    etag = manifest.thumb.etag ?? null;
    contentType = 'image/webp';
  } else if (manifest.variants[targetVariant]?.status === 'VERIFIED') {
    const rec = manifest.variants[targetVariant];
    storageKey = rec.storage_key;
    sizeBytes = rec.size_bytes;
    sha256 = rec.sha256;
    etag = rec.etag ?? null;
    contentType = 'video/mp4';
  } else {
    throw new BadRequestException({
      error: 'INVALID_VARIANT',
      available_variants: availableVariants,
      message: `الجودة المطلوبة (${targetVariant}) غير متوفرة لهذا الفيديو`,
    });
  }

  const ttlSec = videoConfig.r2PresignedGetTtlSeconds;
  const signed = await r2Storage.getPresignedGetUrl(storageKey, ttlSec);

  // ⚠️ قاعدة أمنية صارمة: لا نسجّل signed.url ولا storageKey في أي سجل أبداً
  logger.log(
    `🔗 [DownloadUrl] صدر رابط موقّع: actor=${actorLabel}, asset=${asset.uuid}, variant=${targetVariant}, ttl=${ttlSec}s`,
  );

  return {
    url: signed.url,
    expires_at: signed.expiresAt.toISOString(),
    variant: targetVariant,
    size_bytes: sizeBytes,
    sha256,
    etag,
    content_type: contentType,
  };
}

/**
 * حارس W-049 لنقاط التنزيل المباشر القديمة GET /{school|platform}/media/:uuid:
 * يرفض الأصول المخزنة على R2 بـ 409 USE_DOWNLOAD_URL مع إرشاد العميل إلى نقطة download-url.
 */
export function assertNotR2DirectStreamAsset(
  asset: Pick<MediaAsset, 'uuid' | 'storageProvider'>,
  endpointPrefix: '/school/media' | '/platform/media',
): void {
  if (asset.storageProvider === 'R2') {
    throw new ConflictException({
      error: 'USE_DOWNLOAD_URL',
      download_url_endpoint: `${endpointPrefix}/${asset.uuid}/download-url`,
    });
  }
}
