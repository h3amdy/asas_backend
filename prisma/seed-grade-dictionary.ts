// prisma/seed-grade-dictionary.ts
import { PrismaClient, GradeStage } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const grades = [
        // --- رياض الأطفال (KG) ---
        { code: 'KG1', name: 'التمهيدي', short: 'تمهيدي', stage: GradeStage.KG, order: 1 },
        { code: 'KG2', name: 'الروضة', short: 'روضة', stage: GradeStage.KG, order: 2 },

        // --- التعليم الأساسي (BASIC) — الصفوف 1-9 ---
        { code: 'B01', name: 'الأول الأساسي', short: '1 أساسي', stage: GradeStage.BASIC, order: 3 },
        { code: 'B02', name: 'الثاني الأساسي', short: '2 أساسي', stage: GradeStage.BASIC, order: 4 },
        { code: 'B03', name: 'الثالث الأساسي', short: '3 أساسي', stage: GradeStage.BASIC, order: 5 },
        { code: 'B04', name: 'الرابع الأساسي', short: '4 أساسي', stage: GradeStage.BASIC, order: 6 },
        { code: 'B05', name: 'الخامس الأساسي', short: '5 أساسي', stage: GradeStage.BASIC, order: 7 },
        { code: 'B06', name: 'السادس الأساسي', short: '6 أساسي', stage: GradeStage.BASIC, order: 8 },
        { code: 'B07', name: 'السابع الأساسي', short: '7 أساسي', stage: GradeStage.BASIC, order: 9 },
        { code: 'B08', name: 'الثامن الأساسي', short: '8 أساسي', stage: GradeStage.BASIC, order: 10 },
        { code: 'B09', name: 'التاسع الأساسي', short: '9 أساسي', stage: GradeStage.BASIC, order: 11 },

        // --- الثانوي (SECONDARY) — الصفوف 1-3 ---
        { code: 'S01', name: 'الأول الثانوي', short: '1 ثانوي', stage: GradeStage.SECONDARY, order: 12 },
        { code: 'S02', name: 'الثاني الثانوي', short: '2 ثانوي', stage: GradeStage.SECONDARY, order: 13 },
        { code: 'S03', name: 'الثالث الثانوي', short: '3 ثانوي', stage: GradeStage.SECONDARY, order: 14 },
    ];

    for (const g of grades) {
        await prisma.gradeDictionary.upsert({
            where: { code: g.code },
            update: {
                defaultName: g.name,
                shortName: g.short,
                stage: g.stage,
                sortOrder: g.order,
                isActive: true,
            },
            create: {
                code: g.code,
                defaultName: g.name,
                shortName: g.short,
                stage: g.stage,
                sortOrder: g.order,
                isActive: true,
            },
        });
    }

    console.log('✅ GradeDictionary seeded — 14 grades (KG:2, BASIC:9, SECONDARY:3)');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
