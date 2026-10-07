import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const school = await prisma.school.findFirst({ where: { schoolCode: 99001 } });
  if (!school) return;
  
  const subjects = await prisma.subjectDictionary.findMany();
  const linkedGradeDictIds = [...new Set(subjects.map(s => s.gradeDictionaryId))].filter(Boolean) as number[];
  
  console.log("Subject dictionary grade IDs:", linkedGradeDictIds);
  
  for (const dictId of linkedGradeDictIds) {
      const existing = await prisma.schoolGrade.findFirst({
          where: { schoolId: school.id, dictionaryId: dictId }
      });
      if (!existing) {
          const dict = await prisma.gradeDictionary.findUnique({ where: { id: dictId }});
          if (dict) {
              const grade = await prisma.schoolGrade.create({
                  data: {
                      schoolId: school.id,
                      dictionaryId: dict.id,
                      displayName: dict.defaultName,
                      shortName: dict.shortName,
                      stage: dict.stage,
                      sortOrder: dict.sortOrder,
                      isActive: true
                  }
              });
              await prisma.section.create({
                  data: { gradeId: grade.id, name: 'A', orderIndex: 1 }
              });
          }
      }
  }
  console.log("✅ Fixed all grade links for school 99001");
}
main().then(() => prisma.$disconnect());
