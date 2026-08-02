// src/shared/validation/person/person.normalizers.spec.ts

import { normalizePhone, normalizePersonName } from './person.normalizers';

describe('normalizePhone', () => {
  // ─── null/undefined → يبقى كما هو ───────────────────────
  it('returns null for null', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('returns undefined for undefined', () => {
    expect(normalizePhone(undefined)).toBeUndefined();
  });

  // ─── non-string → يبقى كما هو (IsString يرفضه) ──────────
  it('returns number as-is for numeric phone', () => {
    expect(normalizePhone(777123456)).toBe(777123456);
  });

  it('returns boolean as-is', () => {
    expect(normalizePhone(true)).toBe(true);
  });

  // ─── empty/whitespace → undefined ────────────────────────
  it('returns undefined for empty string', () => {
    expect(normalizePhone('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(normalizePhone('   ')).toBeUndefined();
  });

  // ─── valid phones ────────────────────────────────────────
  it('normalizes plain digits', () => {
    expect(normalizePhone('1234567')).toBe('1234567');
  });

  it('normalizes 15 digits', () => {
    expect(normalizePhone('123456789012345')).toBe('123456789012345');
  });

  it('strips formatting: +, -, spaces, parens', () => {
    expect(normalizePhone('+966 55-123-4567')).toBe('966551234567');
  });

  it('strips parens', () => {
    expect(normalizePhone('(055) 123-4567')).toBe('0551234567');
  });

  // ─── Arabic/Persian digits → ASCII ───────────────────────
  it('converts Arabic-Indic digits (٠-٩) to ASCII', () => {
    expect(normalizePhone('٠٥٥١٢٣٤٥٦٧')).toBe('0551234567');
  });

  it('converts Extended Arabic-Indic digits (۰-۹) to ASCII', () => {
    expect(normalizePhone('۰۵۵۱۲۳۴۵۶۷')).toBe('0551234567');
  });

  // ─── alphabetic chars stay (regex will reject) ───────────
  it('does NOT strip alphabetic characters', () => {
    expect(normalizePhone('055ABC1234')).toBe('055ABC1234');
  });

  it('converts Arabic digits but keeps letters', () => {
    expect(normalizePhone('٠٥٥ABC١٢٣٤')).toBe('055ABC1234');
  });
});

describe('normalizePersonName', () => {
  // ─── non-string → يبقى كما هو ───────────────────────────
  it('returns number as-is', () => {
    expect(normalizePersonName(123)).toBe(123);
  });

  it('returns null as-is', () => {
    expect(normalizePersonName(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(normalizePersonName(undefined)).toBeUndefined();
  });

  // ─── normalization ───────────────────────────────────────
  it('trims and collapses whitespace', () => {
    expect(normalizePersonName('  أحمد   محمد  ')).toBe('أحمد محمد');
  });

  it('returns empty string for whitespace-only', () => {
    expect(normalizePersonName('    ')).toBe('');
  });

  it('passes through single character', () => {
    expect(normalizePersonName('أ')).toBe('أ');
  });

  it('handles 200-char name', () => {
    const name = 'أ'.repeat(200);
    expect(normalizePersonName(name)).toBe(name);
  });
});
