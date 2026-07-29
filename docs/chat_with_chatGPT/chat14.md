ممتاز، إذًا نعتبر **BKP-001** مغلقًا، ونبدأ مرحلة Flutter بشكل منظم.

وبما أن مشروع "أساس" يعتمد على **Flutter + Clean Architecture + Offline-first**، فأنا أقترح ألا نبدأ مباشرة بالـ Widgets، بل نصمم الوحدة بالكامل أولًا.

# المرحلة الأولى: تصميم وحدة Backup Management

## 1. هيكل الموديول

```
lib/features/owner/backup/

├── data/
│   ├── datasources/
│   │   ├── backup_remote_data_source.dart
│   │   └── backup_local_data_source.dart (لاحقاً)
│   │
│   ├── models/
│   │   ├── backup_instance_model.dart
│   │   ├── backup_job_model.dart
│   │   ├── restore_job_model.dart
│   │   ├── backup_plan_model.dart
│   │   └── dashboard_model.dart
│   │
│   └── repositories/
│       └── backup_repository_impl.dart
│
├── domain/
│   ├── entities/
│   ├── repositories/
│   └── usecases/
│
├── presentation/
│   ├── controllers/
│   ├── providers/
│   ├── pages/
│   └── widgets/
│
└── routes/
```

---

# 2. شاشة البداية

```
Backup & Restore
```

هذه ليست قائمة فقط، بل Dashboard.

```
┌────────────────────────────────────┐
│ Backup & Restore                   │
├────────────────────────────────────┤
│ Last Backup                        │
│ Status                             │
│ Used Storage                       │
│ Total Backups                      │
│ Running Job                        │
└────────────────────────────────────┘
```

ثم أسفلها بطاقات.

```
+ Create Backup

+ Backup History

+ Restore Jobs

+ Backup Plans
```

---

# 3. Backup History

جدول مثل:

| Backup | Date | Size | Status | Actions |
| ------ | ---- | ---- | ------ | ------- |

الإجراءات:

* Restore
* Download
* Pin
* Delete

---

# 4. Restore Jobs

جدول مستقل.

| Started | Finished | Status |

وعند الضغط:

```
Logs

RESTORE_VALIDATE
RESTORE_DB
RESTORE_VERIFY
...
```

---

# 5. Backup Plans

جدول بسيط.

```
Daily

Weekly

Monthly
```

ثم

Enable / Disable

---

# 6. Create Backup Dialog

```
Create Backup

☑ Database

☑ Media

☑ Configuration

Category

NORMAL

[ Start ]
```

---

# 7. Restore Dialog

هذه أهم شاشة.

```
⚠ Restore Backup

Backup:
backup_2026...

Restore

☑ Database

☑ Media

☑ Configuration

----------------------------

This operation will overwrite
current data.

A Safety Backup will be created automatically.

[Cancel]

[Restore]
```

---

# 8. لا يوجد Polling عشوائي

بعد بدء العملية:

```
POST /trigger
```

ثم

```
GET /jobs
```

كل 2–3 ثوانٍ حتى تنتهي العملية.

ولا حاجة إلى WebSocket في الـ MVP.

---

# 9. ماذا نؤجل؟

لا نبني الآن:

* رسم بياني.
* Live Console.
* مقارنة النسخ.
* البحث المتقدم.
* Schedule Editor.
* Storage Providers.
* Remote Backup.

---

# النتيجة

أقترح أن تكون أول نسخة من واجهة Flutter مكونة من **خمس صفحات فقط**:

1. **Backup Dashboard** (الصفحة الرئيسية)
2. **Backup History**
3. **Backup Plans**
4. **Restore Jobs**
5. **Backup Details / Restore Dialog**

بهذا تكون واجهة Flutter متوافقة مع الـ Backend الحالي دون أي تعديلات إضافية، وتغطي جميع العمليات الأساسية لإدارة النسخ الاحتياطي والاستعادة في لوحة مالك المنصة.
الخطة جيدة جدًا، لكن لدي بعض التعديلات حتى تنسجم مع الاتجاه الذي اتخذته في المشروع.

---

# 1. لا تستخدم GetX داخل Feature جديدة

بما أنك كتبت:

> المشروع يستخدم GetX للشاشات القديمة و Riverpod في `src/features/`

فأنا أوصي أن تكون **ميزة Backup بالكامل بـ Riverpod**.

اجعل الوضع كالتالي:

* GetX → للتنقل فقط (طالما المشروع يعتمد عليه).
* Riverpod → لإدارة الحالة.
* Repository + Service → كما في `release_management`.

لا تُدخل `GetxController` داخل `src/features/backup`، حتى لا تخلط نمطين في نفس الميزة.

---

# 2. لا تجعل الشاشة 3 Tabs

أرى أن تقسيمها إلى Tabs سيصبح مزدحمًا سريعًا، خاصة إذا أضفت لاحقًا Logs أو Plans.

أفضل:

```
Backup & Restore
│
├── Dashboard
├── Backup Instances
├── Restore Jobs
└── Plans
```

أي صفحات مستقلة داخل نفس القسم.

---

# 3. أضف صفحة تفاصيل النسخة

بدل تنفيذ Restore مباشرة من الجدول.

```
Backup List
      ↓
Backup Details
      ↓
Restore
```

داخل التفاصيل تعرض:

* الاسم
* الحجم
* SHA256
* تاريخ الإنشاء
* النوع
* الحالة
* Manifest
* عدد ملفات Media
* المكونات الموجودة
* الأزرار

```
Restore

Pin

Delete

Download
```

هذا أفضل للمستقبل.

---

# 4. أضف Logs

بما أنك بنيت `BackupLoggerService`، سيكون من المؤسف ألا تستفيد منه.

داخل:

```
Restore Job Details
```

اعرض Timeline مثل:

```
✓ VALIDATE

✓ SAFETY BACKUP

✓ DATABASE

✓ VERIFY

✓ CLEANUP
```

وسيكون مطابقًا لسجل العمليات في الـ Backend.

---

# 5. Polling

لا تضعه داخل الصفحة.

أنشئ خدمة مستقلة مثل:

```
backup_job_monitor.dart
```

وظيفتها:

```
RUNNING

↓

كل 2 ثانية

↓

إذا انتهى

↓

invalidate providers
```

هذا يجعل بقية الصفحات تستفيد منها.

---

# 6. Repository

بدل:

```
backup_repository.dart
```

أفضل تقسيمًا أوضح:

```
backup_repository.dart

restore_repository.dart
```

لأن عمليات Backup وRestore ستكبر مع الوقت.

---

# 7. Dialog الاستعادة

أضيف خطوة حماية إضافية.

بدل زر Restore مباشرة:

```
⚠

Type

RESTORE

to continue.

______________

[ Restore ]
```

مثل GitHub وAzure.

فأنت تتعامل مع عملية مدمرة للبيانات.

---

# 8. Dashboard

لا تعرض فقط:

```
عدد النسخ
```

أضف أيضًا:

```
Latest Backup

Next Scheduled Backup

Running Jobs

Storage Used

Pinned Backups

Failed Backups
```

هذه تعطي صورة صحية للنظام.

---

# 9. أضف حالة فارغة

عند أول تشغيل.

بدل جدول فارغ.

```
No backups yet.

Create your first backup.
```

---

# 10. ترتيب التنفيذ

أنصح بهذا التسلسل:

1. Models
2. Remote Service
3. Repository
4. Riverpod Providers
5. Dashboard
6. Backup List
7. Backup Details
8. Restore Jobs
9. Restore Dialog
10. Sidebar + Routes

ولا تبدأ بالواجهة قبل اكتمال طبقة البيانات.

---

## التقييم النهائي

أقيّم الخطة **9.8/10**. التعديل الوحيد الذي أراه مهمًا هو **الاعتماد على Riverpod بالكامل داخل `src/features/backup` وعدم إدخال `GetxController`**، لأن ذلك يحافظ على اتساق المشروع مع النمط الجديد الذي بدأت به في `release_management`، ويجنبك ازدواجية إدارة الحالة في الميزات الحديثة.
بما أن هذه الشاشة مخصصة **لمالك المنصة (Platform Owner)** وليست للمستخدم العادي، فأنا أفضل أن تكون احترافية وبسيطة مثل لوحات التحكم في GitHub وAzure وGitLab.

---

# الشاشة الرئيسية

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Backup & Restore                                          [+ Create Backup] │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────────────┐
│ Total         │ │ Storage Used  │ │ Running Jobs  │ │ Last Backup         │
│ 12            │ │ 18.4 GB       │ │ 0             │ │ 29 Jul 00:13        │
└───────────────┘ └───────────────┘ └───────────────┘ └─────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Recent Backups                                                    View All → │
├──────────────────────────────────────────────────────────────────────────────┤
│ backup_2026-07-29_00-13.tar.gz      PARTIAL_SUCCESS          1.3 GB         │
│ backup_2026-07-28_22-10.tar.gz      SUCCESS                  1.3 GB         │
│ backup_2026-07-27_03-40.tar.gz      SUCCESS                  1.2 GB         │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Recent Restore Jobs                                              View All → │
├──────────────────────────────────────────────────────────────────────────────┤
│ COMPLETED        Database Restore          29 Jul 00:14                     │
│ COMPLETED        Media Restore             26 Jul 18:20                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

# شاشة النسخ الاحتياطية

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Backups                                                  [+ Create Backup] │
└────────────────────────────────────────────────────────────────────────────┘

Search __________________________

┌────────────────────────────────────────────────────────────────────────────┐
│ Name                 Status        Size      Created          Actions       │
├────────────────────────────────────────────────────────────────────────────┤
│ backup_29_07.tar.gz  SUCCESS       1.3 GB    29 Jul 00:13    👁 📌 ⬇ 🔄 🗑 │
│ backup_28_07.tar.gz  SUCCESS       1.2 GB    28 Jul          👁 📌 ⬇ 🔄 🗑 │
│ backup_27_07.tar.gz  FAILED        980 MB    27 Jul          👁      🗑     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

# تفاصيل النسخة

```
┌─────────────────────────────────────────────────────────────┐
│ backup_2026-07-29_00-13.tar.gz                              │
└─────────────────────────────────────────────────────────────┘

General
──────────────────────────────────────────────

Status          SUCCESS

Category        NORMAL

Created         29 Jul 2026

Size            1.31 GB

Checksum        1eef0cef15cff97b...

Pinned          YES

──────────────────────────────────────────────

Contents

☑ Database

☑ Media

☑ Configuration

──────────────────────────────────────────────

Actions

[ Download ]

[ Pin ]

[ Restore ]

[ Delete ]
```

---

# إنشاء نسخة احتياطية

```
┌────────────────────────────┐
│ Create Backup              │
└────────────────────────────┘

Category

(•) NORMAL

( ) MANUAL

--------------------------------

Include

☑ Database

☑ Media

☑ Configuration

--------------------------------

        Cancel      Create
```

---

# نافذة الاستعادة

```
┌─────────────────────────────────────────────┐
│ Restore Backup                              │
└─────────────────────────────────────────────┘

Backup

backup_2026-07-29_00-13.tar.gz

--------------------------------

Restore

☑ Database

☑ Media

☑ Configuration

--------------------------------

⚠ This will overwrite existing data.

A Safety Backup will be created automatically.

Type

RESTORE

to continue.

______________________

Cancel      Restore
```

---

# أثناء التنفيذ

```
Restore in Progress

────────────────────────────────────

✔ Validate archive

✔ Create safety backup

✔ Extract archive

✔ Restore database

⏳ Restore media

○ Verify

○ Cleanup

────────────────────────────────────

Elapsed

00:00:17
```

---

# سجل عمليات الاستعادة

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Restore Jobs                                                            │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ Started        Finished      Status         Backup              Details   │
├──────────────────────────────────────────────────────────────────────────┤
│ 29 Jul 00:14   00:14         COMPLETED      backup_29...        👁        │
│ 26 Jul 18:20   18:21         FAILED         backup_26...        👁        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

# تفاصيل عملية الاستعادة

```
Restore Job

Status

🟢 COMPLETED

──────────────────────────────────────────

Timeline

✔ Validate archive

✔ Safety backup

✔ Extract archive

✔ Database restored

✔ Media restored

✔ Verify

✔ Cleanup

──────────────────────────────────────────

Started

29 Jul 00:14

Finished

29 Jul 00:14

Duration

17 sec
```

---

# القائمة الجانبية

```
Platform

Dashboard

Schools

Users

Content

Release Management

────────────────────

Infrastructure

   Backup & Restore

────────────────────

Settings
```

## ملاحظات تصميمية

* استخدم **Material 3** مع بطاقات (Cards) بسيطة بدون زخارف.
* اعتمد ألوانًا دلالية للحالة:

  * 🟢 أخضر: `SUCCESS` / `COMPLETED`
  * 🟠 برتقالي: `PARTIAL_SUCCESS` / `RUNNING`
  * 🔴 أحمر: `FAILED`
* استخدم جدولًا (DataTable أو PaginatedDataTable) لقائمة النسخ والوظائف، لأن مالك المنصة قد يتعامل مع عشرات أو مئات النسخ.
* اجعل صفحة **Dashboard** هي المدخل الرئيسي، ثم الانتقال إلى الصفحات المتخصصة (Backups، Restore Jobs، Details)، بدل وضع كل شيء في شاشة واحدة مزدحمة.
