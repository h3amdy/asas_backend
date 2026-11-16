// src/shared/media/media-magic-bytes.spec.ts
import { isSniffCompatibleWithKind, sniffMediaType } from './media-magic-bytes';

const b = (...bytes: number[]) => Buffer.from(bytes);
const s = (text: string) => Buffer.from(text, 'latin1');

describe('MEDIA-R2 B1 — sniffMediaType', () => {
  it.each([
    ['JPEG', b(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['PNG', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['GIF', s('GIF89a....'), 'image/gif'],
    ['WebP', s('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'],
    ['PDF', s('%PDF-1.7\n'), 'application/pdf'],
    ['WAV', s('RIFF\0\0\0\0WAVEfmt '), 'audio/wav'],
    ['OGG', s('OggS\0\0'), 'audio/ogg'],
    ['MP3 (ID3)', s('ID3\x04\0'), 'audio/mpeg'],
    ['MP3 (frame)', b(0xff, 0xfb, 0x90, 0x00), 'audio/mpeg'],
    ['AAC (ADTS)', b(0xff, 0xf1, 0x50, 0x80), 'audio/aac'],
    ['M4A', s('\0\0\0\x20ftypM4A \0\0'), 'audio/mp4'],
    ['MP4', s('\0\0\0\x20ftypisom\0\0'), 'video/mp4'],
    ['MOV', s('\0\0\0\x14ftypqt  \0\0'), 'video/quicktime'],
    ['WebM', b(0x1a, 0x45, 0xdf, 0xa3, 0x01), 'video/webm'],
  ])('يكتشف %s', (_name, head, contentType) => {
    expect(sniffMediaType(head)?.contentType).toBe(contentType);
  });

  it.each([
    ['SVG', s('<?xml version="1.0"?><svg xmlns=')],
    ['SVG بلا ترويسة', s('<svg onload="alert(1)">')],
    ['HTML', s('<!DOCTYPE html><html>')],
    ['نص', s('hello world')],
    ['فارغ', Buffer.alloc(0)],
    ['EXE', s('MZ\x90\0')],
  ])('لا يكتشف %s (يُرفض)', (_name, head) => {
    expect(sniffMediaType(head)).toBeNull();
  });

  it('يتحقق من توافق النوع المطلوب', () => {
    const png = sniffMediaType(
      b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    );
    const mp4 = sniffMediaType(s('\0\0\0\x20ftypisom\0\0'));
    const pdf = sniffMediaType(s('%PDF-1.4'));
    expect(isSniffCompatibleWithKind(png, 'IMAGE')).toBe(true);
    expect(isSniffCompatibleWithKind(png, 'AUDIO')).toBe(false);
    expect(isSniffCompatibleWithKind(pdf, 'IMAGE')).toBe(false);
    expect(isSniffCompatibleWithKind(pdf, 'DOCUMENT')).toBe(true);
    // m4a بعلامة عامة
    expect(isSniffCompatibleWithKind(mp4, 'AUDIO')).toBe(true);
    expect(isSniffCompatibleWithKind(null, 'IMAGE')).toBe(false);
  });
});
