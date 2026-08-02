// src/owner/imports/utils/import-name.normalizer.ts

import { normalizePersonName } from '../../../shared/validation/person';

/** الحقول المتوقعة في سجلات الاستيراد */
export interface ImportNameFields {
  first_name?: string;
  second_name?: string;
  third_name?: string;
  last_name?: string;
}

/**
 * تجميع الأسماء المجزأة أو إرجاع الاسم الكامل.
 *
 * أولوية: fullNameKey (مثل student_name) أولاً **إذا كان غير فارغ بعد التطبيع**.
 * إذا غائب أو فارغ بعد التطبيع → تجميع الأسماء المجزأة (first + second + third + last).
 * لا يُدمج الصيغتين معاً.
 *
 * كل جزء يمر عبر normalizePersonName() وليس trim() فقط.
 *
 * @param record - سجل الاستيراد (DTO أو plain object)
 * @param fullNameKey - اسم الحقل الكامل (مثل 'student_name' أو 'teacher_name' أو 'name')
 * @returns الاسم المُطبّع، أو null إذا لم يوجد اسم
 */
export function normalizeImportName(record: object, fullNameKey: string): string | null {
  const rec = record as Record<string, unknown>;
  // صيغة 1: اسم كامل (أولوية — لا يُدمج مع الأسماء المجزأة)
  // لكن إذا كان فارغاً بعد التطبيع → fallback إلى split names
  if (rec[fullNameKey] != null) {
    const normalized = normalizePersonName(rec[fullNameKey]);
    if (typeof normalized === 'string' && normalized.length > 0) {
      return normalized;
    }
    // fullName فارغ بعد التطبيع (مثل "   ") → fallback
  }

  // صيغة 2: أسماء مجزأة — كل جزء يمر عبر normalizePersonName
  const parts = [
    rec.first_name,
    rec.second_name,
    rec.third_name,
    rec.last_name,
  ]
    .map((p) => (typeof p === 'string' ? normalizePersonName(p) : null))
    .filter((p): p is string => typeof p === 'string' && p.length > 0);

  return parts.length > 0 ? parts.join(' ') : null;
}
