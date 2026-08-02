// src/owner/imports/utils/import-section.normalizer.spec.ts

import { normalizeSection, normalizeAssignmentSections } from './import-section.normalizer';

describe('normalizeSection', () => {
  it('returns section_name when present', () => {
    expect(normalizeSection({ section_name: 'أ' })).toBe('أ');
  });

  it('trims section_name', () => {
    expect(normalizeSection({ section_name: '  أ  ' })).toBe('أ');
  });

  it('falls back to section', () => {
    expect(normalizeSection({ section: 'ب' })).toBe('ب');
  });

  it('returns null when both missing', () => {
    expect(normalizeSection({})).toBeNull();
  });

  it('returns null for whitespace-only section_name', () => {
    expect(normalizeSection({ section_name: '   ' })).toBeNull();
  });
});

describe('normalizeAssignmentSections', () => {
  it('trims section names', () => {
    expect(normalizeAssignmentSections({ sections: ['  أ  ', ' ب '] }))
      .toEqual(['أ', 'ب']);
  });

  it('deduplicates after trim', () => {
    expect(normalizeAssignmentSections({ sections: ['أ', ' أ ', 'ب'] }))
      .toEqual(['أ', 'ب']);
  });

  it('filters empty strings', () => {
    expect(normalizeAssignmentSections({ sections: ['أ', '', '  ', 'ب'] }))
      .toEqual(['أ', 'ب']);
  });

  it('handles single section_name', () => {
    expect(normalizeAssignmentSections({ section_name: '  أ  ' }))
      .toEqual(['أ']);
  });

  it('returns empty array when section_name is whitespace', () => {
    expect(normalizeAssignmentSections({ section_name: '   ' }))
      .toEqual([]);
  });

  it('returns empty array when nothing provided', () => {
    expect(normalizeAssignmentSections({})).toEqual([]);
  });
});
