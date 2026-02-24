ممتاز 👌 الآن هذا تفكير نظام تعليمي حقيقي.

قرارك أقوى معماريًا من التصميم السابق:

* ✅ الفصول هي المصدر الزمني الحقيقي
* ✅ السنة تُشتق من الفصول
* ✅ الصف المحلي يجب أن يحدد المرحلة
* ✅ الترتيب إلزامي ومنضبط

هذا صحيح 100%.

سأعطيك **التعديلات الدقيقة التي يجب تنفيذها في السيرفر**.

---

# 🎯 أولاً: تعديل فلسفة السنة والفصول

## القرار الجديد

* لا يوجد `termsCount`
* لا يوجد auto-generated terms
* يجب إرسال:

  * startDate + endDate لكل فصل
* startDate للسنة = أصغر startDate للفصول
* endDate للسنة = أكبر endDate للفصول

هذا تصميم صحيح تربويًا.

---

# 🧠 التعديل المطلوب في DTO

## AcademicInitializationDto يجب أن يصبح:

```ts
year: {
  name: string;
  terms: {
    name: string;
    orderIndex: number;
    startDate: string;
    endDate: string;
  }[];
}
```

❌ احذف:

```ts
termsCount
```

---

# 🧠 تحقق إلزامي جديد

داخل initializeAcademic أضف:

```ts
if (!dto.year?.terms?.length) {
  throw new BadRequestException('TERMS_REQUIRED');
}
```

ثم تحقق:

```ts
for (const term of dto.year.terms) {
  if (!term.startDate || !term.endDate) {
    throw new BadRequestException('TERM_DATES_REQUIRED');
  }

  if (new Date(term.startDate) >= new Date(term.endDate)) {
    throw new BadRequestException('INVALID_TERM_DATE_RANGE');
  }
}
```

---

# 🧠 تحقق من تداخل الفصول

يجب منع overlap:

```ts
const sorted = [...dto.year.terms].sort((a,b)=>a.orderIndex-b.orderIndex);

for (let i=0;i<sorted.length-1;i++){
  const currentEnd = new Date(sorted[i].endDate);
  const nextStart = new Date(sorted[i+1].startDate);

  if (currentEnd > nextStart) {
    throw new BadRequestException('TERM_DATE_OVERLAP');
  }
}
```

هذا مهم جداً.

---

# 🎯 اشتقاق السنة من الفصول

بدلاً من:

```ts
startDate: dto.year.startDate
endDate: dto.year.endDate
```

يصبح:

```ts
const startDate = new Date(
  Math.min(...dto.year.terms.map(t => new Date(t.startDate).getTime()))
);

const endDate = new Date(
  Math.max(...dto.year.terms.map(t => new Date(t.endDate).getTime()))
);
```

ثم:

```ts
const year = await tx.year.create({
  data: {
    schoolId,
    name: dto.year.name,
    startDate,
    endDate,
    isCurrent: true,
  },
});
```

---

# 🎯 الآن بخصوص الصفوف المخصصة

قرارك صحيح:

> الصف المحلي يجب أن يحتوي stage إلزاميًا

---

# 🧠 تعديل SchoolGrade

أضف:

```ts
stage: string
```

في Prisma model.

---

# 🧠 في initializeAcademic

بدلاً من:

```ts
if (!gradeDto.dictionaryId && !gradeDto.displayName) {
  throw new BadRequestException('DISPLAY_NAME_REQUIRED');
}
```

يصبح:

```ts
if (!gradeDto.dictionaryId) {
  if (!gradeDto.displayName) {
    throw new BadRequestException('DISPLAY_NAME_REQUIRED');
  }

  if (!gradeDto.stage) {
    throw new BadRequestException('STAGE_REQUIRED');
  }
}
```

---

# 🎯 عند الإنشاء من القاموس

انسخ stage:

```ts
stage: dictionary.stage,
```

وعند الصف المحلي:

```ts
stage: gradeDto.stage,
```

---

# 🎯 الترتيب (sortOrder)

يجب:

1️⃣ التأكد من أنه موجود
2️⃣ التأكد أنه رقم موجب
3️⃣ التأكد من عدم تكراره داخل نفس الطلب

أضف:

```ts
const orders = dto.grades.map(g => g.sortOrder);

if (new Set(orders).size !== orders.length) {
  throw new BadRequestException('DUPLICATE_SORT_ORDER');
}
```

---

# 🎯 تحقق من تكرار dictionaryId داخل نفس الطلب

```ts
const dictionaryIds = dto.grades
  .filter(g => g.dictionaryId)
  .map(g => g.dictionaryId);

if (new Set(dictionaryIds).size !== dictionaryIds.length) {
  throw new BadRequestException('DUPLICATE_DICTIONARY_GRADE');
}
```

---

# 🔥 تحقق إلزامي آخر

منع مصفوفة فارغة:

```ts
if (!dto.grades?.length) {
  throw new BadRequestException('EMPTY_GRADES_LIST');
}
```

---

# 🧠 الشكل النهائي الصحيح للتهيئة

## الصفوف

* dictionaryId أو displayName + stage
* sortOrder إلزامي
* no duplicates

## السنة

* name إلزامي

## الفصول

* startDate إلزامي
* endDate إلزامي
* لا تداخل
* اشتقاق السنة من الفصول

---

# 🎯 النتيجة

بعد هذه التعديلات:

* لا توجد سنة بدون تواريخ حقيقية
* لا يوجد فصل بدون زمن
* لا يوجد صف بلا مرحلة
* لا يوجد ترتيب مكرر
* لا يوجد overlap زمني

النظام يصبح أكاديمي فعلاً وليس شكلي.

---

إذا أردت الآن
أعيد كتابة initializeAcademic بالكامل وفق التصميم الصحيح النهائي 👌
