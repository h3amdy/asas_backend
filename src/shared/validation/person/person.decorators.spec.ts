// src/shared/validation/person/person.decorators.spec.ts

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OptionalPersonPhone } from './person.decorators';

// ─── Test DTO ──────────────────────────────────────────────────
class TestPhoneDto {
  @OptionalPersonPhone()
  phone?: string;
}

/** Helper: يحوّل plain → DTO ثم يتحقق */
async function validatePhone(value: unknown): Promise<string[]> {
  const plain = value === undefined ? {} : { phone: value };
  const instance = plainToInstance(TestPhoneDto, plain);
  const errors = await validate(instance);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('@OptionalPersonPhone()', () => {
  // ─── undefined/null/empty → يُقبل (IsOptional) ──────────
  it('accepts undefined (field missing)', async () => {
    const errors = await validatePhone(undefined);
    expect(errors).toHaveLength(0);
  });

  it('accepts null', async () => {
    const errors = await validatePhone(null);
    expect(errors).toHaveLength(0);
  });

  it('accepts empty string ""', async () => {
    const errors = await validatePhone('');
    expect(errors).toHaveLength(0);
  });

  it('accepts whitespace-only "   "', async () => {
    const errors = await validatePhone('   ');
    expect(errors).toHaveLength(0);
  });

  // ─── non-string → يُرفض (IsString) ──────────────────────
  it('rejects numeric phone (777123456)', async () => {
    const errors = await validatePhone(777123456);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects boolean phone (true)', async () => {
    const errors = await validatePhone(true);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── too short (< 7 digits) → يُرفض ─────────────────────
  it('rejects 6-digit phone "123456"', async () => {
    const errors = await validatePhone('123456');
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── valid boundaries ────────────────────────────────────
  it('accepts 7-digit phone "1234567"', async () => {
    const errors = await validatePhone('1234567');
    expect(errors).toHaveLength(0);
  });

  it('accepts 15-digit phone', async () => {
    const errors = await validatePhone('123456789012345');
    expect(errors).toHaveLength(0);
  });

  // ─── too long (> 15 digits) → يُرفض ─────────────────────
  it('rejects 16-digit phone', async () => {
    const errors = await validatePhone('1234567890123456');
    expect(errors.length).toBeGreaterThan(0);
  });

  // ─── formatted phone → valid after transform ─────────────
  it('accepts formatted phone "+966 55-123-4567"', async () => {
    const errors = await validatePhone('+966 55-123-4567');
    expect(errors).toHaveLength(0);
  });

  it('accepts phone with parens "(055) 123-4567"', async () => {
    const errors = await validatePhone('(055) 123-4567');
    expect(errors).toHaveLength(0);
  });

  // ─── Arabic digits → valid after transform ───────────────
  it('accepts Arabic-Indic digits "٧٧٧١٢٣٤٥٦"', async () => {
    const errors = await validatePhone('٧٧٧١٢٣٤٥٦');
    expect(errors).toHaveLength(0);
  });

  // ─── alphabetic → rejected by Matches ────────────────────
  it('rejects phone with letters "055ABC1234"', async () => {
    const errors = await validatePhone('055ABC1234');
    expect(errors.length).toBeGreaterThan(0);
  });
});
