// src/common/user-code/user-code-generator.service.ts
//
// المولّد المركزي للرقم المدرسي الموحد — SRS-SCH-NUM-001 §4.1
//
// الرقم = البادئة (22..29) × 100000 + Feistel(العداد الذري للبادئة)
// - العداد allocated_count لا يتراجع أبداً → لا يُعاد إصدار أي رقم حتى بعد الحذف.
// - tx إلزامي: الحجز يجب أن يكون جزءاً من معاملة واحدة.

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma, UserType } from '@prisma/client';
import { USER_CODE_ALGORITHMS, USER_CODE_SUFFIX_DOMAIN } from './user-code-permutation';

export const USER_CODE_FIRST_PREFIX = 22;
export const USER_CODE_LAST_PREFIX = 29;

type ReservedRange = {
  start: number;
  taken: number;
  algorithm_version: number;
};

@Injectable()
export class UserCodeGeneratorService {
  /**
   * رقم مدرسي واحد — يُستدعى داخل tx الخاصة بإنشاء المستخدم،
   * ويُفضَّل بعد العمليات البطيئة (مثل bcrypt.hash) لتقصير مدة قفل صف البادئة.
   */
  async generateUserCode(tx: Prisma.TransactionClient, _userType?: UserType): Promise<number> {
    const [code] = await this.allocateCodes(1, tx);
    return code;
  }

  /**
   * يحجز n رقماً ذرياً مع عبور حد البادئة عند الحاجة.
   *
   * للاستيراد الجماعي: يُستدعى داخل prisma.$transaction قصيرة مستقلة قبل معاملة الاستيراد
   * الطويلة، حتى لا يبقى صف البادئة مقفلاً طوال الاستيراد. الأرقام المحجوزة التي لا تُستخدم
   * (عند فشل الاستيراد) تبقى فجوة ولا يُعاد إصدارها.
   */
  async allocateCodes(n: number, tx: Prisma.TransactionClient): Promise<number[]> {
    if (!Number.isInteger(n) || n <= 0) return [];

    const codes: number[] = [];
    let remaining = n;

    for (
      let prefix = USER_CODE_FIRST_PREFIX;
      prefix <= USER_CODE_LAST_PREFIX && remaining > 0;
      prefix++
    ) {
      // FOR UPDATE على بادئة محددة (بدون LIMIT): بعد انتظار القفل يعيد PostgreSQL تقييم
      // الشرط على أحدث نسخة من الصف → لا تجاوز للسعة ولا «استنفاد» كاذب تحت التزامن.
      const rows = await tx.$queryRaw<ReservedRange[]>`
        WITH locked AS (
          SELECT "prefix", "allocated_count" AS old_count, "capacity", "algorithm_version"
          FROM "user_code_ranges"
          WHERE "prefix" = ${prefix} AND "allocated_count" < "capacity"
          FOR UPDATE
        )
        UPDATE "user_code_ranges" r
        SET "allocated_count" = LEAST(l.old_count + ${remaining}::int, l."capacity"),
            "updated_at" = NOW()
        FROM locked l
        WHERE r."prefix" = l."prefix"
        RETURNING l.old_count AS "start",
                  (r."allocated_count" - l.old_count) AS "taken",
                  l."algorithm_version" AS "algorithm_version"
      `;

      if (!rows.length) continue; // البادئة ممتلئة → التالية

      const start = Number(rows[0].start);
      const taken = Number(rows[0].taken);
      const version = Number(rows[0].algorithm_version);

      const permute = USER_CODE_ALGORITHMS[version];
      if (!permute) {
        throw new InternalServerErrorException({
          code: 'USER_CODE_ALGORITHM_UNSUPPORTED',
          message: `إصدار خوارزمية غير مدعوم للبادئة ${prefix}: ${version}`,
        });
      }

      for (let i = 0; i < taken; i++) {
        codes.push(prefix * USER_CODE_SUFFIX_DOMAIN + permute(start + i, prefix));
      }
      remaining -= taken;
    }

    if (remaining > 0) {
      throw new InternalServerErrorException({
        code: 'USER_CODE_CAPACITY_EXHAUSTED',
        message: 'تم استنفاد كافة النطاقات الرقمية المخصصة للأرقام المدرسية',
      });
    }

    return codes;
  }
}

