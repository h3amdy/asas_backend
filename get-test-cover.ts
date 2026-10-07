import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const dictSubject = await prisma.subjectDictionary.findFirst({
    where: { coverMediaAssetId: { not: null } },
    include: {
      gradeDictionary: true,
      coverMediaAsset: true,
    }
  });

  if (dictSubject) {
    console.log("المادة في القاموس:");
    console.log(`اسم المادة: ${dictSubject.defaultName}`);
    console.log(`اسم الصف: ${dictSubject.gradeDictionary?.defaultName}`);
    console.log(`UUID الغلاف: ${dictSubject.coverMediaAsset?.uuid}`);
    
    const importedSubject = await prisma.subject.findFirst({
        where: { dictionaryId: dictSubject.id }
    });
    
    if (importedSubject) {
        console.log("\nالمادة المستوردة في مدرسة الاختبار (99001):");
        console.log(`اسم المادة: ${importedSubject.displayName}`);
        console.log(`ID الغلاف المنسوخ: ${importedSubject.coverMediaAssetId}`);
    } else {
        console.log("\n⚠️ لم يتم استيراد المادة بعد.");
    }
  } else {
    console.log("No subject with cover found.");
  }
}
main().then(() => prisma.$disconnect());
