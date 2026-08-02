// src/owner/imports/utils/import-section.normalizer.ts

/** سجل يحتوي حقل شعبة (طالب) */
interface SectionRecord {
  section_name?: string;
  section?: string;
}

/** سجل إسناد مادة (معلم) */
interface AssignmentRecord {
  sections?: string[];
  section_name?: string;
}

/**
 * يوحّد اسم الشعبة: يقبل section_name أو section
 */
export function normalizeSection(record: SectionRecord): string | null {
  return record.section_name?.trim() || record.section?.trim() || null;
}

/**
 * يوحّد شعب الإسناد: يقبل sections[] أو section_name (string)
 * يطبّع: trim + filter empty + deduplicate
 * فارغ = جميع الشعب (DEC-ADM-091-06)
 */
export function normalizeAssignmentSections(assignment: AssignmentRecord): string[] {
  let sections: string[] = [];

  if (assignment.sections && assignment.sections.length > 0) {
    sections = assignment.sections;
  } else if (assignment.section_name) {
    sections = [assignment.section_name];
  }

  // trim + filter empty + deduplicate
  const trimmed = sections
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return [...new Set(trimmed)];
}
