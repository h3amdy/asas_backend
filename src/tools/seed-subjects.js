const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const grades = [
    { id: 2, code: 'KG1', type: 'kg' },
    { id: 3, code: 'KG2', type: 'kg' },

    { id: 4, code: 'B01', type: 'primary' },
    { id: 5, code: 'B02', type: 'primary' },
    { id: 6, code: 'B03', type: 'primary' },
    { id: 7, code: 'B04', type: 'primary' },
    { id: 8, code: 'B05', type: 'primary' },
    { id: 9, code: 'B06', type: 'primary' },

    { id: 10, code: 'B07', type: 'prep' },
    { id: 11, code: 'B08', type: 'prep' },
    { id: 12, code: 'B09', type: 'prep' },

    { id: 13, code: 'S01', type: 'secondary' },
    { id: 14, code: 'S02', type: 'secondary' },
    { id: 15, code: 'S03', type: 'secondary' }
  ];

  // أكواد دلالية ثابتة للمواد
  const SUBJECT_CODES = {
    'القرآن الكريم': 'QR',
    'التربية الإسلامية': 'IS',
    'اللغة العربية': 'AR',
    'اللغة الإنجليزية': 'EN',
    'الرياضيات': 'MA',
    'العلوم': 'SC',
    'الاجتماعيات': 'SO',
    'التربية الوطنية': 'NA',
    'الفيزياء': 'PH',
    'الكيمياء': 'CH',
    'الأحياء': 'BI'
  };

  const subjectsMap = {
    kg: [
      { name: 'القرآن الكريم', short: 'قرآن' },
      { name: 'التربية الإسلامية', short: 'إسلامية' },
      { name: 'اللغة العربية', short: 'عربي' },
      { name: 'الرياضيات', short: 'رياضيات' }
    ],

    primary: [
      { name: 'القرآن الكريم', short: 'قرآن' },
      { name: 'التربية الإسلامية', short: 'إسلامية' },
      { name: 'اللغة العربية', short: 'عربي' },
      { name: 'الرياضيات', short: 'رياضيات' },
      { name: 'العلوم', short: 'علوم' },
      { name: 'التربية الوطنية', short: 'وطنية' }
    ],

    prep: [
      { name: 'القرآن الكريم', short: 'قرآن' },
      { name: 'التربية الإسلامية', short: 'إسلامية' },
      { name: 'اللغة العربية', short: 'عربي' },
      { name: 'اللغة الإنجليزية', short: 'إنجليزي' },
      { name: 'الرياضيات', short: 'رياضيات' },
      { name: 'العلوم', short: 'علوم' },
      { name: 'الاجتماعيات', short: 'اجتماعيات' }
    ],

    secondary: [
      { name: 'القرآن الكريم', short: 'قرآن' },
      { name: 'التربية الإسلامية', short: 'إسلامية' },
      { name: 'اللغة العربية', short: 'عربي' },
      { name: 'اللغة الإنجليزية', short: 'إنجليزي' },
      { name: 'الرياضيات', short: 'رياضيات' },
      { name: 'الفيزياء', short: 'فيزياء' },
      { name: 'الكيمياء', short: 'كيمياء' },
      { name: 'الأحياء', short: 'أحياء' }
    ]
  };

  console.log('Starting seeding subjects...');

  for (const grade of grades) {
    const list = subjectsMap[grade.type];

    for (let i = 0; i < list.length; i++) {
      const subject = list[i];

      await prisma.subjectDictionary.create({
        data: {
          gradeDictionaryId: grade.id,

          // مثال: B01-MA / S03-PH
          code: `${grade.code}-${SUBJECT_CODES[subject.name]}`,

          defaultName: subject.name,
          shortName: subject.short,

          sortOrder: i + 1,

          isActive: true
        }
      });
    }
  }

  console.log('Seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });