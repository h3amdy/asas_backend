# BKP-001 — Backup & Recovery System
# وثيقة التصميم المعماري (النسخة النهائية المعتمدة)

> **المعرف:** BKP-001  
> **الحالة:** Design Complete — Ready for Implementation  
> **الإصدار:** 2.0  
> **تاريخ الإنشاء:** 2026-07-27  
> **آخر تحديث:** 2026-07-27  
> **المرجع:** [وثيقة التحليل](file:///Users/hamdy/development/Projects/asas_backend/docs/backup/BKP-001-analysis.md)

> [!IMPORTANT]
> هذه الوثيقة هي **مصدر الحقيقة الوحيد** لنظام النسخ الاحتياطي. أي تعارض مع محادثات ChatGPT السابقة — هذه الوثيقة هي المعتمدة.

---

## 1. القرارات المعمارية المعتمدة (ملخص)

| # | القرار | الخلاصة |
|---|--------|---------|
| DEC-001 | Scope | DB + Media + Config |
| DEC-002 | Strategy | Full Backup فقط في MVP |
| DEC-003 | Package | `tar.gz` + manifest داخلي + sha256 خارجي |
| DEC-004 | Storage | Local مع تصميم Providers |
| DEC-005 | Retention | 30 نسخة / 90 يوم + Pinned |
| DEC-006 | Scheduling | يدوي + تلقائي + فصل عن المحرك |
| DEC-007 | Encryption | لا تشفير MVP — طبقة قابلة للإضافة |
| DEC-008 | Consistency | قائمة الوسائط من الـ dump + 3 حالات |
| DEC-009 | Engine | Orchestrator — ليس Engine من الصفر |
| DEC-010 | Pre-flight | فحص شامل قبل كل عملية |
| DEC-011 | Authorization | Platform Owner فقط |
| DEC-012 | Data Model | 5 جداول: Plan, Job, Instance, RestoreJob, Log |
| DEC-013 | Safety Backup | نسخة أمان إلزامية قبل أي Restore |
| DEC-014 | Restore Modes | استعادة انتقائية (DB / Media / Config) |

---

## 2. نموذج البيانات (5 جداول)

> [!NOTE]
> ChatGPT اقترح فصل Job عن Instance — وهذا القرار صحيح واعتمدناه.
> لكنه رقّم القرارات بأرقام تتعارض مع قراراتنا السابقة (DEC-007 عنده = Data Model، بينما عندنا = Encryption). تم إعادة الترقيم أدناه.

### المبدأ الأساسي:
- **Plan** = إعدادات (كيف ومتى وأين)
- **Job** = محاولة تنفيذ (قد تنجح أو تفشل)
- **Instance** = نسخة موجودة فعلياً (ملف على القرص)
- **RestoreJob** = عملية استعادة مستقلة
- **Log** = سجل أحداث للتشخيص

### مخطط العلاقات

```text
backup_plans ──1:N──▶ backup_jobs ──0..1──▶ backup_instances
                                                    │
                                               1:N  │
                                                    ▼
                                             restore_jobs

backup_logs (مرتبط بـ job_id — يشمل backup و restore)
```

### Prisma Schema النهائي

```prisma
// =========================
// BACKUP & RECOVERY SYSTEM (BKP-001)
// =========================

enum BackupScheduleType {
  DAILY
  WEEKLY
  MONTHLY
}

enum BackupTriggerType {
  MANUAL
  SCHEDULED
  PRE_RESTORE
}

enum BackupJobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}

enum BackupInstanceStatus {
  SUCCESS
  PARTIAL_SUCCESS
  FAILED
}

enum BackupCategory {
  NORMAL
  SYSTEM_SAFETY
}

enum RestoreJobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  ROLLBACK_COMPLETED
  CRITICAL_FAILURE
}

enum BackupLogLevel {
  INFO
  WARN
  ERROR
}

enum BackupLogPhase {
  PREFLIGHT
  DB_DUMP
  MEDIA_COPY
  CONFIG_COPY
  MANIFEST
  COMPRESS
  CHECKSUM
  ACTIVATE
  CLEANUP
  RETENTION
  RESTORE_VALIDATE
  RESTORE_SAFETY
  RESTORE_DB
  RESTORE_MEDIA
  RESTORE_CONFIG
  RESTORE_VERIFY
  RESTORE_ROLLBACK
}

// ── خطة النسخ الاحتياطي ──
model BackupPlan {
  id   Int    @id @default(autoincrement())
  uuid String @unique @default(uuid())

  name         String
  enabled      Boolean            @default(true)
  scheduleType BackupScheduleType @default(DAILY) @map("schedule_type")
  runTime      String             @default("02:00") @map("run_time")
  timezone     String             @default("Asia/Aden")

  // Storage
  storageType String @default("LOCAL") @map("storage_type")
  storagePath String @default("/var/backups/asas") @map("storage_path")

  // Retention Policy
  maxBackups  Int     @default(30) @map("max_backups")
  maxAgeDays  Int     @default(90) @map("max_age_days")
  autoCleanup Boolean @default(true) @map("auto_cleanup")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  jobs      BackupJob[]
  instances BackupInstance[]

  @@map("backup_plans")
}

// ── عملية تنفيذ النسخ (محاولة) ──
model BackupJob {
  id   Int    @id @default(autoincrement())
  uuid String @unique @default(uuid())

  planId Int?        @map("plan_id")
  plan   BackupPlan? @relation(fields: [planId], references: [id])

  backupInstanceId Int?            @map("backup_instance_id")
  backupInstance   BackupInstance? @relation(fields: [backupInstanceId], references: [id])

  status       BackupJobStatus   @default(PENDING)
  triggeredBy  BackupTriggerType @map("triggered_by")
  errorMessage String?           @map("error_message")

  // من بدأ العملية (OWNER uuid — nullable للعمليات المجدولة)
  initiatedByUserUuid String? @map("initiated_by_user_uuid")

  startedAt  DateTime? @map("started_at")
  finishedAt DateTime? @map("finished_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  logs BackupLog[]

  @@index([status], map: "backup_jobs_status_idx")
  @@index([createdAt], map: "backup_jobs_created_at_idx")
  @@map("backup_jobs")
}

// ── نسخة احتياطية حقيقية (ملف موجود) ──
model BackupInstance {
  id   Int    @id @default(autoincrement())
  uuid String @unique @default(uuid())

  planId Int?        @map("plan_id")
  plan   BackupPlan? @relation(fields: [planId], references: [id])

  backupName     String @unique @map("backup_name")  // اسم الملف
  backupType     String @default("FULL") @map("backup_type")
  category       BackupCategory @default(NORMAL)
  status         BackupInstanceStatus

  // بيانات الأرشيف
  fileSizeBytes  BigInt  @map("file_size_bytes")
  sha256         String
  packageVersion String  @default("1.0") @map("package_version")
  systemVersion  String? @map("system_version")

  // محتويات النسخة (لدعم Selective Restore)
  containsDatabase      Boolean @default(true) @map("contains_database")
  containsMedia         Boolean @default(true) @map("contains_media")
  containsConfiguration Boolean @default(true) @map("contains_configuration")

  // إحصائيات المكونات
  dbSizeBytes      BigInt? @map("db_size_bytes")
  mediaFilesCount  Int?    @map("media_files_count")
  mediaFilesCopied Int?    @map("media_files_copied")
  mediaSizeBytes   BigInt? @map("media_size_bytes")
  configSizeBytes  BigInt? @map("config_size_bytes")
  missingMedia     Json?   @map("missing_media")

  // حماية
  isPinned Boolean @default(false) @map("is_pinned")

  createdAt DateTime  @default(now()) @map("created_at")
  isDeleted Boolean   @default(false) @map("is_deleted")
  deletedAt DateTime? @map("deleted_at")

  jobs        BackupJob[]
  restoreJobs RestoreJob[] @relation("RestoredFrom")
  safetyFor   RestoreJob[] @relation("SafetyBackup")

  @@index([status], map: "backup_instances_status_idx")
  @@index([createdAt], map: "backup_instances_created_at_idx")
  @@index([category], map: "backup_instances_category_idx")
  @@map("backup_instances")
}

// ── عملية استعادة ──
model RestoreJob {
  id   Int    @id @default(autoincrement())
  uuid String @unique @default(uuid())

  backupInstanceId Int            @map("backup_instance_id")
  backupInstance   BackupInstance @relation("RestoredFrom", fields: [backupInstanceId], references: [id])

  status       RestoreJobStatus @default(PENDING)
  errorMessage String?          @map("error_message")

  // ما يُستعاد (Selective Restore)
  restoreDatabase      Boolean @default(true) @map("restore_database")
  restoreMedia         Boolean @default(true) @map("restore_media")
  restoreConfiguration Boolean @default(true) @map("restore_configuration")

  // Safety Backup
  safetyBackupId Int?            @map("safety_backup_id")
  safetyBackup   BackupInstance? @relation("SafetyBackup", fields: [safetyBackupId], references: [id])

  initiatedByUserUuid String @map("initiated_by_user_uuid")

  startedAt   DateTime? @map("started_at")
  finishedAt  DateTime? @map("finished_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  logs BackupLog[]

  @@index([status], map: "restore_jobs_status_idx")
  @@map("restore_jobs")
}

// ── سجل أحداث ──
model BackupLog {
  id   Int    @id @default(autoincrement())
  uuid String @unique @default(uuid())

  // مرتبط بـ Job (نسخ أو استعادة)
  backupJobId  Int?       @map("backup_job_id")
  backupJob    BackupJob? @relation(fields: [backupJobId], references: [id])

  restoreJobId Int?        @map("restore_job_id")
  restoreJob   RestoreJob? @relation(fields: [restoreJobId], references: [id])

  level    BackupLogLevel
  phase    BackupLogPhase
  message  String
  metadata Json?

  createdAt DateTime @default(now()) @map("created_at")

  @@index([backupJobId], map: "backup_logs_job_idx")
  @@index([restoreJobId], map: "backup_logs_restore_idx")
  @@map("backup_logs")
}
```

### ما عدّلته عن اقتراح ChatGPT:

| النقطة | ChatGPT | قراري (المعتمد) | السبب |
|--------|---------|----------------|-------|
| ترقيم القرار | DEC-007 | DEC-012 | DEC-007 مستخدم فعلاً للتشفير |
| `backup_instances.status` | COMPLETED/FAILED | SUCCESS/PARTIAL_SUCCESS/FAILED | ليتوافق مع DEC-008 (Consistency) |
| `category` field | غير موجود | `BackupCategory: NORMAL/SYSTEM_SAFETY` | لتمييز Safety Backup ومنع الحلقات |
| `contains_*` fields | اقترحها كإضافة | ✅ اعتمدتها | ضرورية للاستعادة الانتقائية |
| `initiated_by_user_uuid` | `initiated_by_user_id` (Int) | String (UUID) | لأن الـ JWT يحتوي UUID وليس ID |

---

## 3. محرك النسخ الاحتياطي (Backup Engine)

### ⚠️ أخطاء في ChatGPT أصلحتها:

| النقطة | ChatGPT قال | الصحيح (المعتمد) | المرجع |
|--------|------------|-----------------|--------|
| صيغة الأرشيف | ZIP / `backup.zip` | **tar.gz** | DEC-003 مُعدّل |
| checksum | `checksum.sha256` (غير واضح الموقع) | **خارجي** `.tar.gz.sha256` + **checksums في manifest** | DEC-003 + chat45 |
| مجلد النسخ | `active/` | **`completed/`** | قرارنا — أبسط في MVP |
| نسخ الوسائط | "نسخ المجلد بالكامل" | **استخراج القائمة من الـ dump** ثم نسخ حسب القائمة | DEC-008 (Consistency) |
| Pre-flight | مذكور جزئياً في Initialization | **مرحلة كاملة مستقلة** | DEC-010 |

### تدفق العمل المعتمد (Pipeline)

```text
1. PREFLIGHT VALIDATION
   ├── مساحة القرص كافية؟
   ├── pg_dump / tar / gzip متوفرة؟
   ├── اتصال DB يعمل؟
   ├── صلاحيات الكتابة؟
   └── لا يوجد Job آخر RUNNING؟

2. CREATE JOB (status=RUNNING)
   └── إنشاء working dir: /var/backups/asas/temp/{job_uuid}/

3. EXPORT DATABASE
   └── pg_dump → database/postgres.sql.gz

4. COPY MEDIA (من قائمة الـ dump — ليس المجلد كاملاً)
   ├── استخراج storage_keys من snapshot
   ├── نسخ كل ملف
   └── تسجيل المفقود → PARTIAL_SUCCESS

5. COPY CONFIG
   └── .env, nginx.conf, pm2.config.js → config/

6. BUILD MANIFEST
   └── manifest.json (مع consistency report + checksums لكل ملف)

7. COMPRESS
   └── tar -czf backup_YYYY-MM-DD_HH-MM-SS.tar.gz ...

8. GENERATE CHECKSUM
   └── sha256sum > backup_*.tar.gz.sha256 (خارج الأرشيف)

9. VERIFY
   └── sha256sum -c + tar -tzf (اختبار سلامة)

10. ACTIVATE
    └── mv temp/{job_uuid}/* → completed/

11. CREATE INSTANCE RECORD + UPDATE JOB

12. APPLY RETENTION POLICY

13. CLEANUP temp/
```

---

## 4. محرك الاستعادة (Restore Engine)

### تدفق العمل المعتمد

```text
1. VALIDATE REQUEST
   ├── المستخدم Platform Owner?
   ├── لا يوجد Backup أو Restore آخر RUNNING?
   ├── النسخة موجودة وصالحة?
   └── المكونات المطلوبة موجودة في النسخة? (contains_*)

2. VERIFY PACKAGE
   ├── sha256sum -c (التحقق الخارجي)
   ├── tar -tzf (سلامة الأرشيف)
   └── manifest.json موجود ومتوافق الإصدار?

3. CREATE SAFETY BACKUP
   ├── Full Backup تلقائي (category=SYSTEM_SAFETY)
   ├── إذا فشل → إلغاء Restore بالكامل
   └── ⚠️ Safety Backup لا تنشئ Safety Backup أخرى

4. ACTIVATE MAINTENANCE MODE
   └── منع جميع المستخدمين من الوصول

5. EXTRACT PACKAGE
   └── فك الضغط في temp/restore/{restore_job_uuid}/

6. RESTORE COMPONENTS (حسب الاختيار)
   ├── Database: إغلاق اتصالات → psql → تحقق
   ├── Media: نقل الحالي لمجلد مؤقت → نسخ الجديد → تحقق → حذف المؤقت
   └── Config: استعادة من Whitelist فقط → reload services

7. VERIFY RESTORE
   ├── DB: اتصال + جداول أساسية + استعلام بسيط
   ├── Media: وجود المجلد + عينات
   └── Config: وجود الملفات + nginx -t

8. DEACTIVATE MAINTENANCE MODE

9. UPDATE RESTORE JOB → COMPLETED
```

### حالات Rollback

| الحالة | المعنى |
|--------|--------|
| `COMPLETED` | الاستعادة نجحت بالكامل |
| `FAILED` | فشلت قبل تعديل أي بيانات |
| `ROLLBACK_COMPLETED` | فشلت بعد بدء التعديل → تم الرجوع بنجاح من Safety Backup |
| `CRITICAL_FAILURE` | فشلت الاستعادة وفشل الرجوع → تدخل يدوي مطلوب |

---

## 5. تصميم API

### ⚠️ تصحيح عن ChatGPT:

ChatGPT استخدم `/platform/backups/...` — لكن بعد فحص الكود الفعلي، عمليات OWNER تستخدم **`owner/`** prefix مع `PlatformJwtAuthGuard` + `PlatformAdminGuard` (كما في [owner.controller.ts](file:///Users/hamdy/development/Projects/asas_backend/src/owner/owner.controller.ts)).

**المسار المعتمد:** `owner/backups/...`

| Method | Endpoint | الوصف |
|--------|----------|-------|
| **Backup Plan** | | |
| `GET` | `/owner/backups/plan` | عرض الخطة الحالية |
| `PATCH` | `/owner/backups/plan` | تعديل الخطة |
| **Backup Instances** | | |
| `POST` | `/owner/backups` | إنشاء نسخة يدوية → 202 + jobId |
| `GET` | `/owner/backups` | قائمة النسخ (pagination + filters) |
| `GET` | `/owner/backups/:uuid` | تفاصيل نسخة |
| `DELETE` | `/owner/backups/:uuid` | حذف نسخة |
| `POST` | `/owner/backups/:uuid/pin` | تثبيت |
| `DELETE` | `/owner/backups/:uuid/pin` | إلغاء تثبيت |
| `GET` | `/owner/backups/:uuid/download` | تحميل الملف |
| **Restore** | | |
| `POST` | `/owner/backups/:uuid/restore` | بدء استعادة → 202 + restoreJobId |
| **Jobs & Monitoring** | | |
| `GET` | `/owner/backups/jobs` | قائمة عمليات النسخ |
| `GET` | `/owner/backups/jobs/:uuid` | تفاصيل + سجلات |
| `GET` | `/owner/backups/restore-jobs` | قائمة عمليات الاستعادة |
| `GET` | `/owner/backups/restore-jobs/:uuid` | تفاصيل + سجلات |
| `GET` | `/owner/backups/status` | حالة النظام |

### أكواد الأخطاء (من ChatGPT — ✅ كلها صحيحة)

| Code | المعنى |
|------|--------|
| `BACKUP_ALREADY_RUNNING` | توجد عملية قيد التنفيذ |
| `RESTORE_ALREADY_RUNNING` | توجد عملية استعادة قيد التنفيذ |
| `SAFETY_BACKUP_FAILED` | فشل إنشاء نسخة الأمان |
| `BACKUP_NOT_FOUND` | النسخة غير موجودة |
| `BACKUP_PACKAGE_CORRUPTED` | الحزمة تالفة |
| `BACKUP_CHECKSUM_MISMATCH` | فشل التحقق من Checksum |
| `BACKUP_COMPONENT_NOT_AVAILABLE` | المكون المطلوب غير موجود |
| `BACKUP_IS_PINNED` | النسخة مثبتة |
| `BACKUP_IN_USE` | النسخة مستخدمة في عملية أخرى |
| `INSUFFICIENT_DISK_SPACE` | لا توجد مساحة كافية |
| `RESTORE_ROLLBACK_FAILED` | فشل Rollback |

---

## 6. بنية الملفات في Backend

```text
src/owner/backup/
├── backup.module.ts
├── backup.controller.ts
│
├── services/
│   ├── backup-orchestrator.service.ts
│   ├── backup-scheduler.service.ts
│   ├── retention.service.ts
│   ├── preflight-validator.service.ts
│   └── backup-logger.service.ts
│
├── engines/
│   ├── backup-engine.interface.ts
│   ├── pg-dump.engine.ts
│   ├── media-backup.engine.ts
│   ├── config-backup.engine.ts
│   └── restore.engine.ts
│
├── storage/
│   ├── storage-provider.interface.ts
│   └── local-storage.provider.ts
│
├── dto/
│   ├── create-backup.dto.ts
│   ├── update-plan.dto.ts
│   ├── restore-request.dto.ts
│   └── backup-response.dto.ts
│
└── types/
    ├── manifest.type.ts
    ├── backup-status.type.ts
    └── error-codes.ts
```

---

## 7. بنية manifest.json المعتمدة

```json
{
  "backupId": "uuid",
  "version": "1.0",
  "createdAt": "2026-07-27T23:30:15Z",
  "systemVersion": "Asas 1.5.0",
  "backupType": "FULL",
  "triggerType": "SCHEDULED",
  "category": "NORMAL",

  "components": {
    "database": {
      "included": true,
      "engine": "pg_dump",
      "format": "sql.gz",
      "file": "database/postgres.sql.gz",
      "sizeBytes": 52389412,
      "sha256": "abc123..."
    },
    "media": {
      "included": true,
      "directory": "media/",
      "filesExpected": 1832,
      "filesCopied": 1830,
      "sizeBytes": 9483274921
    },
    "config": {
      "included": true,
      "directory": "config/",
      "files": [".env", "nginx.conf", "pm2.config.js"],
      "sizeBytes": 3184
    }
  },

  "consistency": {
    "databaseSnapshot": "2026-07-27T23:30:15Z",
    "status": "PARTIAL_SUCCESS",
    "missingMedia": ["school-uuid/asset-uuid/original.mp4"]
  },

  "checksums": {
    "database/postgres.sql.gz": "sha256:abc...",
    "config/.env": "sha256:def..."
  }
}
```

---

## 8. خطة التنفيذ

| المرحلة | المحتوى | الحالة |
|---------|---------|--------|
| 1 | Prisma Schema + Module + Storage Provider | جاهز للتنفيذ |
| 2 | Backup Engine (pg_dump + media + config + orchestrator) | جاهز للتنفيذ |
| 3 | API Controller + Scheduler + Retention | جاهز للتنفيذ |
| 4 | Restore Engine + Maintenance Mode + Safety Backup | جاهز للتنفيذ |
| 5 | الاختبارات | بعد التنفيذ |
| 6 | واجهة Flutter (Admin Panel) | بالتوازي مع الباكيند |
