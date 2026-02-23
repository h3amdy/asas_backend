نعم 👍 فهمت تمامًا ما تريد.

أنت تريد أن يصبح السيرفر قادرًا على:

1. 🔹 جلب الصفوف الرسمية من `GradeDictionary`
2. 🔹 إضافة صف للمدرسة من القاموس الرسمي
3. 🔹 إضافة صف مخصص (Local)
4. 🔹 منع التكرار (لا يمكن إضافة نفس الصف الرسمي مرتين لنفس المدرسة)
5. 🔹 دعم المعالج (Wizard) في اختيار صفوف جاهزة أو إنشاء مخصصة

والآن سنراجع الكود الحالي ونعدّله ليصبح Production-ready.

---

# 🎯 أولًا: هل الكود الحالي يدعم هذا؟

## createGrade الحالي:

```ts
dictionaryId: dto.dictionaryId ?? null,
isLocal: dto.isLocal ?? (dto.dictionaryId ? false : true),
```

هذا يسمح:

* بإنشاء صف من القاموس (dictionaryId موجود)
* أو صف مخصص (dictionaryId = null + isLocal = true)

✅ جيد.

لكن يوجد 3 مشاكل مهمة:

---

# ⚠️ المشكلة 1 — لا يوجد Endpoint لجلب القاموس

لا يوجد:

```http
GET /school/manager/grade-dictionary
```

لا يمكن للـ Flutter عرض الصفوف الرسمية للاختيار.

---

# ⚠️ المشكلة 2 — لا يوجد منع لإضافة نفس الصف الرسمي مرتين

حاليًا يمكن:

* إضافة dictionaryId = 5
* ثم إعادة إضافته مرة أخرى

لا يوجد unique constraint يمنع ذلك.

---

# ⚠️ المشكلة 3 — createGrade لا يتحقق من صحة dictionaryId

لو أرسل Flutter:

```json
{ "dictionaryId": 9999 }
```

والـ ID غير موجود → سيحدث خطأ ForeignKey 500.

---

# 🏗 الحل المعماري الصحيح

سنضيف:

1️⃣ Endpoint لجلب GradeDictionary
2️⃣ Unique constraint لمنع تكرار الصف الرسمي
3️⃣ تحقق منطقي في السيرفر قبل الإنشاء

---

# ✅ أول تعديل — منع تكرار الصف الرسمي

في Prisma:

```prisma
model SchoolGrade {
  ...
  @@unique([schoolId, dictionaryId], map: "uq_school_dictionary_grade")
}
```

لكن ⚠️ يجب أن يكون:

* dictionaryId nullable
* والـ unique يعمل فقط إذا dictionaryId != null

في PostgreSQL نحتاج partial unique index:

```sql
CREATE UNIQUE INDEX uq_school_dictionary_grade
ON school_grades (school_id, dictionary_id)
WHERE dictionary_id IS NOT NULL AND is_deleted = false;
```

🔥 هذا مهم جدًا.

---

# ✅ ثاني تعديل — إضافة GradeDictionary Endpoint

## Controller

```ts
@Get('/dictionary')
listDictionary() {
  return this.service.listGradeDictionary();
}
```

---

## Service

```ts
async listGradeDictionary() {
  return this.prisma.gradeDictionary.findMany({
    where: {
      isDeleted: false,
      isActive: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
}
```

الآن Flutter يمكنه عرض الصفوف الرسمية.

---

# ✅ ثالث تعديل — تحسين createGrade

نعدل createGrade ليصبح احترافيًا:

```ts
async createGrade(schoolId: number, dto: CreateGradeDto) {
  try {
    return await this.prisma.$transaction(async (tx) => {

      // 🔍 إذا كان من القاموس
      if (dto.dictionaryId) {
        const dictionary = await tx.gradeDictionary.findFirst({
          where: {
            id: dto.dictionaryId,
            isDeleted: false,
            isActive: true,
          },
        });

        if (!dictionary) {
          throw new BadRequestException('INVALID_DICTIONARY_GRADE');
        }

        // تحقق من عدم إضافته مسبقًا
        const exists = await tx.schoolGrade.findFirst({
          where: {
            schoolId,
            dictionaryId: dto.dictionaryId,
            isDeleted: false,
          },
        });

        if (exists) {
          throw new ConflictException('GRADE_ALREADY_ADDED');
        }

        // إذا لم يرسل displayName نأخذه من القاموس
        dto.displayName = dto.displayName ?? dictionary.defaultName;
        dto.shortName = dto.shortName ?? dictionary.shortName;
      }

      const grade = await tx.schoolGrade.create({
        data: {
          schoolId,
          dictionaryId: dto.dictionaryId ?? null,
          displayName: dto.displayName,
          shortName: dto.shortName,
          sortOrder: dto.sortOrder,
          isLocal: dto.dictionaryId ? false : true,
        },
      });

      await tx.section.create({
        data: {
          gradeId: grade.id,
          name: 'أ',
          orderIndex: 1,
        },
      });

      return grade;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('GRADE_NAME_DUPLICATE');
    }
    throw e;
  }
}
```

---

# 🎯 الآن السيرفر أصبح يدعم:

| الحالة                     | مدعومة |
| -------------------------- | ------ |
| إضافة صف رسمي              | ✅      |
| إضافة صف مخصص              | ✅      |
| منع تكرار الصف الرسمي      | ✅      |
| جلب القاموس الرسمي         | ✅      |
| التحقق من صحة dictionaryId | ✅      |
| إنشاء شعبة افتراضية        | ✅      |

---

# 🧠 الآن كيف سيعمل Wizard؟

في خطوة الصفوف:

1️⃣ GET /grades/dictionary
2️⃣ عرض:

* الصفوف الرسمية (Checkbox list)
* زر "إضافة صف مخصص"

3️⃣ عند الإرسال:

* POST لكل صف مختار من القاموس
* POST لكل صف مخصص

---

# 🚀 الآن سؤال مهم

هل تريد:

1️⃣ أن نضيف أيضًا bulk add endpoint
مثل:

```http
POST /grades/bulk
```

لإضافة عدة صفوف دفعة واحدة

2️⃣ أم نكتفي بالإنشاء الفردي داخل Wizard؟

إذا كان النظام Offline-first
أنصح جدًا بعمل bulk endpoint 🔥

---

# 🎯 الخلاصة

نعم فهمت المطلوب.

الكود الحالي يحتاج:

* إضافة GradeDictionary endpoint
* إضافة unique partial index
* تعديل createGrade للتحقق المنطقي
* (اختياري) bulk endpoint

---

إذا وافقت،
سأكتب لك الآن:

* نسخة migration SQL جاهزة
* الكود النهائي كامل لـ GradesService بعد التعديل
* اقتراح bulk endpoint احترافي

اختر نكمل أي اتجاه 🔥
ممتاز 🔥
الـ **Bulk Endpoint** هنا ليس تحسينًا تجميليًا — بل قرار معماري مهم جدًا للـ Wizard + Offline-first + Atomic safety.

سأعطيك الآن تصميم احترافي Production-Grade.

---

# 🎯 الهدف من Bulk Grades Endpoint

بدل أن يقوم الـ Wizard بـ:

```text
POST grade 1
POST grade 2
POST grade 3
```

نريد:

```http
POST /school/manager/grades/bulk
```

وكل شيء يتم داخل Transaction واحدة.

---

# ✅ لماذا Bulk مهم؟

| بدون Bulk                                 | مع Bulk                         |
| ----------------------------------------- | ------------------------------- |
| يمكن أن يفشل الصف الثالث بعد نجاح الأولين | إما كل الصفوف تنجح أو كلها تفشل |
| احتمال نظام نصف مهيأ                      | Atomic 100%                     |
| طلبات كثيرة                               | طلب واحد                        |
| صعب دعم Offline                           | أسهل دعم Offline                |

---

# 🏗 التصميم النهائي للـ Endpoint

## 🔹 Endpoint

```http
POST /school/manager/grades/bulk
```

---

## 🔹 Request Body

```json
{
  "grades": [
    {
      "dictionaryId": 5,
      "sortOrder": 1
    },
    {
      "dictionaryId": 6,
      "sortOrder": 2
    },
    {
      "displayName": "الصف التمهيدي",
      "shortName": "تمهيدي",
      "sortOrder": 0
    }
  ]
}
```

لاحظ:

* الصف الرسمي → dictionaryId فقط
* الصف المخصص → displayName

---

# 🧱 DTO

## CreateGradeBulkDto

```ts
// dto/create-grade-bulk.dto.ts

import { ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateGradeDto } from './grades.dto';

export class CreateGradeBulkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGradeDto)
  grades!: CreateGradeDto[];
}
```

---

# 🧠 Controller

```ts
@Post('/bulk')
createBulk(
  @Req() req: any,
  @Body() dto: CreateGradeBulkDto,
) {
  return this.service.createGradesBulk(req.schoolContext.id, dto.grades);
}
```

---

# 🚀 Service — الاحترافي الحقيقي

```ts
async createGradesBulk(
  schoolId: number,
  grades: CreateGradeDto[],
) {
  if (!grades.length) {
    throw new BadRequestException('EMPTY_GRADES_LIST');
  }

  return this.prisma.$transaction(async (tx) => {

    const createdGrades = [];

    for (const dto of grades) {

      // 🔎 إذا كان من القاموس
      if (dto.dictionaryId) {
        const dictionary = await tx.gradeDictionary.findFirst({
          where: {
            id: dto.dictionaryId,
            isDeleted: false,
            isActive: true,
          },
        });

        if (!dictionary) {
          throw new BadRequestException(
            `INVALID_DICTIONARY_GRADE_${dto.dictionaryId}`,
          );
        }

        const exists = await tx.schoolGrade.findFirst({
          where: {
            schoolId,
            dictionaryId: dto.dictionaryId,
            isDeleted: false,
          },
        });

        if (exists) {
          throw new ConflictException(
            `GRADE_ALREADY_ADDED_${dto.dictionaryId}`,
          );
        }

        dto.displayName = dto.displayName ?? dictionary.defaultName;
        dto.shortName = dto.shortName ?? dictionary.shortName;
      }

      // 🔎 إذا كان مخصص
      if (!dto.dictionaryId && !dto.displayName) {
        throw new BadRequestException('DISPLAY_NAME_REQUIRED');
      }

      const grade = await tx.schoolGrade.create({
        data: {
          schoolId,
          dictionaryId: dto.dictionaryId ?? null,
          displayName: dto.displayName,
          shortName: dto.shortName,
          sortOrder: dto.sortOrder,
          isLocal: dto.dictionaryId ? false : true,
        },
      });

      await tx.section.create({
        data: {
          gradeId: grade.id,
          name: 'أ',
          orderIndex: 1,
        },
      });

      createdGrades.push(grade);
    }

    return createdGrades;
  });
}
```

---

# 🔐 لماذا هذا احترافي جدًا؟

✔ Transaction واحدة
✔ يمنع تكرار الصف الرسمي
✔ يتحقق من صحة القاموس
✔ يدعم صفوف مخصصة
✔ ينشئ الشعبة الافتراضية
✔ يرجع قائمة الصفوف التي تم إنشاؤها

---

# 🧠 تحسين متقدم (اختياري لكن قوي)

بدل أن يتوقف عند أول خطأ، يمكن إرجاع تقرير أخطاء:

```json
{
  "success": false,
  "errors": [
    { "dictionaryId": 5, "error": "GRADE_ALREADY_ADDED" },
    { "displayName": "X", "error": "DUPLICATE_NAME" }
  ]
}
```

لكن هذا يكسر Atomic behavior.

في مرحلة Wizard الأولى:

⚡ الأفضل Atomic.

---

# 📊 ماذا عن الأداء؟

لو أرسل Wizard 12 صفًا:

* سيتم تنفيذ 12 عمليات create
* داخل transaction واحدة
* آمن تمامًا

ممتاز.

---

# 🎯 الآن نقطة مهمة جدًا

بما أننا سنستخدم Bulk للصفوف،
هل نريد أيضًا:

```http
POST /academic-years/bulk
```

لإنشاء السنة + الفصول دفعة واحدة؟

إذا أردنا Wizard احترافي حقيقي:

الأفضل أن يكون لدينا:

```http
POST /setup/academic-initialization
```

ينشئ:

* الصفوف
* السنة
* الفصول

في Transaction واحدة 🔥🔥🔥

---

# 🏆 السؤال الكبير الآن

هل تريد:

1️⃣ نكتفي بـ Bulk Grades
2️⃣ نضيف Bulk AcademicYears
3️⃣ نبني Endpoint شامل InitialAcademicSetup
(أفضل حل هندسي)

أنا شخصيًا أنصح بالحل الثالث للـ Wizard.

اختر الاتجاه وسأبنيه لك احترافيًا جدًا 🚀
ممتاز 🔥
الآن دخلنا في قرار معماري مهم جدًا.

سأعطيك مقارنة واضحة ثم أبني لك **التصميم الاحترافي الصحيح**.

---

# 🎯 أولاً — Bulk AcademicYears

## الفكرة

```http
POST /school/manager/academic-years/bulk
```

Request:

```json
{
  "year": {
    "name": "2025-2026",
    "terms": [
      { "name": "الفصل الأول", "orderIndex": 1 },
      { "name": "الفصل الثاني", "orderIndex": 2 }
    ]
  }
}
```

## هل هذا مفيد؟

بصراحة: ❌ لا كثيرًا.

لأن:

* السنة دائمًا واحدة في البداية
* الفصول تُنشأ أصلاً داخل createYear
* لا يوجد سيناريو تحتاج فيه عدة سنوات دفعة واحدة

إذن Bulk AcademicYears ليس له قيمة حقيقية في Wizard.

---

# 🏆 الحل الاحترافي الحقيقي

# 🔥 3️⃣ InitialAcademicSetup Endpoint

هذا هو الحل المعماري الصحيح.

بدل:

* Bulk Grades
* Bulk Year
* عدة Requests

ننشئ Endpoint واحد:

```http
POST /school/manager/setup/academic-initialization
```

ينشئ:

* الصفوف
* الشعب الافتراضية
* السنة
* الفصول
* تعيين السنة الحالية
* تعيين الفصل الحالي

داخل Transaction واحدة.

---

# 🎯 لماذا هذا أفضل؟

| الحل                 | Atomic | سهل للـ Wizard | أداء  | نظافة معمارية |
| -------------------- | ------ | -------------- | ----- | ------------- |
| Bulk Grades فقط      | ❌      | ❌              | متوسط | متوسط         |
| Bulk AcademicYears   | ❌      | ❌              | متوسط | متوسط         |
| InitialAcademicSetup | ✅      | ✅              | ممتاز | ممتاز         |

---

# 🧠 تصميم Endpoint الاحترافي

## 🔹 Request

```json
{
  "grades": [
    { "dictionaryId": 5, "sortOrder": 1 },
    { "dictionaryId": 6, "sortOrder": 2 },
    { "displayName": "التمهيدي", "sortOrder": 0 }
  ],
  "year": {
    "name": "2025-2026",
    "startDate": "2025-09-01",
    "endDate": "2026-06-30",
    "terms": [
      { "name": "الفصل الأول", "orderIndex": 1 },
      { "name": "الفصل الثاني", "orderIndex": 2 }
    ]
  }
}
```

---

# 🧱 DTO

```ts
export class AcademicInitializationDto {
  @ValidateNested({ each: true })
  @Type(() => CreateGradeDto)
  grades!: CreateGradeDto[];

  @ValidateNested()
  @Type(() => CreateYearDto)
  year!: CreateYearDto;
}
```

---

# 🚀 Service — Production-Grade Implementation

```ts
async initializeAcademic(
  schoolId: number,
  dto: AcademicInitializationDto,
) {
  return this.prisma.$transaction(async (tx) => {

    // 1️⃣ تحقق من عدم وجود إعداد سابق
    const existingYear = await tx.year.findFirst({
      where: { schoolId, isDeleted: false },
    });

    if (existingYear) {
      throw new ConflictException('ACADEMIC_ALREADY_INITIALIZED');
    }

    // 2️⃣ إنشاء الصفوف
    for (const gradeDto of dto.grades) {

      if (gradeDto.dictionaryId) {
        const dictionary = await tx.gradeDictionary.findFirst({
          where: {
            id: gradeDto.dictionaryId,
            isDeleted: false,
            isActive: true,
          },
        });

        if (!dictionary) {
          throw new BadRequestException('INVALID_DICTIONARY_GRADE');
        }

        gradeDto.displayName ??= dictionary.defaultName;
        gradeDto.shortName ??= dictionary.shortName;
      }

      const grade = await tx.schoolGrade.create({
        data: {
          schoolId,
          dictionaryId: gradeDto.dictionaryId ?? null,
          displayName: gradeDto.displayName,
          shortName: gradeDto.shortName,
          sortOrder: gradeDto.sortOrder,
          isLocal: gradeDto.dictionaryId ? false : true,
        },
      });

      await tx.section.create({
        data: {
          gradeId: grade.id,
          name: 'أ',
          orderIndex: 1,
        },
      });
    }

    // 3️⃣ إنشاء السنة
    const year = await tx.year.create({
      data: {
        schoolId,
        name: dto.year.name,
        startDate: dto.year.startDate
          ? new Date(dto.year.startDate)
          : null,
        endDate: dto.year.endDate
          ? new Date(dto.year.endDate)
          : null,
        isCurrent: true,
      },
    });

    // 4️⃣ إنشاء الفصول
    for (const term of dto.year.terms ?? []) {
      await tx.term.create({
        data: {
          yearId: year.id,
          name: term.name,
          orderIndex: term.orderIndex,
          startDate: term.startDate
            ? new Date(term.startDate)
            : null,
          endDate: term.endDate
            ? new Date(term.endDate)
            : null,
          isCurrent: term.orderIndex === 1,
        },
      });
    }

    return { success: true };
  });
}
```

---

# 🔐 لماذا هذا احترافي جدًا؟

✔ Transaction واحدة
✔ لا يمكن أن يبقى النظام نصف مهيأ
✔ يمنع التهيئة مرتين
✔ بسيط جدًا للـ Flutter
✔ جاهز للـ Offline Queue
✔ جاهز للتوسع

---

# 🎯 كيف سيستخدمه Wizard؟

في Flutter:

```dart
await setupRepository.initializeAcademic(draft);
ref.invalidate(setupStatusProvider);
goToDashboard();
```

انتهى.

لا داعي:

* bulk grades
* bulk years
* تنسيق معقد

---

# 🏆 القرار النهائي

لو تريد نظام احترافي حقيقي:

❌ لا تبني Bulk AcademicYears
❌ لا تعتمد فقط على Bulk Grades
✅ ابنِ InitialAcademicSetup Endpoint

---

# 🚀 سؤال مهم الآن

هل تريد أن:

1️⃣ نعيد تنظيم SetupService ليحتوي هذا endpoint
2️⃣ ننشئ SetupInitializationModule منفصل
3️⃣ نعيد تصميم SetupGate ليعتمد على هذا بالكامل
4️⃣ نضيف حماية تمنع أي CRUD قبل التهيئة

اختر الاتجاه الذي نكمله الآن 🔥
