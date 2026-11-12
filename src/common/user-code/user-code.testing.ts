// src/common/user-code/user-code.testing.ts
//
// مساعد للاختبارات وسكربتات التهيئة: يحجز رقماً مدرسياً حقيقياً من المولّد المركزي.
// بعد SRS-SCH-NUM-001 أصبح users.code إلزامياً وفريداً، فلا يجوز إنشاء مستخدم بدون رقم
// ولا اختراع أرقام يدوياً (قد تتصادم مع أرقام سيصدرها المولّد لاحقاً).
// الأرقام المحجوزة للاختبارات المحذوفة لاحقاً تبقى فجوة ولا يُعاد إصدارها (سلوك مقصود).

import { PrismaClient } from '@prisma/client';
import { UserCodeGeneratorService } from './user-code-generator.service';

const generator = new UserCodeGeneratorService();

/** يحجز رقماً مدرسياً واحداً في معاملة قصيرة مستقلة */
export async function allocateUserCodeForFixture(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction((tx) => generator.generateUserCode(tx));
}

