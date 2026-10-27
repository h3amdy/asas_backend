/**
 * انحدار: PrismaService.convertBigInts كان يعيد بناء كل كائن ككائن عادي
 * → Decimal يصبح {s,e,d} (السعر "[object Object]")
 * → Buffer (حقول Bytes) يصبح {0:..,1:..} (فشل فك تشفير رموز التفعيل)
 *
 * لا يحتاج قاعدة بيانات: يختبر الدالة مباشرة.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService.convertBigInts', () => {
  // الدالة خاصة ولا تستخدم this.prisma — نستدعيها عبر النموذج الأولي دون اتصال
  const convert = (v: unknown) =>
    (PrismaService.prototype as any).convertBigInts.call(
      { convertBigInts: (PrismaService.prototype as any).convertBigInts },
      v,
    );

  it('converts nested BigInt to Number', () => {
    expect(convert({ a: 5n, b: [{ c: 7n }] })).toEqual({ a: 5, b: [{ c: 7 }] });
  });

  it('keeps Decimal intact (toString works)', () => {
    const out = convert({ price: new Prisma.Decimal('1000.00') });
    expect(Prisma.Decimal.isDecimal(out.price)).toBe(true);
    expect(out.price.toString()).toBe('1000');
    expect(JSON.stringify(out)).toBe('{"price":"1000"}');
  });

  it('keeps Buffer / Uint8Array intact (Bytes fields)', () => {
    const buf = Buffer.from([1, 2, 3]);
    const u8 = new Uint8Array([4, 5]);
    const out = convert({ codeCiphertext: buf, other: u8 });
    expect(Buffer.isBuffer(out.codeCiphertext)).toBe(true);
    expect(out.codeCiphertext.equals(buf)).toBe(true);
    expect(out.other).toBeInstanceOf(Uint8Array);
    expect(() => Buffer.from(out.other)).not.toThrow();
  });

  it('keeps Date intact', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(convert({ d }).d).toBe(d);
  });
});
