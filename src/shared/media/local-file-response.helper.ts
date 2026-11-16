// src/shared/media/local-file-response.helper.ts
// ═══════════════════════════════════════════════════════════════
// 📤 MEDIA-R2 B1 (SEC-MEDIA-05) — بث ملف محلي مع دعم Range بشكل آمن
// ═══════════════════════════════════════════════════════════════
// موحَّد بين /school/media و /platform/media و /public/media:
// - يقلّص نهاية النطاق إلى حجم الملف (لا Content-Length أكبر من الحقيقي).
// - يرفض النطاقات غير الصالحة (start > end أو start >= size) بـ 416.
// - يستعمل pipeline: يُغلق الملف عند انقطاع العميل، ولا تتعلق الاستجابة عند خطأ قراءة.
// ═══════════════════════════════════════════════════════════════

import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ReadStream } from 'fs';
import { pipeline } from 'stream/promises';

const logger = new Logger('LocalFileResponse');

export interface ParsedRange {
  start: number;
  end: number;
}

/**
 * يحلل ترويسة Range لنطاق واحد بصيغة bytes=start-end أو bytes=start- أو bytes=-suffix.
 * - null: لا ترويسة أو صيغة غير مدعومة ← يُرسل الملف كاملاً (سلوك HTTP القياسي).
 * - 'UNSATISFIABLE': النطاق خارج حدود الملف ← 416.
 */
export function parseSingleRange(
  rangeHeader: string | undefined,
  fileSize: number,
): ParsedRange | 'UNSATISFIABLE' | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (fileSize <= 0) return 'UNSATISFIABLE';

  // bytes=-N ← آخر N بايت
  if (rawStart === '') {
    const suffix = parseInt(rawEnd, 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'UNSATISFIABLE';
    return { start: Math.max(0, fileSize - suffix), end: fileSize - 1 };
  }

  const start = parseInt(rawStart, 10);
  if (!Number.isSafeInteger(start) || start >= fileSize) return 'UNSATISFIABLE';

  let end = rawEnd === '' ? fileSize - 1 : parseInt(rawEnd, 10);
  if (!Number.isSafeInteger(end)) end = fileSize - 1;
  if (end < start) return 'UNSATISFIABLE';
  end = Math.min(end, fileSize - 1);

  return { start, end };
}

/**
 * يرسل ملفاً محلياً (كاملاً أو جزئياً) بعد ضبط الترويسات العامة مسبقاً من المستدعي.
 */
export async function sendLocalFile(
  res: Response,
  opts: {
    fileSize: number;
    rangeHeader: string | undefined;
    openStream: (start?: number, end?: number) => ReadStream;
    logLabel: string;
  },
): Promise<void> {
  const { fileSize, rangeHeader, openStream, logLabel } = opts;
  const range = parseSingleRange(rangeHeader, fileSize);

  if (range === 'UNSATISFIABLE') {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
    return;
  }

  let stream: ReadStream;
  if (range) {
    res.status(206);
    res.setHeader(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${fileSize}`,
    );
    res.setHeader('Content-Length', range.end - range.start + 1);
    stream = openStream(range.start, range.end);
  } else {
    res.setHeader('Content-Length', fileSize);
    stream = openStream();
  }

  try {
    await pipeline(stream, res);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // انقطاع العميل أمر طبيعي — لا نسجله كخطأ
    if (code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    logger.warn(`stream failed (${logLabel}): ${code ?? String(err)}`);
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.destroy();
    }
  }
}
