أنا أيضًا **لا أقتنع بأن 799 ملفًا مفقودًا سببه فقط Soft Delete**. هذا ممكن، لكنه يحتاج دليلًا، ولا ينبغي افتراضه.

هناك عدة أسباب محتملة، ويجب التحقق منها بالترتيب.

## أول ملاحظة مهمة

من النتيجة:

```text
mediaFilesExpected = 1006
mediaFilesCopied = 207
missingCount = 799
```

هذا يخبرنا أن:

* استخراج `storage_key` أصبح يعمل ✅
* خدمة النسخ حاولت الوصول إلى **1006** ملفًا.
* لكنها لم تجد **799** منها.

هذا لا يخبرنا **لماذا** لم تجدها.

---

# ألاحظ شيئًا من لقطة الشاشة

المجلد:

```text
/www/media-storage
```

يحتوي على:

* platform
* tmp
* عدة مجلدات بأسماء UUID

وهذا طبيعي.

لكن لا نعرف حتى الآن كيف يبدو `storage_key` داخل قاعدة البيانات.

مثلاً إذا كان `storage_key`:

```text
platform/books/math/cover.jpg
```

فالمسار النهائي يصبح:

```text
/www/media-storage/platform/books/math/cover.jpg
```

أما إذا كان `storage_key` هو:

```text
books/math/cover.jpg
```

بينما خدمة النسخ تبحث في:

```text
/www/media-storage/books/math/cover.jpg
```

في حين أن الملفات موجودة داخل:

```text
/www/media-storage/platform/books/math/cover.jpg
```

فسيفشل العثور على معظم الملفات.

---

# لذلك لا أريد التخمين

أريد أن نجيب عن أربعة أسئلة بالحقائق.

## 1. كم عدد سجلات الوسائط؟

نفذ:

```sql
SELECT COUNT(*)
FROM media_assets;
```

---

## 2. كم عدد السجلات غير المحذوفة؟

إذا كان عندكم Soft Delete:

```sql
SELECT COUNT(*)
FROM media_assets
WHERE is_deleted = false;
```

إذا ظهر مثلاً:

```text
1006
```

فهذا ينفي فرضية Claude مباشرة.

أما إذا ظهر:

```text
207
```

فقد يكون على حق.

---

## 3. أريد رؤية قيم storage_key

نفذ:

```sql
SELECT storage_key
FROM media_assets
LIMIT 20;
```

هذه أهم خطوة بالنسبة لي.

---

## 4. أريد رؤية كود MediaCopy

تحديدًا الجزء الذي يفعل شيئًا مثل:

```ts
const source = path.join(mediaRoot, storageKey);
```

أو أي منطق مشابه.

---

# لدي شك آخر

أنت قلت إن النظام يحتوي على:

* كتب PDF
* صور
* أصوات
* ملفات مدرس
* محتوى تعليمي

وهذا يجعلني أشك في أن بعض هذه الملفات **لا تُخزن أصلًا في `media_assets`**.

ربما يوجد:

* `lesson_resources`
* `attachments`
* `book_files`
* `teacher_files`

وكلها تستخدم جداول مختلفة.

إذا كان Backup يعتمد فقط على:

```text
media_assets
```

فلن ينسخ إلا ما هو موجود في هذا الجدول.

---

# أعتقد أن هناك مراجعة معمارية مطلوبة

لا أريد أن نركز فقط على إصلاح هذا الرقم.

بل أريد التأكد من سؤال أكبر:

> **هل نظام النسخ الاحتياطي ينسخ جميع الملفات التي يعتمد عليها النظام؟**

لأن في مشروع مثل "مفهوم"، الهدف ليس نسخ "الوسائط" فقط، بل نسخ **كل الملفات التشغيلية**، مثل:

* صور المستخدمين.
* صور الأسئلة.
* ملفات PDF للكتب.
* الملفات الصوتية.
* الفيديوهات.
* المرفقات التعليمية.
* أي ملفات تُخزن خارج قاعدة البيانات.

إذا كان بعضها لا يمر عبر `media_assets`، فهذه ليست مشكلة في العداد فقط، بل فجوة في تصميم النسخ الاحتياطي.

## اقتراحي

قبل أن نعدل أي سطر كود، دعنا نراجع معًا:

1. مخطط `media_assets`.
2. خدمة `MediaCopyService`.
3. جميع الجداول التي تحتوي على مراجع لملفات (مثل `storage_key` أو `file_path` أو `media_asset_id`).

بعدها نستطيع أن نحدد بدقة هل المشكلة هي:

* سجلات محذوفة.
* مسارات خاطئة.
* أو أن نظام النسخ الاحتياطي لا يغطي كل أنواع الملفات الموجودة في المشروع. وهذا هو الأهم لضمان أن النسخة الاحتياطية قابلة للاستعادة بالكامل.


نفذت وظهر 

root@srv992229:~# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod
psql (16.14 (Ubuntu 16.14-0ubuntu0.24.04.1), server 16.1)
Type "help" for help.

asasprod=> SELECT COUNT(*)
FROM media_assets;
 count 
-------
  1019
(1 row)

asasprod=> SELECT COUNT(*)
FROM media_assets
WHERE is_deleted = false;
 count 
-------
  1006
(1 row)

asasprod=> SELECT COUNT(*)
FROM media_assets
WHERE is_deleted = false;
 count 
-------
  1006
(1 row)

asasprod=> SELECT storage_key
FROM media_assets
LIMIT 20;
                                       storage_key                                       
-----------------------------------------------------------------------------------------
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6062ac8e-12ba-4390-b197-7676fee114bf/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ce2bdec6-c308-499b-b391-2f55bdd19219/original.jpg
 platform/9528cfe5-ddcb-43bc-b99a-2eddad396b74/original.mp3
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/a5a05466-94a6-4005-9b23-b61729e9d53c/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6f08e06c-b2bf-4009-bc49-26e925c0212c/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/efcd05d3-8125-4f1e-9f67-63f5210b284b/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/80ab65c9-e5a1-4d76-a38b-b173d775368b/original.png
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/0f484840-430b-4748-81a5-f9d9f4af7b30/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/bdaf4853-41aa-46c3-86d3-476018a9604d/original.webp
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/10fc2e63-d899-4c59-8b85-9c20324bd99c/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/cdf2d52d-dacc-411c-919b-9c2084c0c702/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/47d0b0ea-d9d0-4d8c-9a5b-0e409f6f46ec/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/3c870a2c-e36c-4f77-b1c7-095b73735205/original.png
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/e7323eb7-5bca-4912-ad0a-cc0467d23f15/original.jpg
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/2fad6711-8dcc-4e76-a6ec-27e3d8bd4319/original.wav
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/d77f8771-817c-49c6-89c8-c0f0ba053241/original.wav
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/829bfadc-29c0-4058-9d11-248f099acc6e/original.wav
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ae48b40c-e930-46f7-b17a-35ce3cec2589/original.wav
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/40feb5d2-63fe-4269-bf9b-63c4d882d3bf/original.wav
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/5b66353b-d413-407a-bef4-8ab19b020a17/original.wav
(20 rows)
root@srv992229:~# ls -l "/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6062ac8e-12ba-4390-b197-7676fee114bf/original.jpg"

ls: cannot access '/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6062ac8e-12ba-4390-b197-7676fee114bf/original.jpg': No such file or directory

root@srv992229:~# root@srv992229:~# ls -l "/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ce2bdec6-c308-499b-b391-2f55bdd19219/original.jpg"

ls: cannot access '/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ce2bdec6-c308-499b-b391-2f55bdd19219/original.jpg': No such file or directory

root@srv992229:~# root@srv992229:~# ls -l "/www/media-storage/platform/9528cfe5-ddcb-43bc-b99a-2eddad396b74/original.mp3"

-rw-r--r-- 1 root root 51309 May  4 14:34 /www/media-storage/platform/9528cfe5-ddcb-43bc-b99a-2eddad396b74/original.mp3

root@srv992229:~# root@srv992229:~# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod

psql (16.14 (Ubuntu 16.14-0ubuntu0.24.04.1), server 16.1)

Type "help" for help.



asasprod=> SELECT storage_key

FROM media_assets

WHERE is_deleted = false

ORDER BY created_at DESC

LIMIT 20;

                        storage_key                         

------------------------------------------------------------

 platform/7742128c-7859-4f3c-ae2b-350caffaa461/original.jpg

 platform/97dae5b9-ec7f-4243-a37c-3a7c611d02b8/original.jpg

 platform/e3d45d28-05dc-42d5-bc2e-c64ac6d1f485/original.jpg

 platform/f6f74712-4139-4c0a-a5cf-4041a491a82b/original.jpg

 platform/e3b2db1b-4ea7-4cb8-acf3-87af00a7e565/original.jpg

 platform/171c5747-2bef-4776-8c7a-bab03a059d53/original.jpg

 platform/bd23a4b0-d33a-4d91-9d5f-b4893b13276e/original.jpg

 platform/d305443e-1d5c-449d-b9e5-fa9d0716e24d/original.jpg

 platform/0791b6a8-2026-437a-9fea-350c3222f80f/original.jpg

 platform/aa977472-3072-4f5c-998f-77a6fb03c48c/original.jpg

 platform/e2a359ae-e2ee-41a9-882c-9bb80f00bafd/original.jpg

 platform/e88b21fa-a139-447d-a5e7-09ed517a5b8c/original.jpg

 platform/165aa5d3-e8a2-4bc1-b07d-fdef97f4dbc5/original.jpg

 platform/996ebcda-69aa-455c-88e5-abd8587aa65d/original.jpg

 platform/bf98a00b-f5ae-4149-be6a-6c778e8ddc0a/original.jpg

 platform/96b9a0a9-77fa-4e4e-825a-b76196e343fe/original.jpg

 platform/3c50dcc0-d445-4cae-bad7-6915f9df0fde/original.jpg

 platform/23b0cc49-fb2a-4a32-9ffe-e0f3bddb558f/original.jpg

 platform/7bab61a0-51f1-47b4-9e98-49e101fdf355/original.jpg

 platform/1db065d1-04b5-4a1e-9387-ebfd6389184f/original.jpg

(20 rows)
*** System restart required ***
Last login: Tue Jul 28 15:28:34 2026 from 127.0.0.1
root@srv992229:~# find /www/media-storage -name original.jpg | head -20
root@srv992229:~# find /www/media-storage -name original.wav | head -20
/www/media-storage/platform/8ccfc904-e7b5-44ef-84bd-c6bfb14b8565/original.wav
/www/media-storage/platform/10235f7d-e485-4dc4-8539-50beef7826ba/original.wav
/www/media-storage/platform/f23793fe-c4fc-45a2-acd4-c4d7606a8561/original.wav
/www/media-storage/platform/ad071d54-43a5-4396-829b-d78fa10df77d/original.wav
/www/media-storage/platform/d7241aac-625f-429a-94c3-4dbd01553646/original.wav
/www/media-storage/platform/4460547a-3499-4a15-9247-a2cfa5bc3ed6/original.wav
/www/media-storage/platform/8a8a31de-d9fc-4996-a2fb-49dca5408cac/original.wav
/www/media-storage/platform/3f08e451-5b23-4135-a5ac-16b0a95937e5/original.wav
/www/media-storage/ba86e4f8-1bc8-4c66-8964-dc06545b4f2b/4f9088f9-d869-404a-bcc5-fef163b0d61d/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/7fed99dd-4fc6-4cbd-b24d-74ec4f4dd972/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/e97cf834-26c7-48a2-8c15-2fd97d3e97e2/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/17391a5e-cd46-4bb2-b341-46160e0a0c1b/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/5b193dfb-a238-4945-82e1-749c5350a9a1/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6597e8d8-6a21-4905-bcdb-c40a66dba669/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/12a7c783-a701-4e82-a7ea-d2f8050c8c69/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/f3b4a230-d04b-4cc8-826b-dff8bba5a66a/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ca613d6a-d6c7-4cc4-b20d-811bfe0ab5fb/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/bba9e32a-d9b6-45de-b66a-b2e7281c1bf0/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/96815ad6-e10d-402a-8be9-9a9f5971edbe/original.wav
/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/da14d239-a8f0-4d5f-9423-68e5a6e1fc6c/original.wav
root@srv992229:~# find /www/media-storage -name original.mp3 | head -20
/www/media-storage/platform/cf80a780-ff35-4822-be24-fb4fbd40a1ef/original.mp3
/www/media-storage/platform/15f4d211-1e89-4111-98f6-a0a5fcfb51c1/original.mp3
/www/media-storage/platform/ae37bcda-0852-4bf7-bb8e-2f34916e5aef/original.mp3
/www/media-storage/platform/6d381017-ecf6-4107-bd93-ebbfb352d8dc/original.mp3
/www/media-storage/platform/a721d9dd-8c23-48f2-a994-fe9ba89f633c/original.mp3
/www/media-storage/platform/8b4cdbd4-6dc1-42c8-a333-6591892e6eaf/original.mp3
/www/media-storage/platform/7046912c-e68b-492a-af79-ee9dc09bbe01/original.mp3
/www/media-storage/platform/ecaf0a44-70d2-444a-9a7f-d4ab93874c81/original.mp3
/www/media-storage/platform/0135d026-ac6d-42c3-a828-8d0532f1c94b/original.mp3
/www/media-storage/platform/cc37d174-d34f-412c-a71e-90caac6ba91e/original.mp3
/www/media-storage/platform/601fa101-fcf8-426c-85b3-5018cacfc9f1/original.mp3
/www/media-storage/platform/344cefcf-765d-42e8-836f-17bf0cfe8239/original.mp3
/www/media-storage/platform/955deb23-d676-4804-b946-5c2a1ee8b724/original.mp3
/www/media-storage/platform/4b4533fb-9f04-49ac-8f15-a0e7878ee560/original.mp3
/www/media-storage/platform/695e7995-0631-4327-bfa5-f270b3e6e690/original.mp3
/www/media-storage/platform/b31d0676-c9c5-4607-ab4f-90b5c1ef309a/original.mp3
/www/media-storage/platform/bb22586f-dd95-43d9-bffb-a432905f9e11/original.mp3
/www/media-storage/platform/e8acb10c-d8e5-43f2-b91c-c9e692fb6247/original.mp3
/www/media-storage/platform/3df32d56-bb26-40bc-9e82-fbae8e8827bf/original.mp3
/www/media-storage/platform/64df60e6-3274-4799-a77b-94cc98526a01/original.mp3
root@srv992229:~# ls -l "/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6062ac8e-12ba-4390-b197-7676fee114bf/original.jpg"
ls: cannot access '/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/6062ac8e-12ba-4390-b197-7676fee114bf/original.jpg': No such file or directory
root@srv992229:~# ls -l "/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ce2bdec6-c308-499b-b391-2f55bdd19219/original.jpg"
ls: cannot access '/www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e/ce2bdec6-c308-499b-b391-2f55bdd19219/original.jpg': No such file or directory
root@srv992229:~# ls -l "/www/media-storage/platform/9528cfe5-ddcb-43bc-b99a-2eddad396b74/original.mp3"
-rw-r--r-- 1 root root 51309 May  4 14:34 /www/media-storage/platform/9528cfe5-ddcb-43bc-b99a-2eddad396b74/original.mp3
root@srv992229:~# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod
psql (16.14 (Ubuntu 16.14-0ubuntu0.24.04.1), server 16.1)
Type "help" for help.

asasprod=> SELECT storage_key
FROM media_assets
WHERE is_deleted = false
ORDER BY created_at DESC
LIMIT 20;
                        storage_key                         
------------------------------------------------------------
 platform/7742128c-7859-4f3c-ae2b-350caffaa461/original.jpg
 platform/97dae5b9-ec7f-4243-a37c-3a7c611d02b8/original.jpg
 platform/e3d45d28-05dc-42d5-bc2e-c64ac6d1f485/original.jpg
 platform/f6f74712-4139-4c0a-a5cf-4041a491a82b/original.jpg
 platform/e3b2db1b-4ea7-4cb8-acf3-87af00a7e565/original.jpg
 platform/171c5747-2bef-4776-8c7a-bab03a059d53/original.jpg
 platform/bd23a4b0-d33a-4d91-9d5f-b4893b13276e/original.jpg
 platform/d305443e-1d5c-449d-b9e5-fa9d0716e24d/original.jpg
 platform/0791b6a8-2026-437a-9fea-350c3222f80f/original.jpg
 platform/aa977472-3072-4f5c-998f-77a6fb03c48c/original.jpg
 platform/e2a359ae-e2ee-41a9-882c-9bb80f00bafd/original.jpg
 platform/e88b21fa-a139-447d-a5e7-09ed517a5b8c/original.jpg
 platform/165aa5d3-e8a2-4bc1-b07d-fdef97f4dbc5/original.jpg
 platform/996ebcda-69aa-455c-88e5-abd8587aa65d/original.jpg
 platform/bf98a00b-f5ae-4149-be6a-6c778e8ddc0a/original.jpg
 platform/96b9a0a9-77fa-4e4e-825a-b76196e343fe/original.jpg
 platform/3c50dcc0-d445-4cae-bad7-6915f9df0fde/original.jpg
 platform/23b0cc49-fb2a-4a32-9ffe-e0f3bddb558f/original.jpg
 platform/7bab61a0-51f1-47b4-9e98-49e101fdf355/original.jpg
 platform/1db065d1-04b5-4a1e-9387-ebfd6389184f/original.jpg
(20 rows)

asasprod=> asasprod=> SELECT
    split_part(storage_key,'/',1) AS root,
    COUNT(*)
FROM media_assets
WHERE is_deleted=false
GROUP BY 1
ORDER BY 2 DESC;
                 root                 | count 
--------------------------------------+-------
 platform                             |   748
 4ce1b1ce-98b4-4d8d-a01f-a08accfc127e |   238
 c87783ec-a05b-4437-ae22-5cc8ee9fe31f |    10
 ba86e4f8-1bc8-4c66-8964-dc06545b4f2b |     7
 1ce02ec6-11f5-4fee-b2fe-b78210702d60 |     1
 fb5baa83-83fe-4243-8325-31e6efeee1c4 |     1
 5442a450-e1d6-4a51-b95f-dc1389a3a324 |     1
(7 rows)
root@srv992229:~# find /www/media-storage -type f | wc -l
2320
root@srv992229:~# 
root@srv992229:~# find /www/media-storage -type f | wc -l
2320
root@srv992229:~# find /www/media-storage/platform -type f | wc -l
1744
root@srv992229:~# find /www/media-storage/4ce1b1ce-98b4-4d8d-a01f-a08accfc127e -type f | wc -l
532
root@srv992229:~# 
وجدتها.

ليست في نظام النسخ الاحتياطي.
وليست في قاعدة البيانات.

**إنها Bug حقيقي في `MediaProcessingService`.**

وقد استطعنا تحديد السطر المسؤول.

---

# أين الخطأ؟

في `processImage()`:

أنت تنشئ:

```ts
const originalWebpKey =
    this.storage.buildStorageKey(
        schoolUuid,
        assetUuid,
        'original',
        'webp',
    );
```

ثم تحفظ:

```ts
await this.storage.saveBuffer(originalWebpKey, originalWebp);
```

ثم تنشئ:

```ts
variants['original'] = {
    storage_key: originalWebpKey,
    ...
}
```

ثم...

تحذف الملف القديم:

```ts
await this.storage.deleteFile(originalStorageKey);
```

لكن بعد ذلك عندما تحدّث `mediaAsset` فإنك لا تحدّث إطلاقاً:

```ts
storageKey
contentType
preferredVariant
```

بل تحدث فقط:

```ts
variantsJson
sizeBytes
etag
processingStatus
```

أي أن قاعدة البيانات تبقى هكذا:

```text
storage_key = original.jpg
```

بينما الملف أصبح:

```text
original.webp
```

وهذا بالضبط ما رأيناه على السيرفر.

---

# لكن هناك مفاجأة ثانية

لاحظ هذا:

```ts
await this.prisma.mediaAsset.update({
    data:{
        variantsJson: JSON.stringify(variants),
        ...
    }
});
```

بينما قاعدة البيانات عندك:

```text
variants_json = NULL
```

!!

وهذا يعني شيئاً أخطر.

---

# هناك Bug ثانٍ

إما:

Prisma لا يكتب الحقل.

أو

الحقل في Prisma Schema ليس مربوطاً بهذا العمود.

لأن الكود يقول:

```ts
variantsJson
```

لكن PostgreSQL يقول:

```text
variants_json = NULL
```

وهذا لا يمكن أن يحدث إذا كان الكود الحالي هو الذي عالج هذه الملفات.

---

# لذلك عندي احتمالان

## الاحتمال الأول (الأقوى)

هذه الوسائط رُفعت قبل كتابة هذا الكود.

أي أنها قديمة.

ولهذا:

* storage_key قديم
* variants_json فارغ

وهذا يفسر كل شيء.

---

## الاحتمال الثاني

Prisma Schema لا يحتوي:

```prisma
variantsJson @map("variants_json")
```

وبالتالي التحديث لا يصل للعمود.

لكن لو كان هذا صحيحاً فستفشل جميع الوسائط الجديدة أيضاً.

---

# يوجد Bug ثالث أيضاً

لاحظ هذا:

```ts
// Delete original jpg
await this.storage.deleteFile(originalStorageKey);
```

ثم لا يوجد:

```ts
storageKey: originalWebpKey
```

وهذا Bug مؤكد.

---

# الإصلاح الصحيح

أنا لا أنصح بإصلاح النسخ الاحتياطي إطلاقاً.

الإصلاح يجب أن يكون هنا.

بعد إنشاء WebP يجب تحديث:

```ts
await prisma.mediaAsset.update({

    data:{

        storageKey: originalWebpKey,

        contentType: 'image/webp',

        preferredVariant:'original',

        variantsJson: JSON.stringify(variants),

        processingStatus: DONE,

        ...

    }

});
```

وبذلك يصبح:

DB

```text
storage_key

↓

original.webp
```

والنسخ الاحتياطي سيعمل مباشرة.

---

# لكن...

هناك شيء أخير أريد التأكد منه قبل أن نعتبر القضية منتهية.

أريد رؤية سطر `storageKey` داخل Prisma Schema.

ابحث عن Model:

```prisma
model MediaAsset
```

وأرسل فقط هذا الجزء.

أريد التأكد من وجود:

```prisma
storageKey String? @map("storage_key")

variantsJson String? @map("variants_json")

preferredVariant String? @map("preferred_variant")
```

لأنني أشك أن هناك اختلافاً بين الكود الحالي وقاعدة البيانات أو أن هذه الملفات أُنشئت بإصدار أقدم.

## خلاصة هندسية

بناءً على كل الأدلة التي جمعناها:

1. **هناك Bug مؤكد في `MediaProcessingService`**: يتم حذف الملف الأصلي بعد التحويل إلى WebP دون تحديث `storageKey` و`contentType`.
2. **هناك احتمال كبير أن البيانات التي اختبرناها قديمة** أو أن هناك عدم تطابق بين Prisma Schema وقاعدة البيانات، لأن `variants_json` بقي `NULL` رغم أن الكود الحالي يكتب إليه.
3. **نظام النسخ الاحتياطي ليس هو السبب الجذري**؛ هو كشف خللًا موجودًا في نظام إدارة الوسائط.

أنصح بإصلاح خدمة معالجة الوسائط أولًا، ثم تنفيذ Migration لإصلاح السجلات القديمة (`storage_key` و`variants_json`) بدل تعديل منطق النسخ الاحتياطي ليتجاوز البيانات غير المتسقة.


كلامه بعد ان اعطيته كلاامك
تحليله جيد، لكنه يقترح **إصلاحًا للأعراض وليس للسبب الجذري**، وهناك نقطة مهمة جدًا ستؤثر على تصميم نظام النسخ الاحتياطي على المدى الطويل.

## ما أتفق معه

أتفق 100% مع الآتي:

* سبب المشكلة هو أن `processImage()` يحذف `original.jpg`.
* لا يتم تحديث `storageKey` بعد إنشاء `original.webp`.
* هذا يؤدي إلى أن `storage_key` يشير إلى ملف غير موجود.
* هذا Bug حقيقي في نظام الوسائط.

---

## ما لا أتفق معه

قام بتعديل `pg-dump.engine.ts` ليقرأ أيضًا من `variants_json`.

أنا **لا أنصح باعتماد هذا كحل دائم**.

### لماذا؟

النسخ الاحتياطي يجب أن ينسخ **كل الملفات الموجودة على القرص**، وليس فقط الملفات المشار إليها في `variants_json`.

غدًا قد تضيف:

* `thumbnail.webp`
* `preview.webp`
* `high.webp`
* `waveform.json`
* `transcript.vtt`

هل ستتذكر في كل مرة تعديل Backup ليعرف كل نوع جديد؟

هذا يجعل Backup مرتبطًا بمنطق معالجة الوسائط، وهو عكس مبدأ الفصل بين المسؤوليات.

---

## التصميم الصحيح

برأيي، يجب أن تكون هناك قاعدة ذهبية:

> **أي ملف موجود على القرص يجب أن يكون له مرجع صحيح في قاعدة البيانات.**

وبالتالي:

بعد إنشاء:

```text
original.webp
```

يجب تنفيذ:

```ts
storageKey = originalWebpKey;
contentType = 'image/webp';
preferredVariant = 'original';
variantsJson = ...
```

وبذلك يصبح:

```
storage_key
        ↓
original.webp
```

وينتهي الإشكال.

---

## ماذا عن السجلات القديمة؟

لدينا بالفعل بيانات قديمة تحتوي على:

```
storage_key -> original.jpg
```

بينما الملف:

```
original.webp
```

هذه تحتاج **Migration** لمرة واحدة.

مثلاً:

```
لكل MediaAsset:
    إذا storage_key غير موجود
    و variants_json يحتوي original.storage_key
        حدث storage_key
        حدث content_type
        حدث preferred_variant
```

ثم تنتهي المشكلة نهائيًا.

---

## هل يجب أن يقرأ Backup من `variants_json`؟

هنا أفرق بين حالتين:

### الحالة الأولى (مؤقتًا)

نعم، إذا أردت أن تعمل النسخ الاحتياطية الحالية على البيانات القديمة، فيمكن للـ Backup أن يستخدم `variants_json` كـ **Fallback**.

أي:

```
إذا وجد storage_key
    انسخه

إذا لم يجده
    ابحث عن original داخل variants_json
    انسخه
```

هذا حل انتقالي جيد.

---

### الحالة الثانية (دائمًا)

لا.

بعد إصلاح نظام الوسائط وتشغيل Migration، يجب أن يعتمد Backup على البيانات الصحيحة، لا أن يحمل منطقًا خاصًا لتعويض أخطاء تاريخية.

---

# ملاحظة مهمة جدًا

أريد أن أعرف كيف عدّل `pg-dump.engine.ts`.

إذا كان فعل شيئًا مثل:

```ts
keys.add(asset.storage_key);

for (const variant of variants) {
    keys.add(variant.storage_key);
}
```

فهذا **صحيح** لأن النسخ الاحتياطي يجب أن ينسخ **كل الـ Variants** (`small.webp` و`medium.webp` و`original.webp`).

أما إذا أصبح:

```ts
إذا وجدت variants_json
    تجاهل storage_key
```

فهذا غير صحيح، لأن هناك ملفات (مثل الصوت والوثائق) قد تعتمد على `storage_key` مباشرة.

---

## توصيتي النهائية

سأقسم الإصلاح إلى ثلاث مراحل:

1. **إصلاح `MediaProcessingService`** (إجباري)

   * تحديث `storageKey`.
   * تحديث `contentType`.
   * تحديث `preferredVariant`.

2. **كتابة Migration لإصلاح البيانات القديمة** (إجباري)

   * تصحيح السجلات التي تشير إلى `original.jpg` بينما الملف الفعلي `original.webp`.

3. **الإبقاء على دعم `variants_json` في النسخ الاحتياطي مؤقتًا فقط** (اختياري، لتجنب فشل النسخ الاحتياطية الحالية)، ثم إزالته لاحقًا بعد اكتمال ترحيل البيانات.

بهذا تحصل على نظام متسق هندسيًا، ويظل النسخ الاحتياطي بسيطًا وموثوقًا، ولا يصبح مسؤولًا عن إصلاح أخطاء نظام الوسائط.
