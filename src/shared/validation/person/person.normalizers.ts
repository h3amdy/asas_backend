// src/shared/validation/person/person.normalizers.ts

/**
 * تطبيع رقم الهاتف:
 * 1. يحوّل Arabic-Indic digits (٠-٩) إلى ASCII (0-9)
 * 2. يحوّل Extended Arabic-Indic digits (۰-۹) إلى ASCII
 * 3. يزيل أحرف التنسيق: + - مسافات أقواس
 * 4. لا يحذف حروف أبجدية — يتركها للـ validator ليرفضها
 * 5. لا يحوّل النوع الخاطئ — يتركه كما هو ليرفضه IsString()
 *
 * @returns القيمة المُطبّعة، أو القيمة الأصلية إذا لم تكن string
 */
export function normalizePhone(raw: unknown): unknown {
  // null/undefined → يبقى كما هو (IsOptional يتعامل معه)
  if (raw == null) return raw;

  // non-string (number, boolean, ...) → يبقى كما هو ← IsString() يرفضه
  if (typeof raw !== 'string') return raw;

  // Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) → ASCII
  let cleaned = raw.replace(/[٠-٩]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48),
  );
  // Extended Arabic-Indic digits (۰۱۲۳۴۵۶۷۸۹) → ASCII
  cleaned = cleaned.replace(/[۰-۹]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 48),
  );
  // Remove formatting characters only
  cleaned = cleaned.replace(/[\s\-\+\(\)]/g, '');

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * تطبيع اسم الشخص: trim + collapse whitespace
 *
 * لا يخفي النوع الخاطئ — يتركه كما هو ليرفضه IsString()
 *
 * أمثلة:
 *   "  أحمد   محمد  " → "أحمد محمد"
 *   "    "            → "" (يتم رفضه لاحقاً من MinLength)
 *
 * @returns الاسم المُطبّع، أو القيمة الأصلية إذا لم تكن string
 */
export function normalizePersonName(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\s+/g, ' ').trim();
}
