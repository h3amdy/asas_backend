إذا كانت الوسائط موجودة بالفعل، فهذه النتيجة:

```json
"containsMedia": false,
"mediaFilesCount": 0,
"mediaFilesCopied": 0
```

تعني أن **هناك خطأ في عملية اكتشاف الوسائط أو نسخها**، وليس بالضرورة أن الوسائط غير موجودة.

وألاحظ شيئًا مهمًا جدًا من سجل النسخة:

```text
Database dump completed (4 MB)
Media copy: 0/0 files
```

هذا يعني أن النظام **اعتقد أن عدد الملفات المطلوب نسخه هو صفر** قبل أن يبدأ النسخ.

أي أن المشكلة ليست في `MediaCopy` نفسها، وإنما قبلها.

## الاحتمالات الأقوى

### الاحتمال الأول (وهو الأكثر احتمالًا)

الدالة:

```ts
extractMediaKeysFromDump(sqlFile)
```

لم تستخرج أي `storage_key`.

أي أن:

```ts
mediaStorageKeys.length == 0
```

وبالتالي مرحلة النسخ لم تجد شيئًا لتنسخه.

---

### الاحتمال الثاني

اسم الجدول في قاعدة البيانات ليس:

```text
media_asset_variants
```

بينما الكود يبحث عن:

```ts
line.includes("media_asset_variants")
```

إذا كان اسم الجدول مثل:

```text
platform_media_variants
```

أو

```text
media_variants
```

فلن يعثر عليه إطلاقًا.

---

### الاحتمال الثالث

صيغة `COPY` التي ينتجها `pg_dump` تختلف عما تتوقعه الدالة.

---

# أول شيء أريد التأكد منه

نفذ هذا الأمر على الخادم:

```bash
grep -n "COPY .*media" /var/backups/mafhooom/temp/*/database/postgres.sql
```

إذا لم يعد الملف موجودًا لأن مجلد `temp` حُذف بعد التنظيف، فأنشئ نسخة جديدة مع إيقاف التنظيف مؤقتًا، أو ببساطة نفذ على قاعدة البيانات:

```sql
SELECT COUNT(*) FROM media_asset_variants;
```

ثم:

```sql
SELECT storage_key
FROM media_asset_variants
LIMIT 10;
```

---

# وهناك سؤال مهم

أريد معرفة مخطط قاعدة البيانات لديك.

ما هو اسم الجدول الذي يحتوي على ملفات الوسائط؟

هل هو بالفعل:

```text
media_asset_variants
```

أم اسم آخر؟

لأن إذا كان الاسم مختلفًا، فقد وجدنا السبب مباشرة.

**أرسل أيضًا كود الدالة `MediaCopyService` أو الخدمة التي تستقبل `mediaStorageKeys` بعد `PgDumpEngine`، لأننا نحتاج التأكد أن القائمة المستخرجة تُمرر كما هي ولا يتم تفريغها في مرحلة لاحقة.**
