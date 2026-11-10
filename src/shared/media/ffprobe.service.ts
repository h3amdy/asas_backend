// src/shared/media/ffprobe.service.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-3 — فحص ffprobe السداسي العميق + سلم الجودات
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §6.3)
//        docs/features/video/06-VIDEO-API-001.md (§2.2 — D-P2-005)
// ═══════════════════════════════════════════════════════════════
// الفحوصات الستة الإلزامية قبل قبول ملف الفيديو:
//   1) الحاوية الفعلية: تتضمن mp4 أو mov (وليس نصاً أو حاوية أخرى أو M4A صوتي)
//   2) مسار فيديو حقيقي (ليس غلاف صورة attached_pic أو mjpeg/png/bmp/gif)
//   3) ترميز فيديو مدعوم (h264, hevc/h265, mpeg4, vp8, vp9, av1, prores)
//   4) ترميز صوت مدعوم (aac, mp3, opus, vorbis, flac, ac3, eac3, alac, pcm_*) أو فيديو صامت
//   5) الأبعاد (120..4096 بعد تطبيق الدوران) ومعدل الإطارات (0 < fps <= 120)
//   6) المدة (0 < duration <= MEDIA_VIDEO_MAX_DURATION_SEC، افتراضياً 3600s)
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { VideoMediaConfig } from './video-media.config';

/** نتيجة فحص ffprobe */
export interface FfprobeResult {
  valid: boolean;
  /** أسباب الرفض (فارغة عند النجاح) */
  errors: string[];
  /** بيانات الفيديو المستخرجة (null عند تعذّر التحليل) */
  info: VideoInfo | null;
}

export interface VideoInfo {
  /** عرض الفيديو الفعلي للعرض بعد تطبيق الدوران */
  width: number;
  /** ارتفاع الفيديو الفعلي للعرض بعد تطبيق الدوران */
  height: number;
  /** المدة بالثواني (عشري) */
  durationSec: number;
  /** ترميز الفيديو */
  videoCodec: string;
  /** ترميز الصوت (null للفيديو الصامت) */
  audioCodec: string | null;
  /** معدل الإطارات */
  fps: number;
  /** اسم الحاوية من ffprobe */
  formatName: string;
  /** هل الفيديو صامت؟ (يُمرَّر لاحقاً إلى ffmpeg بـ -map 0:a:0?) */
  isSilent: boolean;
  /** زاوية الدوران المستخرجة (0, 90, 180, 270) */
  rotation: number;
}

/** مواصفة جودة مستهدفة في سلم التحويل (بدون تكبير، أبعاد زوجية، مراعاة الأفقي/العمودي) */
export interface QualityVariantSpec {
  quality: '360p' | '480p' | '720p';
  tierHeight: 360 | 480 | 720;
  targetWidth: number;
  targetHeight: number;
}

/** رموز الحاويات المسموحة ضمن format_name */
const ALLOWED_CONTAINER_TOKENS = new Set(['mp4', 'mov']);

/** ترميزات الصور الثابتة التي لا تُعدّ مسار فيديو متحرك */
const IMAGE_PSEUDO_VIDEO_CODECS = new Set([
  'mjpeg',
  'png',
  'bmp',
  'gif',
  'webp',
  'tiff',
  'ppm',
]);

/** ترميزات الفيديو المدعومة للتحويل الآمن (06-API §2.2) */
export const ALLOWED_VIDEO_CODECS = new Set([
  'h264',
  'hevc',
  'h265',
  'mpeg4',
  'vp8',
  'vp9',
  'av1',
  'prores',
]);

/** ترميزات الصوت المدعومة (إضافةً إلى أي pcm_*) */
export const ALLOWED_AUDIO_CODECS = new Set([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'flac',
  'ac3',
  'eac3',
  'alac',
]);

export const MIN_VIDEO_DIMENSION = 120;
export const MAX_VIDEO_DIMENSION = 4096;
export const MAX_VIDEO_FPS = 120;
export const DEFAULT_MAX_VIDEO_DURATION_SEC = 3600;
const FFPROBE_TIMEOUT_MS = 30_000;

/** صناديق الجودات القياسية (الضلع الطويل × الضلع القصير — استبعاد 240p) */
const QUALITY_TIERS: ReadonlyArray<{
  quality: '360p' | '480p' | '720p';
  shortSide: 360 | 480 | 720;
  longSide: number;
}> = [
  { quality: '360p', shortSide: 360, longSide: 640 },
  { quality: '480p', shortSide: 480, longSide: 854 },
  { quality: '720p', shortSide: 720, longSide: 1280 },
];

function readMaxDurationSec(): number {
  const raw = (process.env.MEDIA_VIDEO_MAX_DURATION_SEC ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_MAX_VIDEO_DURATION_SEC;
  const v = Number(raw);
  return Number.isSafeInteger(v) && v >= 1 && v <= 86_400
    ? v
    : DEFAULT_MAX_VIDEO_DURATION_SEC;
}

function toEven(n: number): number {
  return Math.max(2, 2 * Math.round(n / 2));
}

@Injectable()
export class FfprobeService {
  private readonly logger = new Logger('FfprobeService');
  readonly maxDurationSec: number = readMaxDurationSec();

  constructor(private readonly config: VideoMediaConfig) {}

  /**
   * ينفذ الفحص السداسي العميق على ملف فيديو محلي.
   * يستدعي ffprobe عبر execFile (shell: false) ويحلل مخرج JSON.
   */
  async probe(filePath: string): Promise<FfprobeResult> {
    let rawOutput: string;
    try {
      rawOutput = await this.execFfprobe(filePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        valid: false,
        errors: [`FFPROBE_EXEC_FAILED: ${msg}`],
        info: null,
      };
    }

    return this.analyzeProbeJson(rawOutput);
  }

  /**
   * تحليل مخرج JSON من ffprobe وتطبيق الفحوصات الستة (دالة نقية قابلة للاختبار).
   */
  analyzeProbeJson(rawOutput: string): FfprobeResult {
    const errors: string[] = [];

    let probeData: FfprobeOutput;
    try {
      probeData = JSON.parse(rawOutput) as FfprobeOutput;
    } catch {
      return {
        valid: false,
        errors: ['FFPROBE_INVALID_JSON: تعذّر تحليل مخرج ffprobe'],
        info: null,
      };
    }

    if (!probeData || typeof probeData !== 'object') {
      return {
        valid: false,
        errors: ['FFPROBE_EMPTY_OUTPUT: مخرج ffprobe فارغ'],
        info: null,
      };
    }

    const format = probeData.format;
    const streams = Array.isArray(probeData.streams) ? probeData.streams : [];

    // ── الفحص 1: الحاوية الفعلية (mp4 / mov) ──
    const formatName = (format?.format_name ?? '').trim().toLowerCase();
    const formatTokens = formatName
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const hasMp4OrMov = formatTokens.some((t) =>
      ALLOWED_CONTAINER_TOKENS.has(t),
    );
    const majorBrand = (format?.tags?.major_brand ?? '').trim().toUpperCase();
    const isAudioOnlyBrand = majorBrand === 'M4A' || majorBrand === 'M4B';

    if (!hasMp4OrMov || isAudioOnlyBrand) {
      errors.push(
        `INVALID_CONTAINER: الحاوية "${formatName || 'unknown'}"${majorBrand ? ` (brand=${majorBrand})` : ''} غير مدعومة. المسموح: mp4, mov`,
      );
    }

    // ── الفحص 2: مسار فيديو حقيقي (ليس غلاف صورة مرفقاً) ──
    const realVideoStreams = streams.filter(
      (s) =>
        s.codec_type === 'video' &&
        s.disposition?.attached_pic !== 1 &&
        !IMAGE_PSEUDO_VIDEO_CODECS.has((s.codec_name ?? '').toLowerCase()),
    );
    if (realVideoStreams.length === 0) {
      errors.push(
        'NO_VIDEO_TRACK: لا يوجد مسار فيديو حقيقي (ملف صوتي فقط أو غلاف صورة ثابت)',
      );
    }

    const vs = realVideoStreams[0];

    // ── الفحص 3: ترميز الفيديو ──
    const videoCodec = (vs?.codec_name ?? '').trim().toLowerCase();
    if (vs && !ALLOWED_VIDEO_CODECS.has(videoCodec)) {
      errors.push(
        `UNSUPPORTED_VIDEO_CODEC: ترميز الفيديو "${videoCodec || 'unknown'}" غير مدعوم`,
      );
    }

    // ── الفحص 4: ترميز الصوت (أو فيديو تعليمي صامت) ──
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');
    const isSilent = audioStreams.length === 0;
    const audioCodec = isSilent
      ? null
      : (audioStreams[0]?.codec_name ?? '').trim().toLowerCase();

    if (
      !isSilent &&
      audioCodec !== null &&
      !this.isSupportedAudioCodec(audioCodec)
    ) {
      errors.push(
        `UNSUPPORTED_AUDIO_CODEC: ترميز الصوت "${audioCodec || 'unknown'}" غير مدعوم`,
      );
    }

    // ── الفحص 5: الأبعاد (مع مراعاة الدوران) ومعدل الإطارات ──
    const rawWidth = Number(vs?.width ?? 0);
    const rawHeight = Number(vs?.height ?? 0);
    const rotation = this.extractRotation(vs);
    const isRotated = rotation === 90 || rotation === 270;
    const width = isRotated ? rawHeight : rawWidth;
    const height = isRotated ? rawWidth : rawHeight;

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < MIN_VIDEO_DIMENSION ||
      height < MIN_VIDEO_DIMENSION
    ) {
      errors.push(
        `DIMENSIONS_TOO_SMALL: الأبعاد ${width}×${height} أقل من الحد الأدنى ${MIN_VIDEO_DIMENSION}px`,
      );
    } else if (width > MAX_VIDEO_DIMENSION || height > MAX_VIDEO_DIMENSION) {
      errors.push(
        `DIMENSIONS_TOO_LARGE: الأبعاد ${width}×${height} تتجاوز الحد الأقصى ${MAX_VIDEO_DIMENSION}px`,
      );
    }

    // تفضيل avg_frame_rate لفيديوهات الهواتف (VFR) ثم r_frame_rate
    const fps = this.resolveFps(vs);
    if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_VIDEO_FPS) {
      errors.push(
        `INVALID_FPS: معدل الإطارات ${fps} خارج النطاق المسموح (0..${MAX_VIDEO_FPS}]`,
      );
    }

    // ── الفحص 6: المدة ──
    const durationSec = this.resolveDuration(format, vs);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      errors.push('INVALID_DURATION: مدة الفيديو صفر أو غير صالحة');
    } else if (durationSec > this.maxDurationSec) {
      errors.push(
        `DURATION_TOO_LONG: مدة الفيديو ${Math.ceil(durationSec)}s تتجاوز الحد الأقصى ${this.maxDurationSec}s`,
      );
    }

    const info: VideoInfo = {
      width,
      height,
      durationSec,
      videoCodec,
      audioCodec,
      fps,
      formatName,
      isSilent,
      rotation,
    };

    return {
      valid: errors.length === 0,
      errors,
      info,
    };
  }

  /**
   * يعيد درجات سلم الجودات المتاحة (≤ الضلع الأصغر للمصدر، بلا تكبير، وباستبعاد 240p).
   * إذا كان الضلع الأصغر للمصدر بين 120 و 359، يُعاد [360] (تُنتج بأبعاد المصدر نفسها دون تكبير).
   */
  buildQualityLadder(info: Pick<VideoInfo, 'width' | 'height'>): number[] {
    const minSide = Math.min(info.width, info.height);
    const ladder = [360, 480, 720].filter((q) => q <= minSide);
    return ladder.length > 0 ? ladder : [360];
  }

  /**
   * يحسب مواصفات الجودات الدقيقة (الأبعاد الزوجية المستهدفة لكل جودة بلا تكبير
   * وبمراعاة الاتجاه الأفقي/العمودي وإزالة التكرار — §5.1 و §5.2).
   */
  buildQualityVariantSpecs(
    info: Pick<VideoInfo, 'width' | 'height'>,
  ): QualityVariantSpec[] {
    const isPortrait = info.height > info.width;
    const longSrc = Math.max(info.width, info.height);
    const shortSrc = Math.min(info.width, info.height);

    const specs: QualityVariantSpec[] = [];
    const seenDims = new Set<string>();

    for (const tier of QUALITY_TIERS) {
      // لا ننتج مستوى أعلى من الضلع القصير للمصدر، إلا إذا كان المصدر < 360p فننتج 360p بأبعاد المصدر نفسها
      if (tier.shortSide > shortSrc && specs.length > 0) {
        continue;
      }

      const scale = Math.min(
        1,
        tier.longSide / longSrc,
        tier.shortSide / shortSrc,
      );
      const targetLong = toEven(longSrc * scale);
      const targetShort = toEven(shortSrc * scale);
      const targetWidth = isPortrait ? targetShort : targetLong;
      const targetHeight = isPortrait ? targetLong : targetShort;
      const dimKey = `${targetWidth}x${targetHeight}`;

      if (seenDims.has(dimKey)) {
        continue;
      }
      seenDims.add(dimKey);

      specs.push({
        quality: tier.quality,
        tierHeight: tier.shortSide,
        targetWidth,
        targetHeight,
      });

      // إذا وصلنا إلى أبعاد المصدر الأصلية (scale === 1)، لا معنى لمستويات أعلى
      if (scale >= 1) {
        break;
      }
    }

    return specs;
  }

  // ── داخلي ──

  protected execFfprobe(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.config.ffprobeBin,
        [
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          filePath,
        ],
        { timeout: FFPROBE_TIMEOUT_MS, shell: false, maxBuffer: 2_000_000 },
        (error, stdout) => {
          if (error) {
            reject(
              error instanceof Error ? error : new Error('FFPROBE_EXEC_ERROR'),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  private isSupportedAudioCodec(codec: string): boolean {
    return ALLOWED_AUDIO_CODECS.has(codec) || codec.startsWith('pcm_');
  }

  /** استخراج زاوية الدوران (0, 90, 180, 270) من side_data_list أو tags.rotate */
  private extractRotation(stream: FfprobeStream | undefined): number {
    if (!stream) return 0;

    const sideData = stream.side_data_list ?? [];
    for (const sd of sideData) {
      if (sd.rotation !== undefined && sd.rotation !== null) {
        const normalized = this.normalizeRotation(Number(sd.rotation));
        if (normalized !== 0) return normalized;
      }
    }

    if (stream.tags?.rotate !== undefined) {
      return this.normalizeRotation(Number(stream.tags.rotate));
    }

    return 0;
  }

  private normalizeRotation(rawDeg: number): number {
    if (!Number.isFinite(rawDeg)) return 0;
    const mod = ((Math.round(rawDeg) % 360) + 360) % 360;
    return mod === 90 || mod === 180 || mod === 270 ? mod : 0;
  }

  private resolveFps(stream: FfprobeStream | undefined): number {
    if (!stream) return 0;
    const avg = this.parseFps(stream.avg_frame_rate ?? '');
    if (avg > 0 && avg <= MAX_VIDEO_FPS) return avg;
    const r = this.parseFps(stream.r_frame_rate ?? '');
    if (r > 0) return r;
    return avg;
  }

  private parseFps(fpsStr: string): number {
    const trimmed = fpsStr.trim();
    if (!trimmed) return 0;
    const parts = trimmed.split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      return Number.isFinite(num) && Number.isFinite(den) && den > 0
        ? num / den
        : 0;
    }
    const val = parseFloat(trimmed);
    return Number.isFinite(val) ? val : 0;
  }

  private resolveDuration(
    format: FfprobeOutput['format'],
    stream: FfprobeStream | undefined,
  ): number {
    const fromFormat = parseFloat(String(format?.duration ?? ''));
    if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;
    const fromStream = parseFloat(String(stream?.duration ?? ''));
    return Number.isFinite(fromStream) && fromStream > 0 ? fromStream : 0;
  }
}

// ── أنواع مخرجات ffprobe ──

export interface FfprobeOutput {
  format?: {
    format_name?: string;
    duration?: string | number;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
  streams?: FfprobeStream[];
}

export interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string | number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  disposition?: {
    attached_pic?: number;
    [key: string]: unknown;
  };
  side_data_list?: Array<{
    side_data_type?: string;
    rotation?: number | string;
    [key: string]: unknown;
  }>;
  tags?: Record<string, string>;
}
