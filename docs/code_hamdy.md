ممتاز 👍 الآن فهمت قصدك بد
prisma/seed-grade-dictionary.ts
```

---

# 🧩 المحتوى المناسب لسكيمتك الحالية (بدون أي تغيير)

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const grades = [
    { code: 'KG1', name: 'التمهيدي', short: 'تمهيدي', stage: 'KG', order: 1 },
    { code: 'KG2', name: 'الروضة', short: 'روضة', stage: 'KG', order: 2 },

    { code: 'B01', name: 'الأول الأساسي', short: '1 أساسي', stage: 'أساسي', order: 3 },
    { code: 'B02', name: 'الثاني الأساسي', short: '2 أساسي', stage: 'أساسي', order: 4 },
    { code: 'B03', name: 'الثالث الأساسي', short: '3 أساسي', stage: 'أساسي', order: 5 },
    { code: 'B04', name: 'الرابع الأساسي', short: '4 أساسي', stage: 'أساسي', order: 6 },
    { code: 'B05', name: 'الخامس الأساسي', short: '5 أساسي', stage: 'أساسي', order: 7 },
    { code: 'B06', name: 'السادس الأساسي', short: '6 أساسي', stage: 'أساسي', order: 8 },
    { code: 'B07', name: 'السابع الأساسي', short: '7 أساسي', stage: 'أساسي', order: 9 },
    { code: 'B08', name: 'الثامن الأساسي', short: '8 أساسي', stage: 'أساسي', order: 10 },
    { code: 'B09', name: 'التاسع الأساسي', short: '9 أساسي', stage: 'أساسي', order: 11 },

    { code: 'S01', name: 'الأول الثانوي', short: '1 ثانوي', stage: 'ثانوي', order: 12 },
    { code: 'S02', name: 'الثاني الثانوي', short: '2 ثانوي', stage: 'ثانوي', order: 13 },
    { code: 'S03', name: 'الثالث الثانوي', short: '3 ثانوي', stage: 'ثانوي', order: 14 },
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

  console.log('✅ GradeDictionary seeded successfully');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

# 🏗 الخطوة 2: ربط seed في package.json

أضف:

```json
"prisma": {
  "seed": "ts-node prisma/seed-grade-dictionary.ts"
}
```

---

# 🏗 الخطوة 3: التنفيذ

```bash
npx prisma db seed
```

---

# 🔒 لماذا هذه الطريقة هي المثالية في مشروعك؟
