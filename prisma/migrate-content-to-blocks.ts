/**
 * سكربت هجرة البيانات من lesson_contents القديم إلى lesson_content_blocks + lesson_block_items الجديد
 *
 * المنطق:
 * - لكل LessonTemplate يحتوي lesson_contents غير محذوفة:
 *   1. إنشاء LessonContentBlock واحد (فقرة واحدة) بعنوان null
 *   2. تحويل كل LessonContent إلى LessonBlockItem
 *
 * التشغيل:
 *   npx ts-node prisma/migrate-content-to-blocks.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 بدء هجرة محتوى الدروس...');

    // 1. جلب كل LessonTemplates التي لها محتوى غير محذوف
    const templates = await prisma.lessonTemplate.findMany({
        where: {
            contents: {
                some: { isDeleted: false },
            },
        },
        include: {
            contents: {
                where: { isDeleted: false },
                orderBy: { orderIndex: 'asc' },
                include: {
                    mediaAsset: { select: { id: true } },
                },
            },
        },
    });

    console.log(`📋 وجدت ${templates.length} قالب درس يحتوي محتوى`);

    let blocksCreated = 0;
    let itemsCreated = 0;
    let skipped = 0;

    for (const template of templates) {
        // تحقق: هل تم الهجرة مسبقاً؟
        const existingBlocks = await prisma.lessonContentBlock.count({
            where: { templateId: template.id, isDeleted: false },
        });

        if (existingBlocks > 0) {
            skipped++;
            continue;
        }

        // إنشاء فقرة واحدة تحتوي كل العناصر القديمة
        await prisma.$transaction(async (tx) => {
            const block = await tx.lessonContentBlock.create({
                data: {
                    templateId: template.id,
                    title: null, // البيانات القديمة ليس لها عنوان فقرة
                    orderIndex: 1,
                },
            });

            blocksCreated++;

            // تحويل كل content إلى block item
            for (let i = 0; i < template.contents.length; i++) {
                const content = template.contents[i];

                await tx.lessonBlockItem.create({
                    data: {
                        blockId: block.id,
                        itemType: content.type, // TEXT | IMAGE | AUDIO
                        orderIndex: i + 1,
                        textContent: content.contentText,
                        mediaAssetId: content.mediaAssetId,
                        caption: content.title, // العنوان القديم يصبح caption
                    },
                });

                itemsCreated++;
            }
        });
    }

    console.log('✅ تمت الهجرة بنجاح!');
    console.log(`   📦 فقرات أُنشئت: ${blocksCreated}`);
    console.log(`   📄 عناصر أُنشئت: ${itemsCreated}`);
    console.log(`   ⏭️  تم تخطيها (هاجرت مسبقاً): ${skipped}`);
}

main()
    .catch((e) => {
        console.error('❌ خطأ في الهجرة:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
