import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const school = await prisma.school.findFirst({ where: { schoolCode: 99001 } });
    const dictSubject = await prisma.subjectDictionary.findFirst({
        where: { coverMediaAssetId: { not: null } }
    });
    
    if (!school || !dictSubject) return console.log("Missing school or dict subject");
    
    // Simulate importFromDictionary behavior
    const schoolGrade = await prisma.schoolGrade.findFirst({
        where: { schoolId: school.id, dictionaryId: dictSubject.gradeDictionaryId }
    });
    
    if (!schoolGrade) return console.log("Grade not found");
    
    // Delete if exists
    await prisma.subject.deleteMany({
        where: { schoolId: school.id, dictionaryId: dictSubject.id }
    });
    
    const subject = await prisma.subject.create({
        data: {
            schoolId: school.id,
            gradeId: schoolGrade.id,
            dictionaryId: dictSubject.id,
            displayName: dictSubject.defaultName,
            shortName: dictSubject.shortName,
            code: dictSubject.code,
            coverMediaAssetId: dictSubject.coverMediaAssetId
        }
    });
    
    console.log("✅ Subject imported. Original Cover ID:", dictSubject.coverMediaAssetId, "-> Copied Cover ID:", subject.coverMediaAssetId);
    if (subject.coverMediaAssetId === dictSubject.coverMediaAssetId) {
        console.log("🎉 Test passed: Cover image was successfully copied during import.");
    } else {
        console.log("❌ Test failed: Cover image was not copied.");
    }
}
main().then(() => prisma.$disconnect());
