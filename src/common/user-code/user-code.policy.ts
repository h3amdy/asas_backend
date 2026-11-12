// src/common/user-code/user-code.policy.ts
//
// سياسة استخدام الرقم المدرسي الموحد في الدخول والمساعدة (SRS-SCH-NUM-001 §1.1, §4.3, §4.4).
// مصدر واحد تستورده المصادقة ونقطة «نسيت بيانات الدخول» حتى لا تتباعد الشروط.

import { UserType } from '@prisma/client';
import { USER_CODE_FIRST_PREFIX, USER_CODE_LAST_PREFIX } from './user-code-generator.service';
import { USER_CODE_SUFFIX_DOMAIN } from './user-code-permutation';

/**
 * الأدوار التي يحق لها الدخول بالرقم المدرسي.
 * OWNER مستبعد صراحةً (OD-NUM-003): يحمل رقماً لكنه يدخل من لوحة المنصة فقط.
 * لا نعتمد على كون OWNER بلا مدرسة — الاستبعاد بالدور نفسه.
 */
export const SCHOOL_LOGIN_ROLES: readonly UserType[] = [
  UserType.ADMIN,
  UserType.TEACHER,
  UserType.STUDENT,
  UserType.PARENT,
];

export const USER_CODE_MIN = USER_CODE_FIRST_PREFIX * USER_CODE_SUFFIX_DOMAIN; // 2200000
export const USER_CODE_MAX = (USER_CODE_LAST_PREFIX + 1) * USER_CODE_SUFFIX_DOMAIN - 1; // 2999999

/**
 * يحلّل نصاً إلى رقم مدرسي صالح الصيغة، أو null.
 * أرقام لاتينية فقط وطول 7 خانات ضمن النطاق — لا يُقبل `+`, مسافات داخلية, أو أصفار بادئة.
 */
export function parseUserCode(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (!/^[2-9]\d{6}$/.test(s)) return null;
  const n = Number(s);
  return n >= USER_CODE_MIN && n <= USER_CODE_MAX ? n : null;
}

