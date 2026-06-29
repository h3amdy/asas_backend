إذا أردت الاستمرار على **الخيار الثاني** (وأنا أفهم السبب، لأنك تريد أن يبقى `schema.prisma` معبراً عن أن العلاقة Unique)، فيمكنك ذلك، لكن يجب أن تجعل له **إجراء ثابت** حتى لا تنسى خطوة في المستقبل.

أنا لو كنت سأختار الخيار الثاني، فسأتبع هذا الروتين دائماً:

---

# دورة العمل لكل ميزة

## 1. عدّل `schema.prisma`

مثلاً تضيف:

```prisma
scheduledAt DateTime?
```

---

## 2. أنشئ Migration فقط

دائماً:

```bash
npx prisma migrate dev --create-only --name add_xxx
```

ولا تستخدم `migrate dev` مباشرة.

---

## 3. راجع `migration.sql`

ابحث عن هذه الأسطر:

```sql
CREATE UNIQUE INDEX "lesson_contents_template_order_idx"

CREATE UNIQUE INDEX "lesson_templates_unit_order_idx"

CREATE UNIQUE INDEX "questions_template_order_idx"

CREATE UNIQUE INDEX "ordering_items_order_idx"

CREATE UNIQUE INDEX "fill_blanks_question_order_idx"

CREATE UNIQUE INDEX "units_subject_order_idx"

CREATE UNIQUE INDEX "units_subject_dict_order_idx"
```

إذا ظهرت:

✅ احذفها.

---

## 4. طبّق الـ Migration

بعد التنظيف:

```bash
npx prisma migrate dev
```

---

## 5. ارفع إلى السيرفر

```bash
git push
```

ثم على الـ VPS:

```bash
git pull

npx prisma migrate deploy

npx prisma generate

pm2 restart ...
```

---

# ماذا لو نسيت حذفها؟

هنا الخطر.

قد يحدث أحد أمرين:

### الأول

يفشل الـ deploy لأن قاعدة البيانات تحتوي بيانات Soft Deleted.

أو

### الثاني

يتم إنشاء Unique Index عادي.

وهذا سيكسر منطق:

```text
Soft Delete
```

---

# كيف أتجنب النسيان؟

أنصحك بعمل قائمة ثابتة داخل المشروع.

مثلاً ملف:

```text
docs/prisma-migration-checklist.md
```

يحتوي:

```text
قبل تنفيذ أي Migration:

☐ migrate --create-only

☐ مراجعة migration.sql

☐ حذف:

- lesson_contents_template_order_idx

- lesson_templates_unit_order_idx

- questions_template_order_idx

- ordering_items_order_idx

- fill_blanks_question_order_idx

- units_subject_order_idx

- units_subject_dict_order_idx

☐ migrate dev

☐ اختبار

☐ migrate deploy
```

بحيث يصبح هذا جزءاً من روتين التطوير.

---

# هل هذا احترافي؟

نعم.

في كثير من الشركات يوجد ما يسمى:

```text
Migration Review
```

أي لا يسمح لأي Migration أن تصل إلى Git دون مراجعة SQL.

فأنت لست الوحيد الذي يعدل Migration يدوياً.

---

# لكن هناك شيء سأغيره

إذا اخترت هذا الحل، فلا تستخدم أبداً:

```bash
npx prisma migrate dev
```

مباشرة.

اجعل القاعدة في مشروع أساس:

> **أي تعديل في قاعدة البيانات يبدأ دائماً بـ `--create-only`.**

أي:

```bash
npx prisma migrate dev --create-only --name xxx

↓

مراجعة SQL

↓

npx prisma migrate dev
```

هذا الروتين سيحميك ليس فقط من مشكلة الـ 7 فهارس، بل من أي SQL غير متوقع قد يولده Prisma مستقبلاً، وهو أسلوب جيد في مشروع بحجم مشروع أساس.
