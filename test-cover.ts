import { PrismaClient, MediaKind, ProcessingStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. إيجاد مادة في القاموس
  const dictSubject = await prisma.subjectDictionary.findFirst({
      where: { isActive: true, isDeleted: false }
  });
  if (!dictSubject) {
    console.log("No dictionary subjects found.");
    return;
  }

  // 3. إنشاء صورة وهمية
  const asset = await prisma.mediaAsset.create({
    data: {
      kind: MediaKind.IMAGE,
      contentType: 'image/png',
      sizeBytes: 1024,
      processingStatus: ProcessingStatus.DONE,
    }
  });

  // 4. ربط الصورة بمادة القاموس
  await prisma.subjectDictionary.update({
    where: { id: dictSubject.id },
    data: { coverMediaAssetId: asset.id }
  });

  // 5. ربط صف المدرسة 99001 بصف القاموس الخاص بهذه المادة
  const school = await prisma.school.findFirst({ where: { schoolCode: 99001 } });
  if (school) {
    const existingGrade = await prisma.schoolGrade.findFirst({
      where: { schoolId: school.id, dictionaryId: dictSubject.gradeDictionaryId }
    });
    
    if (!existingGrade) {
       await prisma.schoolGrade.create({
         data: {
           schoolId: school.id,
           dictionaryId: dictSubject.gradeDictionaryId!,
           displayName: 'Test Grade',
           shortName: 'Test',
           stage: 'BASIC',
           sortOrder: 1,
           isActive: true
         }
       });
    }
    
    // تأكد من وجود شعبة (section) لهذا الصف لأنه مطلوب عند إنشاء مادة
    const grade = await prisma.schoolGrade.findFirst({
      where: { schoolId: school.id, dictionaryId: dictSubject.gradeDictionaryId }
    });
    
    const existingSection = await prisma.section.findFirst({
        where: { gradeId: grade!.id }
    });
    
    if (!existingSection) {
        await prisma.section.create({
            data: {
                gradeId: grade!.id,
                name: 'Test Section',
                orderIndex: 1
            }
        });
    }
  }

  console.log("✅ Seeded test cover image to dictionary subject:", dictSubject.defaultName, "with cover UUID:", asset.uuid);
}

main().then(() => prisma.$disconnect());
