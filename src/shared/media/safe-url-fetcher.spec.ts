// src/shared/media/safe-url-fetcher.spec.ts
// MEDIA-R2 B1 — اختبارات إصلاح SSRF (SEC-MEDIA-01)
import * as dns from 'dns';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  createSafeLookup,
  isForbiddenAddress,
  SafeFetchError,
  safeFetchToFile,
  validateExternalUrl,
} from './safe-url-fetcher';

async function expectCode(
  p: Promise<unknown>,
  code: SafeFetchError['code'],
): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SafeFetchError ${code}`);
}

function expectSyncCode(fn: () => unknown, code: SafeFetchError['code']) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SafeFetchError ${code}`);
}

describe('SEC-MEDIA-01 — isForbiddenAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // metadata السحابة
    '100.64.0.1', // CGNAT
    '100.127.255.255',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped
    '::ffff:7f00:1', // IPv4-mapped بالصيغة السداسية عشرية
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', // NAT64
    'not-an-ip',
  ])('يحظر %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '104.16.0.1',
    '100.63.255.255', // خارج CGNAT
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ])('يسمح بالعنوان العام %s', (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });
});

describe('SEC-MEDIA-01 — validateExternalUrl', () => {
  it('يقبل رابط https عادي', () => {
    expect(validateExternalUrl('https://upload.wikimedia.org/a.png').host).toBe(
      'upload.wikimedia.org',
    );
  });

  it.each([
    ['http://example.com/a.png', 'PROTOCOL_NOT_ALLOWED'],
    ['ftp://example.com/a.png', 'PROTOCOL_NOT_ALLOWED'],
    ['file:///etc/passwd', 'PROTOCOL_NOT_ALLOWED'],
    ['https://example.com:8443/a.png', 'PORT_NOT_ALLOWED'],
    ['https://user:pass@example.com/a.png', 'CREDENTIALS_IN_URL'],
    ['https://127.0.0.1/a.png', 'FORBIDDEN_ADDRESS'],
    ['https://2130706433/a.png', 'FORBIDDEN_ADDRESS'], // 127.0.0.1 بصيغة عشرية
    ['https://0x7f.1/a.png', 'FORBIDDEN_ADDRESS'],
    ['https://[::1]/a.png', 'FORBIDDEN_ADDRESS'],
    ['https://[::ffff:127.0.0.1]/a.png', 'FORBIDDEN_ADDRESS'],
    ['https://169.254.169.254/latest/meta-data', 'FORBIDDEN_ADDRESS'],
    ['https://100.64.0.1/a.png', 'FORBIDDEN_ADDRESS'],
    ['https://localhost/a.png', 'FORBIDDEN_ADDRESS'],
    ['https://api.localhost/a.png', 'FORBIDDEN_ADDRESS'],
    ['not a url', 'INVALID_URL'],
  ] as const)('يرفض %s بـ %s', (url, code) => {
    expectSyncCode(() => validateExternalUrl(url), code);
  });
});

describe('SEC-MEDIA-01 — createSafeLookup (DNS Rebinding)', () => {
  const fakeLookup = (map: Record<string, string[]>) =>
    ((hostname: string, _opts: unknown, cb: (...a: unknown[]) => void) => {
      const ips = map[hostname];
      if (!ips) return cb(new Error('ENOTFOUND'));
      cb(
        null,
        ips.map((address) => ({
          address,
          family: address.includes(':') ? 6 : 4,
        })),
      );
    }) as unknown as typeof dns.lookup;

  const run = (lookup: ReturnType<typeof createSafeLookup>, host: string) =>
    new Promise<string>((resolve, reject) =>
      lookup(host, {}, (err, address) =>
        err ? reject(err) : resolve(address as string),
      ),
    );

  it('يمرر الاسم الذي يحل إلى عنوان عام', async () => {
    const lookup = createSafeLookup(fakeLookup({ 'cdn.test': ['8.8.8.8'] }));
    await expect(run(lookup, 'cdn.test')).resolves.toBe('8.8.8.8');
  });

  it('يرفض الاسم الذي يحل إلى عنوان داخلي', async () => {
    const lookup = createSafeLookup(fakeLookup({ 'evil.test': ['10.0.0.5'] }));
    await expectCode(run(lookup, 'evil.test'), 'FORBIDDEN_ADDRESS');
  });

  it('يرفض إذا كان أي عنوان من عدة عناوين داخلياً (عام + داخلي)', async () => {
    const lookup = createSafeLookup(
      fakeLookup({ 'mixed.test': ['8.8.8.8', '127.0.0.1'] }),
    );
    await expectCode(run(lookup, 'mixed.test'), 'FORBIDDEN_ADDRESS');
  });

  it('يرفض IPv6 الداخلي الناتج من DNS', async () => {
    const lookup = createSafeLookup(
      fakeLookup({ 'v6.test': ['::ffff:169.254.169.254'] }),
    );
    await expectCode(run(lookup, 'v6.test'), 'FORBIDDEN_ADDRESS');
  });
});

describe('SEC-MEDIA-01 — safeFetchToFile (خادم محلي حقيقي)', () => {
  let server: http.Server;
  let port: string;
  let tmpDir: string;
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(200, 1),
  ]);

  // الخادم المحلي يعمل على 127.0.0.1؛ نسمح له وحده في الاختبار ونُبقي بقية الحظر فعّالاً
  const testIsForbidden = (ip: string) =>
    ip === '127.0.0.1' ? false : isForbiddenAddress(ip);

  const hosts: Record<string, string[]> = {
    'good.test': ['127.0.0.1'],
    'evil.test': ['10.0.0.5'],
  };
  const testLookup = ((
    hostname: string,
    _opts: unknown,
    cb: (...a: unknown[]) => void,
  ) => {
    const ips = hosts[hostname];
    if (!ips) return cb(new Error('ENOTFOUND'));
    cb(
      null,
      ips.map((address) => ({ address, family: 4 })),
    );
  }) as unknown as typeof dns.lookup;

  const opts = (
    extra: Partial<Parameters<typeof safeFetchToFile>[2]> = {},
  ) => ({
    maxBytes: 1024,
    timeoutMs: 2000,
    ...extra,
    testing: {
      allowedProtocols: ['http:'],
      allowedPorts: [port],
      lookup: testLookup,
      isForbidden: testIsForbidden,
    },
  });

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fetch-'));
    server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/image.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PNG);
      } else if (url === '/redirect-good') {
        res.writeHead(302, { Location: `http://good.test:${port}/image.png` });
        res.end();
      } else if (url === '/redirect-evil-dns') {
        res.writeHead(302, { Location: `http://evil.test:${port}/image.png` });
        res.end();
      } else if (url === '/redirect-literal-ip') {
        res.writeHead(302, { Location: `http://10.0.0.1:${port}/x` });
        res.end();
      } else if (url === '/redirect-metadata') {
        res.writeHead(301, { Location: 'http://169.254.169.254/latest' });
        res.end();
      } else if (url === '/redirect-ftp') {
        res.writeHead(302, { Location: 'ftp://good.test/x' });
        res.end();
      } else if (url === '/loop') {
        res.writeHead(302, { Location: '/loop' });
        res.end();
      } else if (url === '/big-declared') {
        res.writeHead(200, { 'Content-Length': '999999' });
        res.end();
      } else if (url === '/big-chunked') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        const chunk = Buffer.alloc(400, 2);
        res.write(chunk);
        res.write(chunk);
        res.write(chunk);
        res.end(chunk);
      } else if (url === '/hang') {
        res.writeHead(200);
        res.write(Buffer.alloc(10));
        // لا ننهي الاستجابة
      } else if (url === '/empty') {
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = String((server.address() as AddressInfo).port);
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const dest = (name: string) => path.join(tmpDir, name);

  it('ينزّل الملف من مضيف مسموح', async () => {
    const out = dest('ok.bin');
    const res = await safeFetchToFile(
      `http://good.test:${port}/image.png`,
      out,
      opts(),
    );
    expect(res.sizeBytes).toBe(PNG.length);
    expect(fs.readFileSync(out).equals(PNG)).toBe(true);
  });

  it('يتبع تحويلاً سليماً', async () => {
    const res = await safeFetchToFile(
      `http://good.test:${port}/redirect-good`,
      dest('redir.bin'),
      opts(),
    );
    expect(res.sizeBytes).toBe(PNG.length);
  });

  it('يرفض اسماً يحل إلى عنوان داخلي (فحص لحظة الاتصال)', async () => {
    await expectCode(
      safeFetchToFile(
        `http://evil.test:${port}/image.png`,
        dest('evil.bin'),
        opts(),
      ),
      'FORBIDDEN_ADDRESS',
    );
  });

  it('يرفض تحويلاً إلى اسم يحل إلى عنوان داخلي', async () => {
    await expectCode(
      safeFetchToFile(
        `http://good.test:${port}/redirect-evil-dns`,
        dest('r1.bin'),
        opts(),
      ),
      'FORBIDDEN_ADDRESS',
    );
  });

  it('يرفض تحويلاً إلى عنوان داخلي مكتوب مباشرة', async () => {
    await expectCode(
      safeFetchToFile(
        `http://good.test:${port}/redirect-literal-ip`,
        dest('r2.bin'),
        opts(),
      ),
      'FORBIDDEN_ADDRESS',
    );
  });

  it('يرفض تحويلاً إلى عنوان metadata السحابة', async () => {
    const p = safeFetchToFile(
      `http://good.test:${port}/redirect-metadata`,
      dest('r3.bin'),
      opts(),
    );
    // المنفذ 80 غير مسموح في الاختبار، والعنوان محظور — أيهما يُفحص أولاً كافٍ للرفض
    await expect(p).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('يرفض تحويلاً إلى بروتوكول غير مسموح', async () => {
    await expectCode(
      safeFetchToFile(
        `http://good.test:${port}/redirect-ftp`,
        dest('r4.bin'),
        opts(),
      ),
      'PROTOCOL_NOT_ALLOWED',
    );
  });

  it('يوقف حلقة التحويلات', async () => {
    await expectCode(
      safeFetchToFile(
        `http://good.test:${port}/loop`,
        dest('loop.bin'),
        opts(),
      ),
      'TOO_MANY_REDIRECTS',
    );
  });

  it('يرفض الحجم المعلن الكبير قبل التنزيل', async () => {
    await expectCode(
      safeFetchToFile(
        `http://good.test:${port}/big-declared`,
        dest('big1.bin'),
        opts(),
      ),
      'TOO_LARGE',
    );
  });

  it('يوقف التنزيل أثناء التدفق عند تجاوز الحد ويحذف الملف الجزئي', async () => {
    const out = dest('big2.bin');
    await expectCode(
      safeFetchToFile(`http://good.test:${port}/big-chunked`, out, opts()),
      'TOO_LARGE',
    );
    expect(fs.existsSync(out)).toBe(false);
  });

  it('ينهي العملية عند تجاوز المهلة ويحذف الملف الجزئي', async () => {
    const out = dest('hang.bin');
    await expectCode(
      safeFetchToFile(
        `http://good.test:${port}/hang`,
        out,
        opts({ timeoutMs: 300 }),
      ),
      'TIMEOUT',
    );
    expect(fs.existsSync(out)).toBe(false);
  });

  it('يرفض الاستجابة غير 200 والملف الفارغ', async () => {
    await expectCode(
      safeFetchToFile(`http://good.test:${port}/nope`, dest('404.bin'), opts()),
      'HTTP_STATUS',
    );
    await expectCode(
      safeFetchToFile(`http://good.test:${port}/empty`, dest('e.bin'), opts()),
      'EMPTY_FILE',
    );
  });

  it('في الإنتاج (بدون testing) يرفض http والعناوين المحلية مباشرة', async () => {
    await expectCode(
      safeFetchToFile(`http://good.test:${port}/image.png`, dest('p.bin'), {
        maxBytes: 1024,
      }),
      'PROTOCOL_NOT_ALLOWED',
    );
    await expectCode(
      safeFetchToFile('https://127.0.0.1/image.png', dest('p2.bin'), {
        maxBytes: 1024,
      }),
      'FORBIDDEN_ADDRESS',
    );
  });
});
