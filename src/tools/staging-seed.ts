// src/tools/staging-seed.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 STG-001 — Staging Data Seeder
// ═══════════════════════════════════════════════════════════════
//
// نقطة دخول واحدة تستدعي كل seeders بالترتيب الصحيح.
// يُعيد استخدام الأدوات الموجودة (seed_owner, seed-grade-dictionary, seed-subjects)
// ويُضيف بيانات اختبارية للمدارس والمستخدمين.
//
// الاستخدام:
//   npx ts-node src/tools/staging-seed.ts
//   npm run staging:seed
//
// ═══════════════════════════════════════════════════════════════

import { PrismaClient, GradeStage, UserType, AppType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────
// 🛡️ Safety: تأكد أننا في staging
// ─────────────────────────────────────────────────

function ensureStaging(): void {
  const appEnv = process.env.APP_ENV;
  if (appEnv !== 'staging' && appEnv !== 'local') {
    console.error(
      `🚫 staging-seed.ts يرفض التشغيل في APP_ENV="${appEnv}".`,
    );
    console.error('   يعمل فقط مع: staging | local');
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────
// 1️⃣ Seed Owner (مبني على seed_owner.ts)
// ─────────────────────────────────────────────────

async function seedOwner(): Promise<void> {
  const email = 'owner@test.invalid';
  const password = 'test-owner-123';
  const name = 'مالك النظام (اختبار)';

  const exists = await prisma.user.findFirst({
    where: { email, userType: UserType.OWNER, isDeleted: false },
  });

  if (exists) {
    console.log('   ↳ OWNER already exists:', exists.email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      userType: UserType.OWNER,
      name,
      email,
      passwordHash,
      isActive: true,
      isDeleted: false,
      schoolId: null,
    },
  });

  console.log('   ↳ OWNER created:', email);
}

// ─────────────────────────────────────────────────
// 2️⃣ Seed Grades (مبني على seed-grade-dictionary.ts)
// ─────────────────────────────────────────────────

const GRADES_DATA = [
  { code: 'KG1', name: 'التمهيدي', short: 'تمهيدي', stage: GradeStage.KG, order: 1 },
  { code: 'KG2', name: 'الروضة', short: 'روضة', stage: GradeStage.KG, order: 2 },
  { code: 'B01', name: 'الأول الأساسي', short: '1 أساسي', stage: GradeStage.BASIC, order: 3 },
  { code: 'B02', name: 'الثاني الأساسي', short: '2 أساسي', stage: GradeStage.BASIC, order: 4 },
  { code: 'B03', name: 'الثالث الأساسي', short: '3 أساسي', stage: GradeStage.BASIC, order: 5 },
  { code: 'B04', name: 'الرابع الأساسي', short: '4 أساسي', stage: GradeStage.BASIC, order: 6 },
  { code: 'B05', name: 'الخامس الأساسي', short: '5 أساسي', stage: GradeStage.BASIC, order: 7 },
  { code: 'B06', name: 'السادس الأساسي', short: '6 أساسي', stage: GradeStage.BASIC, order: 8 },
  { code: 'B07', name: 'السابع الأساسي', short: '7 أساسي', stage: GradeStage.BASIC, order: 9 },
  { code: 'B08', name: 'الثامن الأساسي', short: '8 أساسي', stage: GradeStage.BASIC, order: 10 },
  { code: 'B09', name: 'التاسع الأساسي', short: '9 أساسي', stage: GradeStage.BASIC, order: 11 },
  { code: 'S01', name: 'الأول الثانوي', short: '1 ثانوي', stage: GradeStage.SECONDARY, order: 12 },
  { code: 'S02', name: 'الثاني الثانوي', short: '2 ثانوي', stage: GradeStage.SECONDARY, order: 13 },
  { code: 'S03', name: 'الثالث الثانوي', short: '3 ثانوي', stage: GradeStage.SECONDARY, order: 14 },
];

async function seedGrades(): Promise<void> {
  for (const g of GRADES_DATA) {
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
  console.log('   ↳ GradeDictionary: 14 grades seeded');
}

// ─────────────────────────────────────────────────
// 3️⃣ Seed Subjects (مبني على seed-subjects.js — TS + lookup by code)
// ─────────────────────────────────────────────────

const SUBJECT_CODES: Record<string, string> = {
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
  'الأحياء': 'BI',
};

interface SubjectEntry {
  name: string;
  short: string;
}

const SUBJECTS_BY_STAGE: Record<string, SubjectEntry[]> = {
  kg: [
    { name: 'القرآن الكريم', short: 'قرآن' },
    { name: 'التربية الإسلامية', short: 'إسلامية' },
    { name: 'اللغة العربية', short: 'عربي' },
    { name: 'الرياضيات', short: 'رياضيات' },
  ],
  primary: [
    { name: 'القرآن الكريم', short: 'قرآن' },
    { name: 'التربية الإسلامية', short: 'إسلامية' },
    { name: 'اللغة العربية', short: 'عربي' },
    { name: 'الرياضيات', short: 'رياضيات' },
    { name: 'العلوم', short: 'علوم' },
    { name: 'التربية الوطنية', short: 'وطنية' },
  ],
  prep: [
    { name: 'القرآن الكريم', short: 'قرآن' },
    { name: 'التربية الإسلامية', short: 'إسلامية' },
    { name: 'اللغة العربية', short: 'عربي' },
    { name: 'اللغة الإنجليزية', short: 'إنجليزي' },
    { name: 'الرياضيات', short: 'رياضيات' },
    { name: 'العلوم', short: 'علوم' },
    { name: 'الاجتماعيات', short: 'اجتماعيات' },
  ],
  secondary: [
    { name: 'القرآن الكريم', short: 'قرآن' },
    { name: 'التربية الإسلامية', short: 'إسلامية' },
    { name: 'اللغة العربية', short: 'عربي' },
    { name: 'اللغة الإنجليزية', short: 'إنجليزي' },
    { name: 'الرياضيات', short: 'رياضيات' },
    { name: 'الفيزياء', short: 'فيزياء' },
    { name: 'الكيمياء', short: 'كيمياء' },
    { name: 'الأحياء', short: 'أحياء' },
  ],
};

const GRADE_CODE_TO_STAGE: Record<string, string> = {
  KG1: 'kg', KG2: 'kg',
  B01: 'primary', B02: 'primary', B03: 'primary',
  B04: 'primary', B05: 'primary', B06: 'primary',
  B07: 'prep', B08: 'prep', B09: 'prep',
  S01: 'secondary', S02: 'secondary', S03: 'secondary',
};

async function seedSubjects(): Promise<void> {
  let count = 0;

  for (const [gradeCode, stageKey] of Object.entries(GRADE_CODE_TO_STAGE)) {
    // البحث عبر code وليس ID — آمن بعد reset
    const grade = await prisma.gradeDictionary.findUnique({
      where: { code: gradeCode },
    });

    if (!grade) {
      console.warn(`   ⚠ Grade ${gradeCode} not found — skipping subjects`);
      continue;
    }

    const subjects = SUBJECTS_BY_STAGE[stageKey];
    for (let i = 0; i < subjects.length; i++) {
      const subj = subjects[i];
      const code = `${gradeCode}-${SUBJECT_CODES[subj.name]}`;

      await prisma.subjectDictionary.upsert({
        where: { code },
        update: {
          defaultName: subj.name,
          shortName: subj.short,
          sortOrder: i + 1,
          isActive: true,
        },
        create: {
          gradeDictionaryId: grade.id,
          code,
          defaultName: subj.name,
          shortName: subj.short,
          sortOrder: i + 1,
          isActive: true,
        },
      });
      count++;
    }
  }

  console.log(`   ↳ SubjectDictionary: ${count} subjects seeded`);
}

// ─────────────────────────────────────────────────
// 4️⃣ Seed Test Schools (جديد)
// ─────────────────────────────────────────────────

interface SchoolDef {
  name: string;
  code: number;
  appType: AppType;
}

const TEST_SCHOOLS: SchoolDef[] = [
  { name: 'مدرسة اختبار أ', code: 99001, appType: AppType.PUBLIC },
  { name: 'مدرسة اختبار ب', code: 99002, appType: AppType.PUBLIC },
];

async function seedSchools(): Promise<void> {
  for (const schoolDef of TEST_SCHOOLS) {
    const exists = await prisma.school.findFirst({
      where: { schoolCode: schoolDef.code },
    });

    if (exists) {
      console.log(`   ↳ School "${schoolDef.name}" already exists`);
      continue;
    }

    await prisma.school.create({
      data: {
        name: schoolDef.name,
        schoolCode: schoolDef.code,
        appType: schoolDef.appType,
        isActive: true,
      },
    });

    console.log(`   ↳ School "${schoolDef.name}" created`);
  }
}

// ─────────────────────────────────────────────────
// 5️⃣ Seed Test Users (جديد)
// ─────────────────────────────────────────────────

interface UserDef {
  email: string;
  password: string;
  name: string;
  userType: UserType;
  schoolCode: number;
  code?: number;     // رقم مدرسي — للدخول عبر school auth
  phone?: string;    // هاتف — لولي الأمر
}

const TEST_USERS: UserDef[] = [
  // مدرسة أ
  { email: 'admin-a@test.invalid', password: 'test-admin-123', name: 'مدير مدرسة أ', userType: UserType.ADMIN, schoolCode: 99001, code: 1001 },
  { email: 'teacher-a@test.invalid', password: 'test-teacher-123', name: 'معلم مدرسة أ', userType: UserType.TEACHER, schoolCode: 99001, code: 2001 },
  { email: 'student-a@test.invalid', password: 'test-student-123', name: 'طالب مدرسة أ', userType: UserType.STUDENT, schoolCode: 99001, code: 3001 },
  { email: 'parent-a@test.invalid', password: 'test-parent-123', name: 'ولي أمر مدرسة أ', userType: UserType.PARENT, schoolCode: 99001, phone: '770000001' },
  // مدرسة ب
  { email: 'admin-b@test.invalid', password: 'test-admin-123', name: 'مدير مدرسة ب', userType: UserType.ADMIN, schoolCode: 99002, code: 1001 },
  { email: 'teacher-b@test.invalid', password: 'test-teacher-123', name: 'معلم مدرسة ب', userType: UserType.TEACHER, schoolCode: 99002, code: 2001 },
  { email: 'student-b@test.invalid', password: 'test-student-123', name: 'طالب مدرسة ب', userType: UserType.STUDENT, schoolCode: 99002, code: 3001 },
];

async function seedUsers(): Promise<void> {
  for (const userDef of TEST_USERS) {
    const exists = await prisma.user.findFirst({
      where: { email: userDef.email, isDeleted: false },
    });

    if (exists) {
      console.log(`   ↳ User "${userDef.email}" already exists`);
      continue;
    }

    const school = await prisma.school.findFirst({
      where: { schoolCode: userDef.schoolCode },
    });

    if (!school) {
      console.warn(`   ⚠ School ${userDef.schoolCode} not found — skipping ${userDef.email}`);
      continue;
    }

    const passwordHash = await bcrypt.hash(userDef.password, 10);

    const user = await prisma.user.create({
      data: {
        userType: userDef.userType,
        name: userDef.name,
        email: userDef.email,
        code: userDef.code ?? null,
        phone: userDef.phone ?? null,
        passwordHash,
        isActive: true,
        schoolId: school.id,
      },
    });

    // إنشاء سجلات Teacher/Student/Parent المرتبطة
    if (userDef.userType === UserType.TEACHER) {
      await prisma.teacher.create({
        data: { userId: user.id },
      });
    } else if (userDef.userType === UserType.STUDENT) {
      await prisma.student.create({
        data: { userId: user.id },
      });
    } else if (userDef.userType === UserType.PARENT) {
      await prisma.parent.create({
        data: { userId: user.id },
      });
    }

    console.log(`   ↳ User "${userDef.email}" created (${userDef.userType})`);
  }
}

// ─────────────────────────────────────────────────
// 6️⃣ Seed Academic Structure (جديد — اختياري)
// ─────────────────────────────────────────────────

async function seedAcademicStructure(): Promise<void> {
  // إنشاء سنة + فصل لكل مدرسة اختبار
  for (const schoolDef of TEST_SCHOOLS) {
    const school = await prisma.school.findFirst({
      where: { schoolCode: schoolDef.code },
    });

    if (!school) continue;

    // سنة دراسية
    const existingYear = await prisma.year.findFirst({
      where: { schoolId: school.id },
    });

    if (existingYear) {
      console.log(`   ↳ Year for "${schoolDef.name}" already exists`);
      continue;
    }

    const year = await prisma.year.create({
      data: {
        schoolId: school.id,
        name: '2026-2027',
        isCurrent: true,
      },
    });

    // فصل دراسي أول
    await prisma.term.create({
      data: {
        yearId: year.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        isCurrent: true,
      },
    });

    // إضافة صف (B01 — الأول الأساسي) لكل مدرسة
    const gradeDict = await prisma.gradeDictionary.findUnique({
      where: { code: 'B01' },
    });

    if (gradeDict) {
      const schoolGrade = await prisma.schoolGrade.create({
        data: {
          schoolId: school.id,
          dictionaryId: gradeDict.id,
          displayName: gradeDict.defaultName,
          shortName: gradeDict.shortName,
          sortOrder: gradeDict.sortOrder,
          stage: gradeDict.stage,
          isActive: true,
        },
      });

      // شعبة واحدة
      await prisma.section.create({
        data: {
          gradeId: schoolGrade.id,
          name: 'أ',
          orderIndex: 1,
        },
      });
    }

    console.log(`   ↳ Academic structure for "${schoolDef.name}" created (year + term + grade + section)`);
  }
}

// ─────────────────────────────────────────────────
// 🚀 Main — الترتيب مهم (بسبب العلاقات)
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureStaging();

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('🧪 STG-001 — Staging Seed');
  console.log(`   APP_ENV: ${process.env.APP_ENV}`);
  console.log('════════════════════════════════════════════');
  console.log('');

  console.log('1/6 — Owner...');
  await seedOwner();

  console.log('2/6 — Grade Dictionary...');
  await seedGrades();

  console.log('3/6 — Subject Dictionary...');
  await seedSubjects();

  console.log('4/6 — Test Schools...');
  await seedSchools();

  console.log('5/6 — Test Users...');
  await seedUsers();

  console.log('6/6 — Academic Structure...');
  await seedAcademicStructure();

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('✅ Staging seed complete!');
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log('Test accounts:');
  console.log('  owner@test.invalid       / test-owner-123');
  console.log('  admin-a@test.invalid     / test-admin-123');
  console.log('  teacher-a@test.invalid   / test-teacher-123');
  console.log('  student-a@test.invalid   / test-student-123');
  console.log('  parent-a@test.invalid    / test-parent-123');
  console.log('  admin-b@test.invalid     / test-admin-123');
  console.log('  teacher-b@test.invalid   / test-teacher-123');
  console.log('  student-b@test.invalid   / test-student-123');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Staging seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
