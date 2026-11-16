// src/shared/media/safe-url-fetcher.ts
// ═══════════════════════════════════════════════════════════════
// 🛡️ MEDIA-R2 B1 — تنزيل آمن من روابط خارجية (إصلاح SEC-MEDIA-01 / SSRF)
// ═══════════════════════════════════════════════════════════════
// الضمانات:
// 1. https فقط، على المنفذ 443 فقط، وبلا اسم مستخدم/كلمة مرور داخل الرابط.
// 2. فحص عنوان IP **لحظة الاتصال الفعلي** عبر lookup مخصص في الـ Agent
//    (يمنع DNS Rebinding: لا فجوة بين الفحص والاتصال).
// 3. حظر كل العناوين الداخلية/الخاصة/المحجوزة في IPv4 و IPv6 بما فيها
//    IPv4-mapped (::ffff:127.0.0.1) و CGNAT (100.64/10) و NAT64.
// 4. كل إعادة توجيه (Redirect) تُفحص بنفس القواعد، بحد أقصى 3.
// 5. حد الحجم أثناء التدفق + مهلة إجمالية للعملية كاملة.
// 6. رسائل خطأ برموز ثابتة (لا تكشف تفاصيل الشبكة الداخلية).
// ═══════════════════════════════════════════════════════════════

import * as dns from 'dns';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';

export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'PROTOCOL_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED'
  | 'CREDENTIALS_IN_URL'
  | 'FORBIDDEN_ADDRESS'
  | 'DNS_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'HTTP_STATUS'
  | 'TOO_LARGE'
  | 'EMPTY_FILE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR';

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

// ── قائمة العناوين المحظورة ──
const FORBIDDEN = new net.BlockList();
// IPv4
FORBIDDEN.addSubnet('0.0.0.0', 8, 'ipv4'); // "هذه الشبكة"
FORBIDDEN.addSubnet('10.0.0.0', 8, 'ipv4'); // خاص
FORBIDDEN.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
FORBIDDEN.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
FORBIDDEN.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local + metadata السحابة
FORBIDDEN.addSubnet('172.16.0.0', 12, 'ipv4'); // خاص
FORBIDDEN.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF
FORBIDDEN.addSubnet('192.0.2.0', 24, 'ipv4'); // توثيق
FORBIDDEN.addSubnet('192.88.99.0', 24, 'ipv4'); // 6to4 relay
FORBIDDEN.addSubnet('192.168.0.0', 16, 'ipv4'); // خاص
FORBIDDEN.addSubnet('198.18.0.0', 15, 'ipv4'); // اختبارات الأداء
FORBIDDEN.addSubnet('198.51.100.0', 24, 'ipv4'); // توثيق
FORBIDDEN.addSubnet('203.0.113.0', 24, 'ipv4'); // توثيق
FORBIDDEN.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
FORBIDDEN.addSubnet('240.0.0.0', 4, 'ipv4'); // محجوز + broadcast
// IPv6
FORBIDDEN.addAddress('::', 'ipv6'); // غير محدد
FORBIDDEN.addAddress('::1', 'ipv6'); // loopback
FORBIDDEN.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64
FORBIDDEN.addSubnet('64:ff9b:1::', 48, 'ipv6'); // NAT64 محلي
FORBIDDEN.addSubnet('100::', 64, 'ipv6'); // discard
FORBIDDEN.addSubnet('2001:db8::', 32, 'ipv6'); // توثيق
FORBIDDEN.addSubnet('2002::', 16, 'ipv6'); // 6to4 (قد يغلّف IPv4 داخلياً)
FORBIDDEN.addSubnet('fc00::', 7, 'ipv6'); // ULA خاص
FORBIDDEN.addSubnet('fe80::', 10, 'ipv6'); // link-local
FORBIDDEN.addSubnet('fec0::', 10, 'ipv6'); // site-local (قديم)
FORBIDDEN.addSubnet('ff00::', 8, 'ipv6'); // multicast

/**
 * يستخرج عنوان IPv4 المضمّن في صيغ IPv6 (::ffff:a.b.c.d أو ::a.b.c.d)
 * سواء كُتب بالصيغة النقطية أو السداسية عشرية (::ffff:7f00:1).
 */
function extractEmbeddedIpv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase();
  const dotted = lower.match(/^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted && net.isIPv4(dotted[1])) return dotted[1];

  const hex = lower.match(
    /^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** هل العنوان داخلي/خاص/محجوز ويجب منع الاتصال به؟ */
export function isForbiddenAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(clean)) return FORBIDDEN.check(clean, 'ipv4');
  if (net.isIPv6(clean)) {
    const embedded = extractEmbeddedIpv4(clean);
    if (embedded) return FORBIDDEN.check(embedded, 'ipv4');
    return FORBIDDEN.check(clean, 'ipv6');
  }
  // ليس عنواناً صالحاً أصلاً ← نمنعه احتياطاً
  return true;
}

type LookupFn = typeof dns.lookup;

/**
 * يبني دالة lookup تُستعمل داخل الـ Agent: تحل الاسم ثم ترفض الاتصال
 * إذا كان **أي** من العناوين الناتجة محظوراً (حتى لا ينتقي النظام عنواناً داخلياً لاحقاً).
 */
export function createSafeLookup(
  baseLookup: LookupFn = dns.lookup,
  isForbidden: (ip: string) => boolean = isForbiddenAddress,
): net.LookupFunction {
  return (hostname, options, callback) => {
    baseLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 4);
        return;
      }
      const list = (addresses as unknown as dns.LookupAddress[]) ?? [];
      if (list.length === 0) {
        callback(new SafeFetchError('DNS_FAILED', 'تعذر حل اسم الموقع'), '', 4);
        return;
      }
      if (list.some((a) => isForbidden(a.address))) {
        callback(
          new SafeFetchError(
            'FORBIDDEN_ADDRESS',
            'لا يمكن الاستيراد من عنوان داخلي أو خاص',
          ),
          '',
          4,
        );
        return;
      }
      const wantAll = options?.all === true;
      if (wantAll) {
        (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(
          null,
          list,
        );
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}

export interface SafeFetchOptions {
  maxBytes: number;
  /** مهلة العملية كاملة بما فيها التحويلات */
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** للاختبارات فقط — لا تمرره في كود الإنتاج */
  testing?: {
    allowedProtocols?: string[];
    allowedPorts?: string[];
    lookup?: LookupFn;
    isForbidden?: (ip: string) => boolean;
  };
}

export interface SafeFetchResult {
  /** Content-Type كما أرسله الموقع (للمعلومة فقط — لا يُعتمد عليه) */
  declaredContentType: string;
  sizeBytes: number;
  finalUrl: string;
}

/** يتحقق من شكل الرابط قبل أي اتصال */
export function validateExternalUrl(
  rawUrl: string,
  allowedProtocols: string[] = ['https:'],
  allowedPorts: string[] = ['', '443'],
  isForbidden: (ip: string) => boolean = isForbiddenAddress,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('INVALID_URL', 'الرابط غير صالح');
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new SafeFetchError(
      'PROTOCOL_NOT_ALLOWED',
      'يجب أن يبدأ الرابط بـ https://',
    );
  }
  if (parsed.username || parsed.password) {
    throw new SafeFetchError(
      'CREDENTIALS_IN_URL',
      'لا يُسمح بإدراج اسم مستخدم أو كلمة مرور في الرابط',
    );
  }
  if (!allowedPorts.includes(parsed.port)) {
    throw new SafeFetchError(
      'PORT_NOT_ALLOWED',
      'لا يُسمح إلا بالمنفذ الافتراضي لـ https',
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) {
    throw new SafeFetchError('INVALID_URL', 'الرابط غير صالح');
  }
  // عنوان IP مكتوب مباشرة في الرابط ← نفحصه فوراً
  if (net.isIP(host) && isForbidden(host)) {
    throw new SafeFetchError(
      'FORBIDDEN_ADDRESS',
      'لا يمكن الاستيراد من عنوان داخلي أو خاص',
    );
  }
  const lowerHost = host.toLowerCase();
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) {
    throw new SafeFetchError(
      'FORBIDDEN_ADDRESS',
      'لا يمكن الاستيراد من عنوان داخلي أو خاص',
    );
  }
  return parsed;
}

/**
 * ينزّل رابطاً خارجياً إلى ملف محلي مع كل ضمانات الأمان.
 * عند أي فشل يُحذف الملف الجزئي.
 */
export async function safeFetchToFile(
  rawUrl: string,
  destPath: string,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const allowedProtocols = options.testing?.allowedProtocols ?? ['https:'];
  const allowedPorts = options.testing?.allowedPorts ?? ['', '443'];
  const isForbidden = options.testing?.isForbidden ?? isForbiddenAddress;
  const lookup = createSafeLookup(
    options.testing?.lookup ?? dns.lookup,
    isForbidden,
  );

  const deadline = Date.now() + timeoutMs;
  let currentUrl = rawUrl;

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const parsed = validateExternalUrl(
        currentUrl,
        allowedProtocols,
        allowedPorts,
        isForbidden,
      );
      const outcome = await requestOnce(parsed, destPath, {
        lookup,
        maxBytes: options.maxBytes,
        remainingMs: Math.max(1, deadline - Date.now()),
        userAgent:
          options.userAgent ?? 'MafhooomEducationPlatform/1.0 (media-import)',
      });

      if (outcome.kind === 'redirect') {
        currentUrl = new URL(outcome.location, parsed).href;
        continue;
      }
      return {
        declaredContentType: outcome.contentType,
        sizeBytes: outcome.sizeBytes,
        finalUrl: parsed.href,
      };
    }
    throw new SafeFetchError(
      'TOO_MANY_REDIRECTS',
      'عدد التحويلات أكثر من المسموح',
    );
  } catch (err) {
    await fs.promises.rm(destPath, { force: true }).catch(() => undefined);
    if (err instanceof SafeFetchError) throw err;
    const inner = (err as { cause?: unknown })?.cause;
    if (inner instanceof SafeFetchError) throw inner;
    throw new SafeFetchError('NETWORK_ERROR', 'تعذر الاتصال بالموقع');
  }
}

type RequestOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'file'; contentType: string; sizeBytes: number };

function requestOnce(
  url: URL,
  destPath: string,
  ctx: {
    lookup: net.LookupFunction;
    maxBytes: number;
    remainingMs: number;
    userAgent: string;
  },
): Promise<RequestOutcome> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const agentOptions = {
      lookup: ctx.lookup,
      keepAlive: false,
      maxSockets: 1,
    };
    const agent = isHttps
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions);
    const client = isHttps ? https : http;

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      agent.destroy();
      fn();
    };

    const req = client.get(
      url,
      {
        agent,
        headers: { 'User-Agent': ctx.userAgent, Accept: '*/*' },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          const location = res.headers.location;
          res.resume();
          if (!location) {
            finish(() =>
              reject(
                new SafeFetchError(
                  'HTTP_STATUS',
                  `الموقع أعاد الحالة ${status}`,
                  status,
                ),
              ),
            );
            return;
          }
          finish(() => resolve({ kind: 'redirect', location }));
          return;
        }

        if (status !== 200) {
          res.resume();
          finish(() =>
            reject(
              new SafeFetchError(
                'HTTP_STATUS',
                `الموقع أعاد الحالة ${status}`,
                status,
              ),
            ),
          );
          return;
        }

        const declaredLength = Number(res.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > ctx.maxBytes) {
          res.destroy();
          finish(() => reject(tooLarge(ctx.maxBytes)));
          return;
        }

        const contentType = String(
          res.headers['content-type'] ?? 'application/octet-stream',
        )
          .split(';')[0]
          .trim()
          .toLowerCase();

        const out = fs.createWriteStream(destPath);
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > ctx.maxBytes) {
            res.destroy();
            out.destroy();
            finish(() => reject(tooLarge(ctx.maxBytes)));
          }
        });
        res.on('error', (e) => finish(() => reject(e)));
        out.on('error', (e) => finish(() => reject(e)));
        out.on('finish', () => {
          if (received === 0) {
            finish(() =>
              reject(new SafeFetchError('EMPTY_FILE', 'الملف فارغ')),
            );
            return;
          }
          finish(() =>
            resolve({ kind: 'file', contentType, sizeBytes: received }),
          );
        });
        res.pipe(out);
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new SafeFetchError('TIMEOUT', 'انتهت مهلة التنزيل')));
    }, ctx.remainingMs);

    req.on('error', (e) => finish(() => reject(e)));
  });
}

function tooLarge(maxBytes: number): SafeFetchError {
  return new SafeFetchError(
    'TOO_LARGE',
    `الملف أكبر من ${Math.floor(maxBytes / 1024 / 1024)}MB`,
  );
}
