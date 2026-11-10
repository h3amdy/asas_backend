// src/shared/media/ffprobe.service.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-3 — اختبارات FfprobeService السداسية وسلّم الجودات (§6.3, §10.1)
// ═══════════════════════════════════════════════════════════════
// يغطي العناصر الستة الإلزامية من الخطة:
//   1) ملف نصي بامتداد .mp4
//   2) ملف صوتي فقط (بلا مسار فيديو)
//   3) غلاف صورة مرفق فقط (attached_pic / mjpeg / png)
//   4) ترميز مرفوض (فيديو أو صوت)
//   5) فيديو تعليمي صامت صالح (صفر مسارات صوتية)
//   6) دقة عمودية/أفقية مع الدوران وبناء سلم الجودات ≤ المصدر بلا تكبير وباستبعاد 240p
// ═══════════════════════════════════════════════════════════════

import { FfprobeOutput, FfprobeService } from './ffprobe.service';
import { VideoMediaConfig } from './video-media.config';

function makeProbeJson(overrides: Partial<FfprobeOutput> = {}): string {
  const base: FfprobeOutput = {
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '125.4',
      tags: { major_brand: 'isom' },
      ...(overrides.format ?? {}),
    },
    streams: overrides.streams ?? [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        width: 1280,
        height: 720,
        avg_frame_rate: '30/1',
        r_frame_rate: '30/1',
        disposition: { attached_pic: 0 },
      },
      {
        index: 1,
        codec_type: 'audio',
        codec_name: 'aac',
      },
    ],
  };
  return JSON.stringify(base);
}

describe('VIDEO P4-3 — FfprobeService (الفحص السداسي العميق + سلم الجودات)', () => {
  let service: FfprobeService;

  beforeEach(() => {
    service = new FfprobeService(new VideoMediaConfig());
  });

  // ── 1) ملف نصي بامتداد .mp4 / فشل تنفيذ أو حاوية غير مدعومة ──

  it('1a) ملف نصي مزيف بامتداد .mp4 يفشل في ffprobe → يُرفض بـ FFPROBE_EXEC_FAILED', async () => {
    jest
      .spyOn(service as any, 'execFfprobe')
      .mockRejectedValue(new Error('Invalid data found when processing input'));

    const res = await service.probe('/tmp/fake-text.mp4');
    expect(res.valid).toBe(false);
    expect(res.info).toBeNull();
    expect(res.errors[0]).toContain('FFPROBE_EXEC_FAILED');
  });

  it('1b) حاوية غير mp4/mov (مثل matroska/webm أو avi) → تُرفض بـ INVALID_CONTAINER', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        format: { format_name: 'matroska,webm', duration: '60' },
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith('INVALID_CONTAINER'))).toBe(
      true,
    );
  });

  // ── 2) ملف صوتي فقط ──

  it('2) ملف صوتي فقط (بدون مسار فيديو أو بعلامة M4A) → يُرفض بـ NO_VIDEO_TRACK / INVALID_CONTAINER', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        format: {
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          duration: '45',
          tags: { major_brand: 'M4A ' },
        },
        streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac' }],
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith('NO_VIDEO_TRACK'))).toBe(true);
    expect(res.errors.some((e) => e.startsWith('INVALID_CONTAINER'))).toBe(
      true,
    );
  });

  // ── 3) غلاف صورة مرفق فقط ──

  it('3a) ملف صوتي مع غلاف صورة مرفق (disposition.attached_pic = 1) → يُرفض بـ NO_VIDEO_TRACK', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 600,
            height: 600,
            r_frame_rate: '1/1',
            disposition: { attached_pic: 1 },
          },
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith('NO_VIDEO_TRACK'))).toBe(true);
  });

  it('3b) مسار صورة ثابتة mjpeg/png بدون فيديو متحرك → يُرفض بـ NO_VIDEO_TRACK', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'mjpeg',
            width: 800,
            height: 600,
            r_frame_rate: '25/1',
            disposition: { attached_pic: 0 },
          },
        ],
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.startsWith('NO_VIDEO_TRACK'))).toBe(true);
  });

  // ── 4) ترميز مرفوض ──

  it('4a) ترميز فيديو غير مدعوم (wmv3) → يُرفض بـ UNSUPPORTED_VIDEO_CODEC', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'wmv3',
            width: 1280,
            height: 720,
            avg_frame_rate: '30/1',
          },
        ],
      }),
    );
    expect(res.valid).toBe(false);
    expect(
      res.errors.some((e) => e.startsWith('UNSUPPORTED_VIDEO_CODEC')),
    ).toBe(true);
  });

  it('4b) ترميز صوت غير مدعوم (wmapro) → يُرفض بـ UNSUPPORTED_AUDIO_CODEC', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1280,
            height: 720,
            avg_frame_rate: '30/1',
          },
          {
            index: 1,
            codec_type: 'audio',
            codec_name: 'wmapro',
          },
        ],
      }),
    );
    expect(res.valid).toBe(false);
    expect(
      res.errors.some((e) => e.startsWith('UNSUPPORTED_AUDIO_CODEC')),
    ).toBe(true);
  });

  // ── 5) فيديو تعليمي صامت صالح ──

  it('5) فيديو تعليمي صامت (صفر مسارات صوتية) → يُقبل مع isSilent=true و audioCodec=null', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'hevc',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
          },
        ],
      }),
    );
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.info).toMatchObject({
      width: 1920,
      height: 1080,
      videoCodec: 'hevc',
      audioCodec: null,
      isSilent: true,
    });
  });

  // ── 6) الأبعاد، الدوران، معدل الإطارات، المدة، وسلّم الجودات بلا تكبير ──

  it('6a) فيديو هاتف عمودي بدوران Display Matrix (-90°) يعكس الأبعاد إلى 1080×1920 ويبني سلم الجودات العمودي بلا تكبير', () => {
    const res = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30/1',
            r_frame_rate: '1000/1', // VFR timebase في هواتف Android — يجب تفضيل avg_frame_rate
            side_data_list: [
              { side_data_type: 'Display Matrix', rotation: -90 },
            ],
          },
          { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le' },
        ],
      }),
    );

    expect(res.valid).toBe(true);
    expect(res.info!.width).toBe(1080);
    expect(res.info!.height).toBe(1920);
    expect(res.info!.rotation).toBe(270);
    expect(res.info!.fps).toBe(30);

    const ladder = service.buildQualityLadder(res.info!);
    expect(ladder).toEqual([360, 480, 720]);

    const specs = service.buildQualityVariantSpecs(res.info!);
    expect(specs).toEqual([
      { quality: '360p', tierHeight: 360, targetWidth: 360, targetHeight: 640 },
      { quality: '480p', tierHeight: 480, targetWidth: 480, targetHeight: 854 },
      {
        quality: '720p',
        tierHeight: 720,
        targetWidth: 720,
        targetHeight: 1280,
      },
    ]);
  });

  it('6b) مصدر 960×540 (540p) ينتج 360p و 480p فقط ولا يكبّر إلى 720p (واستبعاد 240p)', () => {
    const info = { width: 960, height: 540 };
    expect(service.buildQualityLadder(info)).toEqual([360, 480]);
    expect(service.buildQualityVariantSpecs(info)).toEqual([
      { quality: '360p', tierHeight: 360, targetWidth: 640, targetHeight: 360 },
      { quality: '480p', tierHeight: 480, targetWidth: 854, targetHeight: 480 },
    ]);
  });

  it('6c) مصدر 320×240 (< 360p لكن ≥ 120px) ينتج نسخة واحدة بأبعاد المصدر نفسها (320×240) دون تكبير', () => {
    const info = { width: 320, height: 240 };
    expect(service.buildQualityLadder(info)).toEqual([360]);
    expect(service.buildQualityVariantSpecs(info)).toEqual([
      { quality: '360p', tierHeight: 360, targetWidth: 320, targetHeight: 240 },
    ]);
  });

  it('6d) حدود الأبعاد ومعدل الإطارات والمدة (أقل من 120px، أكبر من 4096px، fps>120، مدة>3600s)', () => {
    const tooSmall = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 100,
            height: 200,
            avg_frame_rate: '30/1',
          },
        ],
      }),
    );
    expect(tooSmall.valid).toBe(false);
    expect(
      tooSmall.errors.some((e) => e.startsWith('DIMENSIONS_TOO_SMALL')),
    ).toBe(true);

    const tooLarge = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 7680,
            height: 4320,
            avg_frame_rate: '30/1',
          },
        ],
      }),
    );
    expect(tooLarge.valid).toBe(false);
    expect(
      tooLarge.errors.some((e) => e.startsWith('DIMENSIONS_TOO_LARGE')),
    ).toBe(true);

    const badFps = service.analyzeProbeJson(
      makeProbeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1280,
            height: 720,
            avg_frame_rate: '240/1',
            r_frame_rate: '240/1',
          },
        ],
      }),
    );
    expect(badFps.valid).toBe(false);
    expect(badFps.errors.some((e) => e.startsWith('INVALID_FPS'))).toBe(true);

    const tooLong = service.analyzeProbeJson(
      makeProbeJson({
        format: {
          format_name: 'mov,mp4',
          duration: '3601',
        },
      }),
    );
    expect(tooLong.valid).toBe(false);
    expect(tooLong.errors.some((e) => e.startsWith('DURATION_TOO_LONG'))).toBe(
      true,
    );
  });
});
