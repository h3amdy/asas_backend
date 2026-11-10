// src/shared/media/video-media.config.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-1 & P4-4 — الإعدادات المركزية لميزة الفيديو + عزل R2 + إعدادات العامل
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §2.4)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════

import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageProviderName } from './object-storage.interface';

/** الحد الأقصى الافتراضي لحجم الفيديو الأصلي: 150MB عشري (D-P2-007) */
export const DEFAULT_VIDEO_MAX_SIZE_BYTES = 150_000_000;
/** حجم الجزء الافتراضي في الرفع المجزأ: 1MiB (D-P1-002) */
export const DEFAULT_VIDEO_CHUNK_SIZE_BYTES = 1_048_576;
/** أدنى حجم جزء — يطابق @Min(65536) في InitUploadSessionDto */
export const MIN_VIDEO_CHUNK_SIZE_BYTES = 65_536;
/** أقصى حجم جزء — حد Nginx client_max_body_size 50m */
export const MAX_VIDEO_CHUNK_SIZE_BYTES = 52_428_800;
/** سقف منطقي لحد الفيديو (Int32) لأن حقول الحجم في DTO أعداد صحيحة */
export const MAX_VIDEO_MAX_SIZE_BYTES = 2_147_483_647;
/** مهلة فحص ffprobe/ffmpeg عند الإقلاع */
const FFPROBE_CHECK_TIMEOUT_MS = 5_000;
const FFMPEG_CHECK_TIMEOUT_MS = 10_000;

// ── ثوابت العامل وحساب المساحة وسقوف المخرجات (P4-4 v1.7) ──

export const DEFAULT_WORKER_MIN_FREE_BYTES = 2_000_000_000; // 2 GB
export const DEFAULT_WORKER_LIVE_MIN_FREE_BYTES = 1_000_000_000; // 1 GB
export const DEFAULT_WORKER_MAX_VARIANT_BYTES = 600_000_000; // 600 MB
export const DEFAULT_VARIANT_CONTAINER_MARGIN_BYTES = 16_000_000; // 16 MB
export const DEFAULT_WORKER_LEASE_SEC = 900; // 15 minutes
export const DEFAULT_WORKER_HEARTBEAT_MS = 60_000; // 60 seconds
export const DEFAULT_WORKER_SWEEP_MS = 120_000; // 2 minutes
export const DEFAULT_WORKER_POLL_MS = 3_000; // 3 seconds
export const DEFAULT_WORKER_STALL_TIMEOUT_MS = 180_000; // 3 minutes
export const DEFAULT_FFMPEG_MAX_RUNTIME_MS = 2_700_000; // 45 minutes
export const DEFAULT_UPLOAD_MAX_DURATION_MS = 600_000; // 10 minutes
export const DEFAULT_R2_PRESIGNED_GET_TTL_SECONDS = 3_600; // 1 hour (D-R2-02)
/** VIDEO P4-6 (§9.2 الخطوة 4): مهلة الأمان بين الحذف الناعم وجدولة الحذف الفعلي */
export const DEFAULT_MEDIA_DELETE_GRACE_DAYS = 30;
/** VIDEO P4-6 (§9.3): مهلة الاحتفاظ بالأصل المرفوع غير المرتبط قبل وسمه للحذف */
export const DEFAULT_MEDIA_UNLINKED_ASSET_TTL_HOURS = 24;
/** VIDEO P4-6: الحد الأقصى لمحاولات مهمة DELETE_OBJECTS قبل FAILED (يبقى صف الأصل محفوظاً) */
export const DEFAULT_MEDIA_DELETE_MAX_ATTEMPTS = 10;

// ── إعدادات ضبط FFmpeg القابلة للتهيئة (VIDEO PERFORMANCE — chat339) ──
// القيم الافتراضية تطابق السلوك السابق تماماً (veryfast + خيط مشفّر واحد + خيط فلتر واحد
// + خيوط فك ترميز تلقائية) حتى لا يتغير شيء ما لم تُضبط المتغيرات صراحةً.

/** مسبقات libx264 المسموحة (قائمة بيضاء) */
export const ALLOWED_FFMPEG_PRESETS = [
  'veryfast',
  'faster',
  'fast',
  'medium',
] as const;
export type FfmpegPreset = (typeof ALLOWED_FFMPEG_PRESETS)[number];
export const DEFAULT_FFMPEG_PRESET: FfmpegPreset = 'veryfast';
/** خيوط مشفّر libx264 (-threads بعد -i) */
export const DEFAULT_FFMPEG_ENCODER_THREADS = 1;
/** خيوط الفلاتر scale/fps (-filter_threads) */
export const DEFAULT_FFMPEG_FILTER_THREADS = 1;
/** خيوط مفكّك الإدخال (-threads قبل -i)؛ 0 = تلقائي من ffmpeg (السلوك السابق) */
export const DEFAULT_FFMPEG_DECODE_THREADS = 0;
export const MAX_FFMPEG_THREADS = 8;
/** عدد مهام التحويل المتزامنة — مثبّت على 1 حالياً (التوازي غير معتمد بعد) */
export const DEFAULT_TRANSCODE_CONCURRENCY = 1;
export const MAX_TRANSCODE_CONCURRENCY = 1;

export interface FfmpegTuning {
  preset: FfmpegPreset;
  encoderThreads: number;
  filterThreads: number;
  /** 0 = تلقائي (لا يُمرَّر -threads قبل -i) */
  decodeThreads: number;
  transcodeConcurrency: number;
}

export type VideoQualityTier = '360p' | '480p' | '720p';

export interface VariantEncodingProfile {
  quality: VideoQualityTier;
  crf: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  audioBitrateKbps: number;
  /** المعدل التقديري المحافظ بالبايت/ثانية شاملاً +15% هامش التذبذب والحاوية (v1.7) */
  estimatedBytesPerSec: number;
  isFallback: boolean;
}

const STANDARD_PROFILES: Record<VideoQualityTier, VariantEncodingProfile> = {
  '360p': {
    quality: '360p',
    crf: 23,
    maxrateKbps: 800,
    bufsizeKbps: 1600,
    audioBitrateKbps: 128,
    estimatedBytesPerSec: 133_400, // ((800 + 128) * 1000 / 8) * 1.15
    isFallback: false,
  },
  '480p': {
    quality: '480p',
    crf: 23,
    maxrateKbps: 1400,
    bufsizeKbps: 2800,
    audioBitrateKbps: 128,
    estimatedBytesPerSec: 219_650, // ((1400 + 128) * 1000 / 8) * 1.15
    isFallback: false,
  },
  '720p': {
    quality: '720p',
    crf: 23,
    maxrateKbps: 2500,
    bufsizeKbps: 5000,
    audioBitrateKbps: 128,
    estimatedBytesPerSec: 377_775, // ((2500 + 128) * 1000 / 8) * 1.15
    isFallback: false,
  },
};

const FALLBACK_PROFILES: Record<VideoQualityTier, VariantEncodingProfile> = {
  '360p': {
    quality: '360p',
    crf: 28,
    maxrateKbps: 520,
    bufsizeKbps: 1040,
    audioBitrateKbps: 128,
    estimatedBytesPerSec: 93_150, // ((520 + 128) * 1000 / 8) * 1.15
    isFallback: true,
  },
  '480p': {
    quality: '480p',
    crf: 28,
    maxrateKbps: 900,
    bufsizeKbps: 1800,
    audioBitrateKbps: 128,
    estimatedBytesPerSec: 147_775, // ((900 + 128) * 1000 / 8) * 1.15
    isFallback: true,
  },
  '720p': {
    quality: '720p',
    crf: 28,
    maxrateKbps: 1600,
    bufsizeKbps: 3200,
    audioBitrateKbps: 128,
    estimatedBytesPerSec: 248_400, // ((1600 + 128) * 1000 / 8) * 1.15
    isFallback: true,
  },
};

export function getVariantEncodingProfile(
  quality: VideoQualityTier,
  isFallback = false,
): VariantEncodingProfile {
  const table = isFallback ? FALLBACK_PROFILES : STANDARD_PROFILES;
  return { ...table[quality] };
}

/**
 * الحجم التقديري المحافظ لمخرج الجودة (V_est) بالبايت — تقدير للفحص المسبق وليس ضماناً رياضياً مطلقاً.
 */
export function computeEstimatedVariantBytes(
  quality: VideoQualityTier,
  durationSec: number,
  isFallback = false,
): number {
  const dur = Math.max(1, Math.ceil(durationSec));
  const profile = getVariantEncodingProfile(quality, isFallback);
  return (
    Math.ceil(dur * profile.estimatedBytesPerSec) +
    DEFAULT_VARIANT_CONTAINER_MARGIN_BYTES
  );
}

/**
 * السقف التنفيذي الأقصى المسموح به فعلياً لحجم ملف الجودة (V_hard_cap):
 * min(maxVariantBytes, ceil(1.25 * V_est_standard))
 * يبقى هذا السقف ثابتاً حتى عند تفعيل المحاولة البديلة (fallback_profile[q] = true) وفق v1.7.
 */
export function computeHardVariantCapBytes(
  quality: VideoQualityTier,
  durationSec: number,
  maxVariantBytes: number = DEFAULT_WORKER_MAX_VARIANT_BYTES,
): number {
  const standardEst = computeEstimatedVariantBytes(quality, durationSec, false);
  return Math.min(maxVariantBytes, Math.ceil(1.25 * standardEst));
}

/**
 * المساحة الحرة المطلوبة على القرص قبل بدء ترميز الجودة (currentPartFileBytes = 0)
 * محسوبة على أساس أسوأ حجم مسموح (V_hard_cap):
 * max(minFreeFloorBytes, liveFloorBytes + 2 * V_hard_cap)
 */
export function computePreStepRequiredFreeBytes(
  quality: VideoQualityTier,
  durationSec: number,
  minFreeFloorBytes: number = DEFAULT_WORKER_MIN_FREE_BYTES,
  liveFloorBytes: number = DEFAULT_WORKER_LIVE_MIN_FREE_BYTES,
  maxVariantBytes: number = DEFAULT_WORKER_MAX_VARIANT_BYTES,
): number {
  const hardCap = computeHardVariantCapBytes(
    quality,
    durationSec,
    maxVariantBytes,
  );
  return Math.max(minFreeFloorBytes, liveFloorBytes + 2 * hardCap);
}

/**
 * المساحة الحرة المطلوبة أثناء عمل FFmpeg (حيث currentPartFileBytes مكتوبة ومخصومة مسبقاً من statfs):
 * liveFloorBytes + 2 * V_hard_cap - currentPartFileBytes
 * بدون احتساب مزدوج لـ currentPartFileBytes (v1.7).
 */
export function computeLiveRequiredFreeBytes(
  quality: VideoQualityTier,
  durationSec: number,
  currentPartFileBytes: number,
  liveFloorBytes: number = DEFAULT_WORKER_LIVE_MIN_FREE_BYTES,
  maxVariantBytes: number = DEFAULT_WORKER_MAX_VARIANT_BYTES,
): number {
  const hardCap = computeHardVariantCapBytes(
    quality,
    durationSec,
    maxVariantBytes,
  );
  const clampedWritten = Math.max(0, Math.min(hardCap, currentPartFileBytes));
  return liveFloorBytes + 2 * hardCap - clampedWritten;
}

/** متغيرات R2 الإلزامية عند تفعيل الفيديو */
export const REQUIRED_R2_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const;

export const AMBIENT_PROD_R2_ENV_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
] as const;

export const REQUIRED_R2_SANDBOX_ENV_VARS = [
  'R2_SANDBOX_ACCOUNT_ID',
  'R2_SANDBOX_ALLOWED_ACCOUNT_ID',
  'R2_SANDBOX_BUCKET_NAME',
  'R2_SANDBOX_ENDPOINT',
  'R2_SANDBOX_ACCESS_KEY_ID',
  'R2_SANDBOX_SECRET_ACCESS_KEY',
] as const;

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export interface VideoMediaSettings {
  uploadEnabled: boolean;
  maxSizeBytes: number;
  chunkSizeBytes: number;
  ffprobeBin: string;
}

export interface ParsedVideoMediaEnv {
  settings: VideoMediaSettings;
  /** null عند التعطيل أو عند نقص أي متغير */
  r2: R2Credentials | null;
  /** أسماء متغيرات R2 الناقصة (الأسماء فقط — لا قيم) */
  missingR2Vars: string[];
  warnings: string[];
  errors: string[];
}

/** خطأ إعدادات صريح يُفشل الإقلاع عند تفعيل الفيديو */
export class VideoMediaConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      '[VideoMediaConfig] VIDEO_UPLOAD_ENABLED=true لكن الإعدادات غير مكتملة — تم إيقاف الإقلاع:\n' +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'VideoMediaConfigError';
  }
}

type Env = Record<string, string | undefined>;

function isEnabled(raw: string | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'true';
}

/**
 * قراءة عدد صحيح موجب من متغير بيئة مع حدود دنيا/عليا.
 * - غير موجود/فارغ → القيمة الافتراضية دون أي رسالة.
 * - غير صالح → رسالة (تحذير عند التعطيل، خطأ عند التفعيل) + القيمة الافتراضية.
 */
function readBoundedInt(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    problems.push(
      `${name}="${trimmed}" ليس عدداً صحيحاً موجباً (سيُستخدم ${fallback}).`,
    );
    return fallback;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    problems.push(
      `${name}=${trimmed} خارج النطاق المسموح [${min}..${max}] (سيُستخدم ${fallback}).`,
    );
    return fallback;
  }
  return value;
}

/**
 * تحليل إعدادات ضبط FFmpeg من البيئة (دالة نقية قابلة للاختبار).
 * أي قيمة غير صالحة تُسجَّل في problems وتُستبدل بالقيمة الافتراضية الآمنة؛
 * ويُفشل validateWorkerStartup إقلاع العامل عند وجود أي مشكلة (Fail-Closed).
 */
export function parseFfmpegTuning(
  env: Env,
  problems: string[] = [],
): FfmpegTuning {
  const rawPreset = (env.VIDEO_FFMPEG_PRESET ?? '').trim().toLowerCase();
  let preset: FfmpegPreset = DEFAULT_FFMPEG_PRESET;
  if (rawPreset !== '') {
    if ((ALLOWED_FFMPEG_PRESETS as readonly string[]).includes(rawPreset)) {
      preset = rawPreset as FfmpegPreset;
    } else {
      problems.push(
        `VIDEO_FFMPEG_PRESET="${rawPreset}" غير مسموح (المسموح: ${ALLOWED_FFMPEG_PRESETS.join(', ')}؛ سيُستخدم ${DEFAULT_FFMPEG_PRESET}).`,
      );
    }
  }

  const encoderThreads = readBoundedInt(
    env,
    'VIDEO_FFMPEG_THREADS',
    DEFAULT_FFMPEG_ENCODER_THREADS,
    1,
    MAX_FFMPEG_THREADS,
    problems,
  );
  const filterThreads = readBoundedInt(
    env,
    'VIDEO_FFMPEG_FILTER_THREADS',
    DEFAULT_FFMPEG_FILTER_THREADS,
    1,
    MAX_FFMPEG_THREADS,
    problems,
  );
  const decodeThreads = readBoundedInt(
    env,
    'VIDEO_FFMPEG_DECODE_THREADS',
    DEFAULT_FFMPEG_DECODE_THREADS,
    0,
    MAX_FFMPEG_THREADS,
    problems,
  );
  const transcodeConcurrency = readBoundedInt(
    env,
    'VIDEO_TRANSCODE_CONCURRENCY',
    DEFAULT_TRANSCODE_CONCURRENCY,
    1,
    MAX_TRANSCODE_CONCURRENCY,
    problems,
  );

  return {
    preset,
    encoderThreads,
    filterThreads,
    decodeThreads,
    transcodeConcurrency,
  };
}

/**
 * حارس عزل بيئة اختبار R2 غير الإنتاجية (Fail-Closed Multi-Attribute Sandbox Guard — v1.7).
 * يرمي VideoMediaConfigError فوراً عند أي نقص أو غموض أو وجود متغيرات إنتاجية في البيئة.
 */
export function assertSafeR2SandboxEnvironment(
  env: Env = process.env,
): R2Credentials & { endpoint: string } {
  const problems: string[] = [];

  // 1. حظر وجود أي متغير إنتاجي R2_* في بيئة عملية الاختبار
  const presentProdVars = AMBIENT_PROD_R2_ENV_VARS.filter(
    (k) => (env[k] ?? '').trim() !== '',
  );
  if (presentProdVars.length > 0) {
    problems.push(
      `حارس العزل (Fail-Closed): وُجدت متغيرات R2 إنتاجية في بيئة الاختبار (${presentProdVars.join(', ')}). يجب تشغيل اختبار R2 Sandbox في بيئة معزولة تماماً عن متغيرات الإنتاج.`,
    );
  }

  // 2. التحقق من وجود جميع متغيرات R2_SANDBOX_* الستة وعدم كونها فارغة أو غامضة
  const placeholderValues = new Set([
    'undefined',
    'null',
    'changeme',
    'test',
    'placeholder',
    'your-account-id',
  ]);
  for (const key of REQUIRED_R2_SANDBOX_ENV_VARS) {
    const val = (env[key] ?? '').trim();
    if (!val || placeholderValues.has(val.toLowerCase())) {
      problems.push(`متغير البيئة الاختبارية ${key} مفقود أو غير صالح.`);
    }
  }

  if (problems.length > 0) {
    throw new VideoMediaConfigError(problems);
  }

  const accountId = env.R2_SANDBOX_ACCOUNT_ID!.trim();
  const allowedAccountId = env.R2_SANDBOX_ALLOWED_ACCOUNT_ID!.trim();
  const bucketName = env.R2_SANDBOX_BUCKET_NAME!.trim();
  const endpoint = env.R2_SANDBOX_ENDPOINT!.trim();
  const accessKeyId = env.R2_SANDBOX_ACCESS_KEY_ID!.trim();
  const secretAccessKey = env.R2_SANDBOX_SECRET_ACCESS_KEY!.trim();

  // 3. مطابقة معرف الحساب المسموح
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    problems.push(
      'R2_SANDBOX_ACCOUNT_ID يجب أن يكون معرف حساب سداسياً عشرياً من 32 محرفاً.',
    );
  }
  if (accountId !== allowedAccountId) {
    problems.push(
      'R2_SANDBOX_ACCOUNT_ID لا يطابق R2_SANDBOX_ALLOWED_ACCOUNT_ID المعتمد للاختبار.',
    );
  }

  // 4. التحقق من مضيف الـ Endpoint
  try {
    const parsedUrl = new URL(endpoint);
    const expectedR2Host = `${accountId.toLowerCase()}.r2.cloudflarestorage.com`;
    const host = parsedUrl.hostname.toLowerCase();
    const isLocalLoopback = host === '127.0.0.1' || host === 'localhost';
    if (
      (parsedUrl.protocol !== 'https:' && !isLocalLoopback) ||
      (host !== expectedR2Host && !isLocalLoopback)
    ) {
      problems.push(
        `R2_SANDBOX_ENDPOINT ("${parsedUrl.origin}") لا يطابق مضيف الحساب الاختباري المتوقع (${expectedR2Host}).`,
      );
    }
  } catch {
    problems.push('R2_SANDBOX_ENDPOINT ليس رابط URL صالحاً.');
  }

  // 5. التحقق من بادئة اسم الـ Bucket الاختبارية وحظر مفردات الإنتاج
  const isAllowedTestBucket =
    bucketName === 'asas-media-poc' ||
    /^asas-(media-)?(test|sandbox)-[a-z0-9-]+$/.test(bucketName);
  if (
    !isAllowedTestBucket ||
    /(prod|production|live|main)/i.test(bucketName) ||
    bucketName === 'asas-media-prod'
  ) {
    problems.push(
      `R2_SANDBOX_BUCKET_NAME ("${bucketName}") مرفوض: يجب أن يكون asas-media-poc أو يبدأ بـ asas-test- أو asas-sandbox- أو asas-media-test- وألا يحوي أي مفردة إنتاجية.`,
    );
  }

  if (problems.length > 0) {
    throw new VideoMediaConfigError(problems);
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint,
  };
}

/**
 * دالة نقية (بدون آثار جانبية) لتحليل متغيرات البيئة — قابلة للاختبار مباشرة.
 * لا تفحص ffprobe (ذلك في onModuleInit لأنه يتطلب تشغيل عملية).
 */
export function parseVideoMediaEnv(env: Env): ParsedVideoMediaEnv {
  const uploadEnabled = isEnabled(env.VIDEO_UPLOAD_ENABLED);
  const numericProblems: string[] = [];

  const maxSizeBytes = readBoundedInt(
    env,
    'MEDIA_VIDEO_MAX_SIZE_BYTES',
    DEFAULT_VIDEO_MAX_SIZE_BYTES,
    1,
    MAX_VIDEO_MAX_SIZE_BYTES,
    numericProblems,
  );
  let chunkSizeBytes = readBoundedInt(
    env,
    'MEDIA_VIDEO_CHUNK_SIZE_BYTES',
    DEFAULT_VIDEO_CHUNK_SIZE_BYTES,
    MIN_VIDEO_CHUNK_SIZE_BYTES,
    MAX_VIDEO_CHUNK_SIZE_BYTES,
    numericProblems,
  );
  if (chunkSizeBytes > maxSizeBytes) {
    numericProblems.push(
      `MEDIA_VIDEO_CHUNK_SIZE_BYTES=${chunkSizeBytes} أكبر من MEDIA_VIDEO_MAX_SIZE_BYTES=${maxSizeBytes} ` +
        `(سيُستخدم ${DEFAULT_VIDEO_CHUNK_SIZE_BYTES}).`,
    );
    chunkSizeBytes = Math.min(DEFAULT_VIDEO_CHUNK_SIZE_BYTES, maxSizeBytes);
  }

  const ffprobeBin = (env.MEDIA_FFPROBE_BIN ?? '').trim() || 'ffprobe';

  const missingR2Vars = REQUIRED_R2_ENV_VARS.filter(
    (name) => (env[name] ?? '').trim() === '',
  );

  const warnings: string[] = [];
  const errors: string[] = [];

  if (uploadEnabled) {
    errors.push(...numericProblems);
    if (missingR2Vars.length > 0) {
      errors.push(`متغيرات R2 ناقصة: ${missingR2Vars.join(', ')}`);
    }
  } else {
    warnings.push(...numericProblems);
  }

  // بيانات R2 لا تُحمَّل إلا عند التفعيل واكتمال المتغيرات (عزل كامل عند التعطيل)
  const r2: R2Credentials | null =
    uploadEnabled && missingR2Vars.length === 0
      ? {
          accountId: env.R2_ACCOUNT_ID!.trim(),
          accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
          secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
          bucketName: env.R2_BUCKET_NAME!.trim(),
        }
      : null;

  return {
    settings: { uploadEnabled, maxSizeBytes, chunkSizeBytes, ffprobeBin },
    r2,
    missingR2Vars: [...missingR2Vars],
    warnings,
    errors,
  };
}

@Injectable()
export class VideoMediaConfig implements OnModuleInit {
  private readonly logger = new Logger('VideoMediaConfig');
  private readonly parsed: ParsedVideoMediaEnv;
  private readonly envRef: Env;

  constructor() {
    this.envRef = { ...process.env };
    this.parsed = parseVideoMediaEnv(this.envRef);
  }

  async onModuleInit(): Promise<void> {
    for (const warning of this.parsed.warnings) {
      this.logger.warn(warning);
    }

    if (!this.parsed.settings.uploadEnabled) {
      this.logger.log(
        '🎬 رفع الفيديو معطّل (VIDEO_UPLOAD_ENABLED≠true) — لم يُهيَّأ R2 ولا ffprobe؛ ' +
          'الصور والصوت والمستندات تعمل كالمعتاد.',
      );
      return;
    }

    const problems = [...this.parsed.errors];
    const ffprobeProblem = await this.checkFfprobe(
      this.parsed.settings.ffprobeBin,
    );
    if (ffprobeProblem) problems.push(ffprobeProblem);

    if (problems.length > 0) {
      const error = new VideoMediaConfigError(problems);
      this.logger.error(error.message);
      throw error;
    }

    this.logger.log(
      `🎬 رفع الفيديو مفعّل — max=${this.parsed.settings.maxSizeBytes}B, ` +
        `chunk=${this.parsed.settings.chunkSizeBytes}B, bucket=${this.parsed.r2!.bucketName}`,
    );
  }

  /** هل ميزة رفع الفيديو مفعّلة ومكتملة الإعدادات؟ */
  get isUploadEnabled(): boolean {
    return this.parsed.settings.uploadEnabled && this.parsed.r2 !== null;
  }

  get maxSizeBytes(): number {
    return this.parsed.settings.maxSizeBytes;
  }

  get chunkSizeBytes(): number {
    return this.parsed.settings.chunkSizeBytes;
  }

  get ffprobeBin(): string {
    return this.parsed.settings.ffprobeBin;
  }

  get ffmpegBin(): string {
    return (this.envRef.MEDIA_FFMPEG_BIN ?? '').trim() || 'ffmpeg';
  }

  /** إعدادات ضبط FFmpeg (preset + خيوط المشفّر/الفلتر/المفكّك + التزامن) */
  get ffmpegTuning(): FfmpegTuning {
    return parseFfmpegTuning(this.envRef);
  }

  get videoStorageProvider(): StorageProviderName {
    const raw = (this.envRef.MEDIA_VIDEO_STORAGE_PROVIDER ?? '')
      .trim()
      .toUpperCase();
    return raw === 'LOCAL' ? 'LOCAL' : 'R2';
  }

  get workerMinFreeBytes(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_MIN_FREE_BYTES',
      DEFAULT_WORKER_MIN_FREE_BYTES,
      1024,
      100_000_000_000,
      [],
    );
  }

  get workerLiveMinFreeBytes(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_LIVE_MIN_FREE_BYTES',
      DEFAULT_WORKER_LIVE_MIN_FREE_BYTES,
      1024,
      100_000_000_000,
      [],
    );
  }

  get workerMaxVariantBytes(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_MAX_VARIANT_BYTES',
      DEFAULT_WORKER_MAX_VARIANT_BYTES,
      1024,
      MAX_VIDEO_MAX_SIZE_BYTES,
      [],
    );
  }

  get workerLeaseSec(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_LEASE_SEC',
      DEFAULT_WORKER_LEASE_SEC,
      10,
      7_200,
      [],
    );
  }

  get workerHeartbeatMs(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_HEARTBEAT_MS',
      DEFAULT_WORKER_HEARTBEAT_MS,
      1_000,
      600_000,
      [],
    );
  }

  get workerSweepMs(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_SWEEP_MS',
      DEFAULT_WORKER_SWEEP_MS,
      1_000,
      3_600_000,
      [],
    );
  }

  get workerPollMs(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_POLL_MS',
      DEFAULT_WORKER_POLL_MS,
      100,
      60_000,
      [],
    );
  }

  get workerStallTimeoutMs(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_WORKER_STALL_TIMEOUT_MS',
      DEFAULT_WORKER_STALL_TIMEOUT_MS,
      5_000,
      3_600_000,
      [],
    );
  }

  get ffmpegMaxRuntimeMs(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_FFMPEG_MAX_RUNTIME_MS',
      DEFAULT_FFMPEG_MAX_RUNTIME_MS,
      10_000,
      14_400_000,
      [],
    );
  }

  get uploadMaxDurationMs(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_UPLOAD_MAX_DURATION_MS',
      DEFAULT_UPLOAD_MAX_DURATION_MS,
      5_000,
      7_200_000,
      [],
    );
  }

  /**
   * مدة صلاحية الرابط الموقّع لـ GET من R2 بالثواني (R2_PRESIGNED_GET_TTL_SECONDS، افتراضياً 3600s = ساعة).
   */
  get r2PresignedGetTtlSeconds(): number {
    return readBoundedInt(
      this.envRef,
      'R2_PRESIGNED_GET_TTL_SECONDS',
      DEFAULT_R2_PRESIGNED_GET_TTL_SECONDS,
      60,
      604_800,
      [],
    );
  }

  /** VIDEO P4-6: MEDIA_DELETE_GRACE_DAYS (افتراضياً 30، النطاق [1..365]) */
  get mediaDeleteGraceDays(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_DELETE_GRACE_DAYS',
      DEFAULT_MEDIA_DELETE_GRACE_DAYS,
      1,
      365,
      [],
    );
  }

  /** VIDEO P4-6: MEDIA_UNLINKED_ASSET_TTL_HOURS (افتراضياً 24، النطاق [1..720]) */
  get unlinkedAssetTtlHours(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_UNLINKED_ASSET_TTL_HOURS',
      DEFAULT_MEDIA_UNLINKED_ASSET_TTL_HOURS,
      1,
      720,
      [],
    );
  }

  /** VIDEO P4-6: MEDIA_DELETE_MAX_ATTEMPTS (افتراضياً 10، النطاق [1..50]) */
  get mediaDeleteMaxAttempts(): number {
    return readBoundedInt(
      this.envRef,
      'MEDIA_DELETE_MAX_ATTEMPTS',
      DEFAULT_MEDIA_DELETE_MAX_ATTEMPTS,
      1,
      50,
      [],
    );
  }

  /**
   * يرمي 503 VIDEO_FEATURE_DISABLED عند تعطيل الميزة (§2.4).
   */
  assertUploadEnabled(): void {
    if (!this.isUploadEnabled) {
      throw new ServiceUnavailableException({
        error: 'VIDEO_FEATURE_DISABLED',
        message: 'رفع الفيديو غير مفعّل حالياً',
      });
    }
  }

  /**
   * بيانات اعتماد R2 — متاحة فقط عند التفعيل. يرمي 503 بدلاً من إسقاط العملية.
   */
  getR2Credentials(): R2Credentials {
    if (!this.parsed.r2) {
      throw new ServiceUnavailableException({
        error: 'STORAGE_PROVIDER_UNAVAILABLE',
        message: 'إعدادات R2 غير متاحة',
      });
    }
    return { ...this.parsed.r2 };
  }

  /** وصف آمن للسجلات — بلا أي أسرار */
  describe(): Record<string, unknown> {
    return {
      uploadEnabled: this.parsed.settings.uploadEnabled,
      maxSizeBytes: this.parsed.settings.maxSizeBytes,
      chunkSizeBytes: this.parsed.settings.chunkSizeBytes,
      ffprobeBin: this.parsed.settings.ffprobeBin,
      r2Configured: this.parsed.r2 !== null,
      missingR2Vars: this.parsed.missingR2Vars,
    };
  }

  /**
   * فحص إقلاع العامل المستقل (validateWorkerStartup — P4-4 v1.7):
   * 1. يرفض تشغيل العامل عندما تكون ميزة الفيديو معطلة (VIDEO_UPLOAD_ENABLED != true).
   * 2. يربط فحص إعدادات التخزين بالمزود المختار (R2 يتطلب متغيرات R2_*، بينما LOCAL لا يطلبها).
   * 3. يتحقق من عمل ffprobe ومن توفر مشفرات وحاويات وفلاتر ffmpeg المطلوبة فعلياً
   *    (libx264, libwebp, aac, mp4, webp, mov, scale, format) + اختبار ترميز مصغر.
   */
  async validateWorkerStartup(options?: {
    storageProviderOverride?: StorageProviderName;
    localStoragePath?: string;
  }): Promise<void> {
    const problems: string[] = [];

    if (!this.parsed.settings.uploadEnabled) {
      problems.push(
        'VIDEO_UPLOAD_ENABLED=false — لا يُسمح بتشغيل عامل معالجة الفيديو عندما تكون الميزة معطلة.',
      );
      throw new VideoMediaConfigError(problems);
    }

    const activeProvider =
      options?.storageProviderOverride ?? this.videoStorageProvider;

    if (activeProvider === 'R2') {
      if (this.parsed.missingR2Vars.length > 0) {
        problems.push(
          `مزود التخزين المختار هو R2 لكن متغيرات R2 ناقصة: ${this.parsed.missingR2Vars.join(', ')}`,
        );
      }
    } else {
      const localPath = path.resolve(
        options?.localStoragePath ??
          this.envRef.MEDIA_STORAGE_PATH ??
          './storage',
      );
      try {
        await fs.promises.mkdir(path.join(localPath, 'tmp', 'video-staging'), {
          recursive: true,
        });
        await fs.promises.access(localPath, fs.constants.W_OK);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        problems.push(
          `مزود التخزين المحلي LOCAL غير قابل للكتابة في "${localPath}": ${msg}`,
        );
      }
    }

    const ffprobeProblem = await this.checkFfprobe(this.ffprobeBin);
    if (ffprobeProblem) problems.push(ffprobeProblem);

    // إعدادات ضبط FFmpeg: أي قيمة غير صالحة تُفشل إقلاع العامل (لا تشغيل بإعداد غير مقصود)
    parseFfmpegTuning(this.envRef, problems);

    const ffmpegProblems = await this.checkFfmpegCapabilities(this.ffmpegBin);
    problems.push(...ffmpegProblems);

    if (problems.length > 0) {
      throw new VideoMediaConfigError(problems);
    }
  }

  /**
   * يتحقق من إمكانية تشغيل ffprobe (`ffprobe -version`) دون shell.
   * يعيد رسالة المشكلة أو null عند النجاح. (protected لتسهيل الاختبار)
   */
  protected checkFfprobe(bin: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        bin,
        ['-version'],
        { timeout: FFPROBE_CHECK_TIMEOUT_MS, shell: false },
        (error) => {
          if (error) {
            const code = (error as NodeJS.ErrnoException).code;
            resolve(
              `تعذّر تشغيل ffprobe ("${bin} -version"${code ? `, code=${code}` : ''}). ` +
                'ثبّت ffmpeg/ffprobe أو اضبط MEDIA_FFPROBE_BIN على المسار الصحيح.',
            );
            return;
          }
          resolve(null);
        },
      );
    });
  }

  /**
   * يتحقق من توفر المشفرات والمفككات والحاويات والفلاتر المطلوبة فعلياً في ffmpeg،
   * بالإضافة إلى اختبار ترميز دخاني مصغر (protected لتسهيل الاختبار).
   */
  protected async checkFfmpegCapabilities(bin: string): Promise<string[]> {
    const problems: string[] = [];

    const runCmd = (args: string[]): Promise<{ ok: boolean; stdout: string }> =>
      new Promise((resolve) => {
        execFile(
          bin,
          args,
          {
            timeout: FFMPEG_CHECK_TIMEOUT_MS,
            shell: false,
            maxBuffer: 4 * 1024 * 1024,
          },
          (error, stdout) => {
            if (error) {
              resolve({ ok: false, stdout: '' });
              return;
            }
            resolve({ ok: true, stdout: stdout ?? '' });
          },
        );
      });

    const versionRes = await runCmd(['-version']);
    if (!versionRes.ok) {
      return [
        `تعذّر تشغيل ffmpeg ("${bin} -version"). ثبّت ffmpeg أو اضبط MEDIA_FFMPEG_BIN.`,
      ];
    }

    const [encodersRes, decodersRes, muxersRes, demuxersRes, filtersRes] =
      await Promise.all([
        runCmd(['-hide_banner', '-encoders']),
        runCmd(['-hide_banner', '-decoders']),
        runCmd(['-hide_banner', '-muxers']),
        runCmd(['-hide_banner', '-demuxers']),
        runCmd(['-hide_banner', '-filters']),
      ]);

    const requiredEncoders = ['libx264', 'libwebp', 'aac'];
    for (const enc of requiredEncoders) {
      const re = new RegExp(`\\b${enc}\\b`);
      if (!encodersRes.ok || !re.test(encodersRes.stdout)) {
        problems.push(`مشفر ffmpeg المطلوب "${enc}" غير متوفر في "${bin}".`);
      }
    }

    const requiredDecoders = ['h264', 'aac'];
    for (const dec of requiredDecoders) {
      const re = new RegExp(`\\b${dec}\\b`);
      if (!decodersRes.ok || !re.test(decodersRes.stdout)) {
        problems.push(`مفكك ffmpeg المطلوب "${dec}" غير متوفر في "${bin}".`);
      }
    }

    const requiredMuxers = ['mp4', 'webp'];
    for (const mux of requiredMuxers) {
      const re = new RegExp(`\\b${mux}\\b`);
      if (!muxersRes.ok || !re.test(muxersRes.stdout)) {
        problems.push(
          `حاوية إخراج ffmpeg المطلوبة "${mux}" غير متوفرة في "${bin}".`,
        );
      }
    }

    if (!demuxersRes.ok || !/\bmov\b/.test(demuxersRes.stdout)) {
      problems.push(`قارئ حاويات mov/mp4 غير متوفر في "${bin}".`);
    }

    const requiredFilters = ['scale', 'format'];
    for (const flt of requiredFilters) {
      const re = new RegExp(`\\b${flt}\\b`);
      if (!filtersRes.ok || !re.test(filtersRes.stdout)) {
        problems.push(`فلتر ffmpeg المطلوب "${flt}" غير متوفر في "${bin}".`);
      }
    }

    if (problems.length > 0) return problems;

    // اختبار ترميز دخاني مصغر (1-frame synthetic smoke test) إذا كان lavfi متاحاً
    if (/\blavfi\b/.test(demuxersRes.stdout)) {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'asas-ffmpeg-selftest-'),
      );
      const mp4Out = path.join(tmpDir, 'test.mp4');
      const webpOut = path.join(tmpDir, 'test.webp');
      try {
        const mp4Smoke = await runCmd([
          '-y',
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=64x64:d=0.1:r=10',
          '-frames:v',
          '1',
          '-vf',
          'scale=64:64:flags=bicubic,format=yuv420p',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-maxrate',
          '800k',
          '-bufsize',
          '1600k',
          '-profile:v',
          'high',
          '-level',
          '4.0',
          '-pix_fmt',
          'yuv420p',
          '-an',
          '-movflags',
          '+faststart',
          mp4Out,
        ]);
        if (!mp4Smoke.ok) {
          problems.push(
            'فشل اختبار الترميز الدخاني لـ libx264/mp4 (+faststart).',
          );
        }

        const webpSmoke = await runCmd([
          '-y',
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=64x64:d=0.1',
          '-frames:v',
          '1',
          '-vf',
          'scale=64:64:flags=bicubic',
          '-c:v',
          'libwebp',
          '-lossless',
          '0',
          '-compression_level',
          '4',
          '-q:v',
          '75',
          webpOut,
        ]);
        if (!webpSmoke.ok) {
          problems.push('فشل اختبار الترميز الدخاني لـ libwebp.');
        }
      } finally {
        await fs.promises
          .rm(tmpDir, { recursive: true, force: true })
          .catch(() => undefined);
      }
    }

    return problems;
  }
}
