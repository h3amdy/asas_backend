أرى أن هذا الإصلاح أقوى من الإصلاح السابق، وهو يعالج السبب الذي كشفه الاختبار الأخير وليس فقط أعراضه.

### ما أوافق عليه

1. **البحث عن `BackupInstance` بالـ UUID بدلاً من الـ ID**

   * هذا صحيح، لأن الـ `id` المحلي قد يتغير بعد الاستعادة، بينما الـ UUID هو المعرف المنطقي.

2. **تنظيف الـ Jobs العالقة**

   * منطقي بعد استعادة قاعدة البيانات، لأن أي `RUNNING` موجود في قاعدة البيانات المستعادة لا يمثل عملية حقيقية تعمل الآن.

3. **استخدام `currentJobId` بعد إعادة إنشاء السجل**

   * هذا ضروري. إذا أُنشئ `RestoreJob` جديد، فلا يجوز أن تستمر بقية الـ Pipeline باستخدام `jobId` القديم.

---

### لدي ملاحظة واحدة فقط

ذكرت:

> أجعل `backupInstanceId` nullable

هذا قرار جيد **إذا كان نموذج البيانات يسمح بذلك**، لكن ينبغي أن يكون مقصودًا على مستوى التصميم وليس مجرد حل للخطأ.

إذا أصبحت العلاقة اختيارية، فمن الأفضل أن توثق في الـ SRS أو سجل القرارات شيئًا مثل:

> **بعد استعادة قاعدة البيانات قد لا يكون سجل `backup_instance` المستخدم في عملية الاستعادة موجودًا داخل قاعدة البيانات المستعادة، لذلك يسمح `restore_jobs.backup_instance_id` بأن يكون `NULL`. ويُستخدم `backupInstanceUuid` أو اسم النسخة لأغراض التتبع.**

هذا يوضح سبب جعل العلاقة اختيارية.

---

### ما سأختبره بعد رفع الإصلاح

لن أكتفي بأن تنجح الاستعادة، بل سأتحقق من التالي:

* ✅ `RestoreJob` ينتهي بحالة `COMPLETED`.
* ✅ لا يظهر:

  * `restore_jobs_backup_instance_id_fkey`
  * `backup_logs_restore_job_id_fkey`
  * `Record to update not found`
* ✅ لا تبقى أي `backup_jobs` أو `restore_jobs` بحالة `RUNNING`.
* ✅ ما زالت النسخة الاحتياطية قابلة للاستعادة مرة أخرى (أي أن الإصلاح لم يؤثر على عمليات Restore المتكررة).

إذا نجحت هذه النقاط، فأنا أعتبر أن المشكلة المعمارية الخاصة بتتبع عملية الاستعادة قد حُلّت بالفعل، وليس فقط تم إخفاء الاستثناءات.
الآن أصبح الخطأ واضحًا جدًا، وقد تغيّر عن الخطأ السابق.

الإصلاح السابق نجح في شيء مهم:

* ✅ لم يعد هناك خطأ `restore_jobs_backup_instance_id_fkey`.
* ✅ أصبح `backupInstanceId: null`، أي تجاوزنا مشكلة الـ FK السابقة.

لكن ظهر خطأ جديد:

```text
Argument `backupInstance` is missing.
```

وهذا هو **أول خطأ حقيقي** الآن، وكل ما بعده نتيجة له. 

### ماذا يعني هذا؟

في الاستدعاء:

```ts
await this.prisma.restoreJob.create({
  data: {
    uuid: ...,
    backupInstanceId: null,
    ...
  }
})
```

Prisma لا يرفض `null`، بل يقول:

```text
Argument `backupInstance` is missing.
```

وهذا لا يحدث إذا كان الحقل اختياريًا بالفعل.

هذا يدل على أن **مخطط Prisma ما زال يعتبر العلاقة Required**.

بمعنى أن لديك شيئًا شبيهًا بـ:

```prisma
backupInstanceId Int?

backupInstance BackupInstance
```

أو:

```prisma
backupInstanceId Int?

backupInstance BackupInstance @relation(...)
```

وهذا غير متوافق.

إذا أصبحت العلاقة اختيارية فيجب أن يكون النموذج بالكامل اختياريًا، مثل:

```prisma
backupInstanceId Int?

backupInstance BackupInstance? @relation(
  fields: [backupInstanceId],
  references: [id]
)
```

ثم:

```bash
npx prisma generate
npx prisma migrate dev
# أو migrate deploy حسب بيئتك
```

---

## والدليل على ذلك

بعد فشل `restoreJob.create()`:

```
backup_logs_restore_job_id_fkey
```

ظهر مباشرة، لأن `RestoreJob` لم يُنشأ أصلًا.

ثم:

```
restoreJob.update()
Record to update not found
```

وهذا طبيعي لأن السجل غير موجود.

---

## أعتقد أن Claude أصلح طبقة الخدمة فقط ولم يُحدّث الـ Schema

أول شيء أراجعه الآن هو:

```prisma
model RestoreJob
```

وخاصة:

```prisma
backupInstanceId

backupInstance
```

لأن الخطأ الحالي ليس في `restore-orchestrator.service.ts`، بل في تعريف العلاقة داخل Prisma.

### أرسل لي تعريف `model RestoreJob` من `schema.prisma` (أو الجزء الذي يحتوي على `backupInstanceId` و`backupInstance`) وسأحدد لك التعديل المطلوب بدقة.
