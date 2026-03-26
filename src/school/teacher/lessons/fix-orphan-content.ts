// src/school/teacher/lessons/fix-orphan-content.ts
//
// سكريبت إصلاح بيانات محتوى الدروس القديمة
// يُنفّذ مرة واحدة لربط LessonContent بـ MediaAsset
//
// الاستخدام:
//   npx ts-node -e "import('./src/school/teacher/lessons/fix-orphan-content').then(m => m.fixOrphanContent())"
//
// أو يمكن استدعاء fixOrphanContent() من أي endpoint مؤقت

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// UUID v4 regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fixOrphanContent(): Promise<void> {
    console.log('🔧 بدء إصلاح بيانات محتوى الدروس القديمة...\n');

    // 1) جلب كل محتوى AUDIO/IMAGE بدون mediaAssetId
    const orphans = await prisma.lessonContent.findMany({
        where: {
            type: { in: ['AUDIO', 'IMAGE'] },
            mediaAssetId: null,
            isDeleted: false,
        },
        include: {
            template: { select: { schoolId: true, uuid: true, title: true } },
        },
    });

    console.log(`📋 وُجد ${orphans.length} سجل بدون mediaAssetId\n`);

    if (orphans.length === 0) {
        console.log('✅ لا توجد بيانات تحتاج إصلاح');
        await prisma.$disconnect();
        return;
    }

    let fixed = 0;
    let skipped = 0;

    for (const content of orphans) {
        const title = content.title?.trim();

        // هل العنوان يبدو UUID؟
        if (!title || !UUID_RE.test(title)) {
            console.log(`  ⏭️ [${content.id}] title="${title}" — ليس UUID, تجاوز`);
            skipped++;
            continue;
        }

        // بحث عن MediaAsset بهذا UUID
        const asset = await prisma.mediaAsset.findFirst({
            where: {
                uuid: title,
                schoolId: content.template.schoolId,
                isDeleted: false,
            },
            select: { id: true, kind: true },
        });

        if (!asset) {
            console.log(`  ⚠️ [${content.id}] UUID="${title}" — لم يُعثر على MediaAsset`);
            skipped++;
            continue;
        }

        // تحديث: ربط mediaAssetId + تغيير العنوان لوصف
        const newTitle = content.type === 'AUDIO' ? 'تسجيل صوتي' : 'صورة';

        await prisma.lessonContent.update({
            where: { id: content.id },
            data: {
                mediaAssetId: asset.id,
                title: newTitle,
            },
        });

        console.log(
            `  ✅ [${content.id}] ${content.type} → mediaAssetId=${asset.id}, ` +
            `title="${title}" → "${newTitle}" ` +
            `(درس: ${content.template.title})`
        );
        fixed++;
    }

    console.log(`\n📊 النتيجة: تم إصلاح ${fixed}, تجاوز ${skipped}`);
    await prisma.$disconnect();
}

// تشغيل مباشر
fixOrphanContent().catch((e) => {
    console.error('❌ خطأ:', e);
    process.exit(1);
});
