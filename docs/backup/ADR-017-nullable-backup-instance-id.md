# ADR-017 — RestoreJob.backupInstanceId is Nullable

> **الحالة:** ✅ Approved  
> **التاريخ:** 2026-07-29  
> **السياق:** نظام النسخ الاحتياطي والاستعادة (BKP-001)

---

## السياق (Context)

عند استعادة قاعدة البيانات من نسخة احتياطية، يقوم `psql` باستبدال **كامل محتوى** قاعدة البيانات بما فيها جدول `backup_instances`.

النسخة الاحتياطية التي نستعيد **منها** قد تكون أُنشئت **بعد** وقت أخذ النسخة المستعادة. وبالتالي:

```
وقت أخذ النسخة (T1): backup_instances يحتوي ids [1..5]
وقت إنشاء نسخة جديدة (T2): backup_instances يحصل على id=7
استعادة من id=7 → DB ترجع لحالة T1 → id=7 غير موجود
```

هذا يسبب:
- `Foreign key constraint violated: restore_jobs_backup_instance_id_fkey`
- فشل إعادة إنشاء `RestoreJob` بعد استعادة DB
- فشل كامل Pipeline الاستعادة

---

## القرار (Decision)

جعل `restore_jobs.backup_instance_id` حقلاً **اختيارياً (nullable)**.

```prisma
// قبل
backupInstanceId     Int              @map("backup_instance_id")
backupInstance       BackupInstance   @relation(...)

// بعد
backupInstanceId     Int?             @map("backup_instance_id")
backupInstance       BackupInstance?  @relation(...)
```

**Migration:**
```sql
ALTER TABLE "restore_jobs" ALTER COLUMN "backup_instance_id" DROP NOT NULL;
```

---

## المبررات (Rationale)

1. **سيناريو معماري مشروع** — ليس bug أو حالة حافة (edge case)، بل نتيجة طبيعية لاستبدال قاعدة البيانات.
2. **الاستعادة أهم من التتبع** — إذا نجحت عملية `psql` فيجب إكمال Pipeline حتى لو لم نستطع ربط RestoreJob بـ BackupInstance.
3. **UUID يبقى متاحاً** — حتى مع `backupInstanceId = null`، يمكن تتبع النسخة عبر UUID المحفوظ في السجلات.

---

## العواقب (Consequences)

### إيجابية
- ✅ Restore Pipeline يكتمل بنجاح دائماً بعد DB restore
- ✅ لا حاجة لـ raw SQL أو workarounds
- ✅ النظام يتعامل مع سيناريو DB replacement بشكل طبيعي

### سلبية
- ⚠️ بعض `RestoreJob` records قد لا تحتوي على رابط مباشر للـ BackupInstance
- ⚠️ يجب مراعاة null-checks عند عرض تفاصيل RestoreJob في Flutter UI

---

## البدائل المرفوضة

| البديل | سبب الرفض |
|--------|-----------|
| Raw SQL لتجاوز Prisma | تناقض بين Schema و DB والكود |
| إدراج BackupInstance وهمي | بيانات غير حقيقية في DB |
| إيقاف Pipeline عند عدم وجود Instance | الاستعادة نجحت فعلاً — لا منطق في إيقافها |
