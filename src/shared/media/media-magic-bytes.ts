// src/shared/media/media-magic-bytes.ts
// ═══════════════════════════════════════════════════════════════
// 🔎 MEDIA-R2 B1 — كشف نوع الملف الحقيقي من أول بايتاته (Magic Bytes)
// ═══════════════════════════════════════════════════════════════
// لا نثق بـ Content-Type القادم من العميل أو من موقع خارجي، ولا بامتداد الرابط.
// نقرأ أول بايتات الملف ونحدد نوعه الفعلي. ملفات SVG/HTML لا تُكتشف هنا أبداً،
// وبالتالي تُرفض تلقائياً لأنها نصوص قد تحمل سكربتات.
// ═══════════════════════════════════════════════════════════════

import * as fs from 'fs';

/** عدد البايتات الكافي للكشف عن كل الأنواع المدعومة */
export const MAGIC_BYTES_SNIFF_LENGTH = 64;

export type SniffedKind = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT';

export interface SniffResult {
  kind: SniffedKind;
  contentType: string;
  ext: string;
}

const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(buf: Buffer, offset: number, length: number): string {
  if (buf.length < offset + length) return '';
  return buf.toString('latin1', offset, offset + length);
}

/**
 * يحدد نوع الملف من بايتاته الأولى. يُرجع null إذا لم يكن من الأنواع المدعومة.
 */
export function sniffMediaType(head: Buffer): SniffResult | null {
  // ── صور ──
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return { kind: 'IMAGE', contentType: 'image/jpeg', ext: 'jpg' };
  }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'IMAGE', contentType: 'image/png', ext: 'png' };
  }
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') {
    return { kind: 'IMAGE', contentType: 'image/gif', ext: 'gif' };
  }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') {
    return { kind: 'IMAGE', contentType: 'image/webp', ext: 'webp' };
  }
  if (
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { kind: 'IMAGE', contentType: 'image/tiff', ext: 'tiff' };
  }

  // ── وثائق ──
  if (ascii(head, 0, 5) === '%PDF-') {
    return { kind: 'DOCUMENT', contentType: 'application/pdf', ext: 'pdf' };
  }

  // ── صوت ──
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') {
    return { kind: 'AUDIO', contentType: 'audio/wav', ext: 'wav' };
  }
  if (ascii(head, 0, 4) === 'OggS') {
    return { kind: 'AUDIO', contentType: 'audio/ogg', ext: 'ogg' };
  }
  if (ascii(head, 0, 3) === 'ID3') {
    return { kind: 'AUDIO', contentType: 'audio/mpeg', ext: 'mp3' };
  }
  if (ascii(head, 0, 4) === 'fLaC') {
    return { kind: 'AUDIO', contentType: 'audio/flac', ext: 'flac' };
  }
  if (ascii(head, 0, 5) === '#!AMR') {
    return { kind: 'AUDIO', contentType: 'audio/amr', ext: 'amr' };
  }
  if (head.length >= 2 && head[0] === 0xff) {
    // ADTS (AAC): 1111 1111 1111 x00x
    if ((head[1] & 0xf6) === 0xf0) {
      return { kind: 'AUDIO', contentType: 'audio/aac', ext: 'aac' };
    }
    // MPEG audio frame sync: 1111 1111 111x xxxx (طبقة غير محجوزة)
    if ((head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0x00) {
      return { kind: 'AUDIO', contentType: 'audio/mpeg', ext: 'mp3' };
    }
  }

  // ── حاويات ISO BMFF (mp4 / m4a / mov) ──
  if (ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4);
    if (brand === 'M4A ' || brand === 'M4B ') {
      return { kind: 'AUDIO', contentType: 'audio/mp4', ext: 'm4a' };
    }
    // صور iPhone (HEIC/HEIF) و AVIF
    if (HEIF_BRANDS.has(brand)) {
      return { kind: 'IMAGE', contentType: 'image/heic', ext: 'heic' };
    }
    if (brand === 'avif' || brand === 'avis') {
      return { kind: 'IMAGE', contentType: 'image/avif', ext: 'avif' };
    }
    if (brand === 'qt  ') {
      return { kind: 'VIDEO', contentType: 'video/quicktime', ext: 'mov' };
    }
    return { kind: 'VIDEO', contentType: 'video/mp4', ext: 'mp4' };
  }

  // ── WebM / Matroska (EBML) ──
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'VIDEO', contentType: 'video/webm', ext: 'webm' };
  }

  return null;
}

/** يقرأ أول بايتات ملف من القرص ويكشف نوعه */
export async function sniffFileMediaType(
  filePath: string,
): Promise<SniffResult | null> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(MAGIC_BYTES_SNIFF_LENGTH);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return sniffMediaType(buf.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * هل النوع المكتشف مقبول للنوع المطلوب؟
 * - ملف m4a بعلامة عامة (isom/mp42) يُكتشف كـ VIDEO؛ نقبله كـ AUDIO لأن ffmpeg سيعالجه.
 */
export function isSniffCompatibleWithKind(
  sniff: SniffResult | null,
  kind: string,
): boolean {
  if (!sniff) return false;
  if (sniff.kind === kind) return true;
  // m4a/3gp بعلامة ftyp عامة، أو تسجيل صوتي داخل WebM (Opus)
  if (
    kind === 'AUDIO' &&
    (sniff.contentType === 'video/mp4' || sniff.contentType === 'video/webm')
  ) {
    return true;
  }
  return false;
}

/**
 * يُرجع نوع المحتوى والامتداد المناسبين للتخزين بحسب النوع المطلوب.
 * صوت داخل حاوية فيديو (mp4/webm) يُخزَّن كصوت.
 */
export function normalizeSniffForKind(
  sniff: SniffResult,
  kind: string,
): { contentType: string; ext: string } {
  if (kind === 'AUDIO' && sniff.contentType === 'video/mp4') {
    return { contentType: 'audio/mp4', ext: 'm4a' };
  }
  if (kind === 'AUDIO' && sniff.contentType === 'video/webm') {
    return { contentType: 'audio/webm', ext: 'webm' };
  }
  return { contentType: sniff.contentType, ext: sniff.ext };
}
