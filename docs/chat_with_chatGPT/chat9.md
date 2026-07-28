أتفق مع الفكرة، لكن مع توضيح مهم.

## نعم، السبب منطقي

إذا كانت النسخة الاحتياطية التي استعدتها تحتوي على:

```text
backup_job #8 = RUNNING
```

فبعد استعادة قاعدة البيانات ستعود هذه الحالة كما هي، حتى لو لم تعد هناك عملية نسخ تعمل فعليًا.

إذن هذا ليس انهيارًا جديدًا لمحرك النسخ، وإنما **استعادة لحالة تاريخية من قاعدة البيانات**.

---

## لكن لا أحب الحل اليدوي كحل دائم

الأمر:

```sql
UPDATE backup_jobs
SET status = 'FAILED',
    error_message = 'Stale after DB restore',
    finished_at = NOW()
WHERE id = 8
  AND status = 'RUNNING';
```

مناسب لتنظيف بيئة الاختبار الحالية.

أما في المنتج الحقيقي، فمن الأفضل أن يكون ذلك جزءًا من الـ Restore Pipeline.

---

# أوصي بإضافة خطوة رسمية بعد نجاح Restore

مثلاً مباشرة بعد:

```text
Database restored successfully
```

تنفذ:

```sql
UPDATE backup_jobs
SET status = 'FAILED',
    error_message = 'Interrupted by database restore',
    finished_at = NOW()
WHERE status = 'RUNNING';
```

وبالمثل:

```sql
UPDATE restore_jobs
SET status = 'FAILED',
    error_message = 'Interrupted by database restore',
    finished_at = NOW()
WHERE status = 'RUNNING'
AND uuid <> :currentRestoreUuid;
```

بهذه الطريقة:

* لا تبقى أي Jobs وهمية.
* لا تحتاج أي تدخل يدوي.
* تبقى قاعدة البيانات متسقة بعد أي استعادة.

---

## نقطة مهمة جدًا

لا تربط التنظيف بـ:

```sql
WHERE id = 8
```

بل اجعله عامًا:

```sql
WHERE status = 'RUNNING'
```

لأن رقم الـ Job سيتغير في كل مرة.

---

## بالنسبة للاختبار

نعم، التسلسل الذي أقترحه هو:

1. تنظيف الـ Job العالق (مرة واحدة فقط في بيئة الاختبار الحالية).
2. إنشاء Backup جديد.
3. انتظار اكتماله.
4. تنفيذ Restore من النسخة الجديدة.
5. التحقق من:

   * إنشاء Safety Backup.
   * نجاح Restore.
   * وجود `RestoreJob` بحالة `COMPLETED`.
   * عدم وجود أي `backup_jobs` أو `restore_jobs` عالقة بحالة `RUNNING`.
   * عدم ظهور استثناءات في سجلات `pm2`.

إذا نجح هذا السيناريو، فسأعتبر نظام **Backup/Restore** في مشروعك قد وصل إلى حالة مستقرة وجاهزة للاعتماد في الـ MVP.
الآن أصبح سبب المشكلة واضحًا جدًا، والسجل كشف أن محاولة الإصلاح الأولى لم تعالج السبب الحقيقي.

## المشكلة الجديدة ليست في `restoreJob` نفسه

الفشل يبدأ هنا:

```text
Could not re-create restore job record:

Foreign key constraint violated:
restore_jobs_backup_instance_id_fkey
```

ثم تتبعه جميع الأخطاء الأخرى:

* `backup_logs_restore_job_id_fkey`
* `restoreJob.update() Record to update not found`

وهذا يعني أن عملية `upsert` نفسها **لم تنجح**، ولذلك لم يُنشأ سجل `restore_jobs` أصلًا، فكل العمليات التالية فشلت بشكل طبيعي. 

---

# السبب الحقيقي

أنت افترضت سابقًا:

> backupInstanceId سيكون موجودًا بعد الاستعادة.

لكن السجل أثبت أن هذا الافتراض غير صحيح في هذا السيناريو.

لدينا دليل مباشر:

```text
restore_jobs_backup_instance_id_fkey
```

أي أن القيمة الموجودة في:

```text
restoreJob.backupInstanceId
```

تشير إلى سجل غير موجود داخل قاعدة البيانات بعد الاستعادة.

---

# لماذا يحدث هذا؟

هناك احتمالان:

1. الـ Backup الذي تستعيد منه لم يكن يحتوي على هذا الـ `backup_instance`.
2. أو أن الـ Safety Backup أو النسخة الحالية أضافت سجلات بعد وقت أخذ النسخة، وبالتالي تغيّرت معرفات (`id`) قاعدة البيانات.

في كلتا الحالتين، **لا يجوز الاعتماد على المفتاح الرقمي (`backupInstanceId`) بعد استبدال قاعدة البيانات**.

---

# الحل الصحيح

بدلًا من:

```ts
backupInstanceId: oldBackupInstanceId
```

ينبغي إعادة إيجاد السجل بعد الاستعادة باستخدام الـ UUID الخاص بالنسخة، ثم استخدام الـ `id` الجديد إن وُجد.

منطقيًا يكون التدفق:

```ts
const backupInstance = await prisma.backupInstance.findUnique({
  where: {
    uuid: backupInstanceUuid,
  },
});

await prisma.restoreJob.upsert({
  ...
  create: {
    ...
    backupInstanceId: backupInstance?.id ?? null,
  }
});
```

أو إذا كان الحقل اختياريًا (`nullable`) فمن الأفضل استخدام:

```ts
backupInstanceId: backupInstance?.id ?? null
```

بدل تمرير `id` قديم لم يعد صالحًا.

---

# إذا كان الحقل إجباريًا (NOT NULL)

فهنا أنصح بإعادة النظر في التصميم.

من الناحية المعمارية، لا أرى أن `RestoreJob` يجب أن يعتمد على FK إلى `BackupInstance` بعد استعادة قاعدة البيانات، لأن عملية الاستعادة بطبيعتها قد تعيد قاعدة البيانات إلى نقطة زمنية لا تحتوي على نفس السجل.

في هذه الحالة يكون حفظ:

* `backupInstanceUuid`
* `backupName`

أكثر استقرارًا من الاعتماد على FK فقط.

---

## خلاصة

السجل يثبت أن:

* ✅ محرك Backup يعمل.
* ✅ Safety Backup يعمل.
* ✅ Database Restore ينجح.
* ❌ فشل `upsert` بسبب **مفتاح أجنبي غير صالح (`backupInstanceId`)**، ولذلك لم يُنشأ `RestoreJob`، ومن ثم فشلت كتابة السجلات وتحديث الحالة لاحقًا. 

أنصح بأن تركز الإصلاح التالي على هذه النقطة تحديدًا؛ فهي أصبحت أول خطأ في السلسلة، وما بعدها مجرد آثار مترتبة عليه.
