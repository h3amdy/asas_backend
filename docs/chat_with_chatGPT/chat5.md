أتفق مع التوجه، لكن **لا أنصح بتنفيذ الاستعادة الكاملة مباشرة** قبل التحقق من نقطة واحدة.

السبب أن هذا الأمر:

```json
{
  "restoreDatabase": true,
  "restoreMedia": true,
  "restoreConfiguration": true
}
```

لن يختبر فقط استعادة قاعدة البيانات، بل سيختبر **ثلاثة مكونات معًا**:

1. Database Restore
2. Media Restore
3. Configuration Restore

إذا فشل، فلن تعرف مباشرة أي جزء هو السبب.

## الأفضل في مرحلة الاختبار

اختبر أولًا استعادة قاعدة البيانات وحدها:

```bash
curl -X POST http://localhost:3010/api/v1/owner/backups/restore \
  -H "Content-Type: application/json" \
  -d '{
    "backupInstanceUuid": "a3857c45-c6dc-481b-8941-f61bfc8fd946",
    "restoreDatabase": true,
    "restoreMedia": false,
    "restoreConfiguration": false
  }'
```

بهذا نختبر:

* ✅ إنشاء Safety Backup (إذا كان النظام ينشئها عند استعادة قاعدة البيانات).
* ✅ فك ضغط النسخة.
* ✅ استعادة قاعدة البيانات.
* ✅ تشغيل `psql` أو الآلية المستخدمة للاستيراد.
* ✅ تحديث حالة المهمة.

وبما أن **Media Restore تم اختباره ونجح بالفعل**، فلا حاجة لإعادة اختباره الآن.

بعد نجاح Database Restore، يمكن تنفيذ اختبار أخير يشمل الثلاثة معًا كاختبار تكاملي (Integration Test).

### هل Safety Backup سيُنشأ؟

إذا كان منطق النظام ينشئ Safety Backup عند وجود:

```json
"restoreDatabase": true
```

فسيتم اختباره أيضًا في هذا السيناريو، دون الحاجة إلى تشغيل استعادة الوسائط أو الإعدادات.

لذلك أوصي بالترتيب التالي:

1. ✅ Media Restore (اكتمل).
2. ⏳ Database Restore فقط.
3. ⏳ Configuration Restore فقط (إذا كانت مستخدمة فعلًا في مشروعك).
4. ⏳ Full Restore (Database + Media + Configuration) كاختبار نهائي قبل اعتماد الميزة.

بهذه الطريقة، إذا ظهر أي خلل، ستعرف بالضبط أي مكون يحتاج إلى إصلاح، ولن تضطر إلى تتبع ثلاثة مسارات تنفيذ في وقت واحد.
