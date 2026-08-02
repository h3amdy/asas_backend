// src/owner/imports/utils/import-name.normalizer.spec.ts

import { normalizeImportName } from './import-name.normalizer';

describe('normalizeImportName', () => {
  // ─── fullName priority ───────────────────────────────────
  it('uses student_name when present and non-empty', () => {
    const record = { student_name: 'محمد أحمد العلي', first_name: 'تجاهلني' };
    expect(normalizeImportName(record, 'student_name')).toBe('محمد أحمد العلي');
  });

  it('uses teacher_name when present', () => {
    const record = { teacher_name: 'فاطمة عبدالله' };
    expect(normalizeImportName(record, 'teacher_name')).toBe('فاطمة عبدالله');
  });

  // ─── fullName whitespace → fallback to split ─────────────
  it('falls back to split names when fullName is whitespace-only', () => {
    const record = { student_name: '   ', first_name: 'أحمد', last_name: 'علي' };
    expect(normalizeImportName(record, 'student_name')).toBe('أحمد علي');
  });

  it('falls back when fullName is null', () => {
    const record = { student_name: null, first_name: 'سالم' };
    expect(normalizeImportName(record, 'student_name')).toBe('سالم');
  });

  // ─── split names ─────────────────────────────────────────
  it('joins split names with spaces', () => {
    const record = { first_name: 'أحمد', second_name: 'محمد', last_name: 'العمري' };
    expect(normalizeImportName(record, 'student_name')).toBe('أحمد محمد العمري');
  });

  it('normalizes each split name part (trim + collapse)', () => {
    const record = { first_name: '  محمد   أحمد  ', last_name: '  العلي  ' };
    expect(normalizeImportName(record, 'student_name')).toBe('محمد أحمد العلي');
  });

  it('skips empty/whitespace parts', () => {
    const record = { first_name: 'أحمد', second_name: '   ', last_name: 'علي' };
    expect(normalizeImportName(record, 'student_name')).toBe('أحمد علي');
  });

  // ─── no name at all ──────────────────────────────────────
  it('returns null when no name provided', () => {
    const record = { gender: 'MALE' };
    expect(normalizeImportName(record, 'student_name')).toBeNull();
  });

  it('returns null when all parts are whitespace', () => {
    const record = { first_name: '   ', second_name: '  ' };
    expect(normalizeImportName(record, 'student_name')).toBeNull();
  });

  // ─── single character name ───────────────────────────────
  it('accepts single character name', () => {
    const record = { first_name: 'أ' };
    expect(normalizeImportName(record, 'student_name')).toBe('أ');
  });

  // ─── parent name ─────────────────────────────────────────
  it('works with parent name key', () => {
    const record = { name: 'محمد الأحمد', first_name: 'تجاهل' };
    expect(normalizeImportName(record, 'name')).toBe('محمد الأحمد');
  });
});
