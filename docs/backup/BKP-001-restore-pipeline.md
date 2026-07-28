# Restore Pipeline — وثيقة تصميم (BKP-001 Phase 4)

## لماذا هذه الوثيقة؟

الاستعادة أخطر عملية في نظام النسخ الاحتياطي — لأنها تستبدل بيانات **حية** ببيانات **قديمة**.
أي خطأ هنا = فقدان بيانات لا يمكن استرجاعها.

---

## Pipeline الاستعادة (9 خطوات)

```
1. VALIDATE          → التحقق من سلامة الحزمة
2. SAFETY_BACKUP     → نسخة أمان قبل الاستبدال (DEC-013)
3. EXTRACT           → فك الأرشيف
4. VERIFY_MANIFEST   → مطابقة checksums
5. RESTORE_DB        → استعادة قاعدة البيانات
6. RESTORE_MEDIA     → استعادة الوسائط
7. RESTORE_CONFIG    → استعادة الإعدادات
8. POST_VERIFY       → التحقق بعد الاستعادة
9. CLEANUP           → تنظيف
```

---

## تفصيل كل خطوة

### 1. VALIDATE
- التحقق من وجود ملف الأرشيف على القرص
- التحقق من وجود ملف checksum
- مطابقة SHA-256 (الأرشيف vs الـ `.sha256` file)
- التحقق من عدم وجود عملية backup/restore أخرى قيد التنفيذ

> **عند الفشل:** يتوقف فوراً — لم يُلمس أي شيء بعد.

### 2. SAFETY_BACKUP (DEC-013)
- إنشاء نسخة أمان تلقائية من الحالة الحالية
- نوعها `PRE_RESTORE` + تصنيفها `SYSTEM_SAFETY`
- **إلزامية** — لا تبدأ الاستعادة بدونها
- مثبتة تلقائياً (`isPinned = true`) — لن تُحذف بالـ retention

> **عند الفشل:** يتوقف فوراً — لم يُلمس أي شيء.
> **Rollback:** لا يحتاج — النظام لم يتغير.

### 3. EXTRACT
- فك `tar.gz` إلى مجلد مؤقت
- التحقق من وجود `manifest.json`

> **عند الفشل:** تنظيف المجلد المؤقت فقط.

### 4. VERIFY_MANIFEST
- قراءة manifest.json
- التحقق من `backupFormatVersion` (مدعوم؟)
- مطابقة checksums الداخلية (database sha256)
- التحقق من المكونات المطلوبة موجودة

> **عند الفشل:** تنظيف المجلد المؤقت فقط.

### 5. RESTORE_DB ⚠️ **نقطة اللا-رجوع**
- استعادة قاعدة البيانات باستخدام `psql`
- يقوم بـ `DROP` + `CREATE` للجداول

> **عند الفشل:** ← **ROLLBACK**
> - استعادة من Safety Backup تلقائياً
> - الحالة: `ROLLBACK_COMPLETED` أو `CRITICAL_FAILURE`

### 6. RESTORE_MEDIA (اختيارية)
- نسخ ملفات الوسائط من الأرشيف إلى `MEDIA_STORAGE_PATH`
- لا يحذف ملفات موجودة لم تكن في النسخة (merge)

> **عند الفشل:** ← يسجل كـ `WARN` ويكمل (partial)
> - الوسائط الناقصة لا تكسر النظام

### 7. RESTORE_CONFIG (اختيارية)
- نسخ ملفات الإعدادات إلى مواقعها الأصلية
- `.env` → projectRoot
- `nginx.conf` → `/etc/nginx/sites-available/asas`

> **عند الفشل:** ← يسجل كـ `WARN` ويكمل
> - الإعدادات القديمة تبقى (لا يكسر النظام)

### 8. POST_VERIFY
- اختبار اتصال قاعدة البيانات
- تنفيذ query بسيط للتحقق (`SELECT COUNT(*) FROM schools`)

> **عند الفشل:** ← يسجل كـ `WARN` — النظام استُعيد لكن يحتاج فحص يدوي

### 9. CLEANUP
- حذف المجلد المؤقت
- تحديث RestoreJob بالنتيجة

---

## قواعد Rollback

| المرحلة | هل يمكن التراجع؟ | كيف؟ |
|---------|:------------------:|------|
| 1-4 | ✅ لا يحتاج | لم يُلمس أي شيء |
| 5 (DB) | ⚠️ Safety Backup | `psql < safety_dump.sql` |
| 6 (Media) | ❌ جزئي | الملفات الأصلية لا تُحذف (merge) |
| 7 (Config) | ❌ جزئي | Safety Backup يحتوي الإعدادات |

> **القاعدة الذهبية:** إذا فشل RESTORE_DB → Rollback تلقائي من Safety Backup.
> إذا نجح RESTORE_DB → لا rollback تلقائي (حتى لو فشل Media/Config).

---

## Selective Restore (DEC-014)
المستخدم يختار ما يُستعاد:
- `restoreDatabase: true/false`
- `restoreMedia: true/false`  
- `restoreConfiguration: true/false`

إذا `restoreDatabase = false` → يتخطى خطوة 5 (لا حاجة لـ Safety Backup كامل).

---

## الملفات المطلوبة

| الملف | المسؤولية |
|-------|-----------|
| `dto/trigger-restore.dto.ts` | DTO طلب الاستعادة |
| `services/restore-orchestrator.service.ts` | Pipeline الاستعادة |
| `engines/db-restore.engine.ts` | تنفيذ `psql` |
| تحديث `backup.controller.ts` | إضافة endpoints الاستعادة |

---

## API Endpoints

```
POST   /owner/backups/restore            → بدء استعادة
GET    /owner/backups/restore-jobs        → قائمة عمليات الاستعادة
GET    /owner/backups/restore-jobs/:uuid  → تفاصيل عملية + سجلات
```
