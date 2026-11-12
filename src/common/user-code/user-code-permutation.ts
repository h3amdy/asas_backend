// src/common/user-code/user-code-permutation.ts
//
// دالة التبديل الخاصة بالرقم المدرسي الموحد — SRS-SCH-NUM-001 §2.2
//
// ⚠️ مجمّدة: لا يجوز تعديل permuteFiveDigitsV1 أبداً بعد بدء إصدار الأرقام بها.
// أي تطوير يكون بدالة جديدة (permuteFiveDigitsV2) لبادئة لم تُستخدم بعد،
// مع تحديث algorithm_version لتلك البادئة في جدول user_code_ranges.
//
// يجب أن تبقى مطابقة حرفياً لدالة PostgreSQL asas_permute_five_digits_v1
// (انظر مهاجرة unified_school_number) ولمتجهات الاختبار الذهبية §2.3.

/** حجم مجال الجزء المتغير (5 خانات) */
export const USER_CODE_SUFFIX_DOMAIN = 100_000;

/**
 * تبديل تقابلي (Bijection) على المجال [0 .. 99,999]:
 * شبكة Feistel متوازنة 18-bit (9+9) بأربع جولات + Cycle Walking.
 * كل عداد مختلف داخل المجال ينتج قيمة مختلفة داخل المجال (صفر تصادم).
 *
 * ليست تشفيراً: تبعثر الأرقام فقط ولا تمنع التنبؤ لمن يعرف الخوارزمية.
 */
export function permuteFiveDigitsV1(counter: number, prefix: number): number {
  if (!Number.isInteger(counter) || counter < 0 || counter >= USER_CODE_SUFFIX_DOMAIN) {
    throw new RangeError(`USER_CODE_COUNTER_OUT_OF_RANGE: ${counter}`);
  }
  let x = counter;
  do {
    let l = (x >> 9) & 0x1ff;
    let r = x & 0x1ff;
    for (let round = 0; round < 4; round++) {
      const f = (((r * 313 + prefix * 97 + round * 131) ^ (r >> 3)) * 251) & 0x1ff;
      const nextL = r;
      r = l ^ f;
      l = nextL;
    }
    x = (l << 9) | r;
  } while (x >= USER_CODE_SUFFIX_DOMAIN);
  return x;
}

/** خريطة إصدارات الخوارزمية المدعومة — المفتاح هو algorithm_version في user_code_ranges */
export const USER_CODE_ALGORITHMS: Readonly<Record<number, (counter: number, prefix: number) => number>> = {
  1: permuteFiveDigitsV1,
};

