بعد مراجعة التحليل بالكامل، أرى أنه ناضج جدًا، لكن لدي تعديل واحد مهم على القرار المعماري.

## أولاً: أتفق مع 100% من التحليل التقني

تشخيص الـ Bug صحيح:

* `processImage()` يحول الصورة إلى WebP.
* يحذف `original.jpg`.
* لا يحدث `storageKey`.
* لا يحدث `contentType`.
* لا يحدث `preferredVariant`.
* وبالتالي تصبح قاعدة البيانات تشير إلى ملف غير موجود.

هذا Bug يجب إصلاحه.

وأتفق أيضًا على ضرورة وجود Migration لإصلاح البيانات التاريخية.

---

# النقطة الوحيدة التي أعدلها

كتبت:

> Backup يجب أن يقرأ variants_json دائماً لأن الـ variants هي ملفات حقيقية على القرص.

وهنا أقول: **نعم، ولكن ليس لأنه بديل عن `storage_key`، بل لأنه يمثل ملفات إضافية يجب حفظها.**

وهذا فرق مهم جدًا.

---

## الطريقة الصحيحة

النسخ الاحتياطي لا ينبغي أن يفعل:

```text
إذا وجد variants_json
    استخدمه
وإلا
    استخدم storage_key
```

ولا:

```text
إذا وجد variants_json
    تجاهل storage_key
```

بل يجب أن يبني مجموعة الملفات المراد نسخها هكذا:

```text
FilesToBackup = Set()

1. أضف storage_key
2. أضف original من variants_json
3. أضف medium
4. أضف small
5. أضف low
6. أضف أي variants مستقبلية
```

أي أن `storage_key` و `variants_json` **مكملان لبعضهما** وليس أحدهما بديلاً عن الآخر.

وهذا يجعل النظام قابلاً للتوسع إذا أضفت مستقبلاً:

* thumbnail
* preview
* high
* waveform
* transcript

دون تعديل فلسفة Backup.

---

# أفضل من ذلك

أقترح استخراج هذه المسؤولية من `pg-dump.engine.ts` نهائيًا.

بدلاً من وجود منطق مثل:

```ts
extractStorageKeys(...)
```

أنشئ خدمة مستقلة مثلاً:

```ts
MediaAssetFileResolver
```

مثال:

```ts
class MediaAssetFileResolver {
    resolve(asset: MediaAsset): string[] {
        ...
    }
}
```

وتكون مسؤولة عن:

* قراءة `storageKey`.
* قراءة `variantsJson`.
* إزالة التكرار.
* تجاهل القيم الفارغة.
* التحقق من صحة JSON.

ثم يستخدمها:

* Backup.
* Restore.
* Garbage Collector.
* Media Audit.
* Export.

وبذلك يصبح لديك مصدر واحد للحقيقة (Single Source of Truth) لمسارات ملفات الوسائط.

---

# الإصلاح في MediaProcessingService

أضيف أيضاً:

```ts
await prisma.mediaAsset.update({
    data: {
        storageKey: processedOriginal.storage_key,
        contentType: processedOriginal.content_type,
        preferredVariant: 'original',
        variantsJson: JSON.stringify(variants),
        ...
    }
});
```

وأعتبر هذا إصلاحًا إلزاميًا.

---

# Migration

أوافق على تنفيذ Migration، لكن اجعلها آمنة:

```
لكل MediaAsset:

إذا كان storage_key موجودًا على القرص
    لا تغيّر شيئًا.

إذا لم يكن موجودًا
    اقرأ variants_json.

إذا كان original.storage_key موجودًا
    حدّث storage_key و content_type و preferred_variant.

إذا لم يوجد أي ملف
    سجّل Warning فقط.
```

لا تعتمد على الامتداد وحده (`.jpg → .webp`) لأن بعض الملفات قد تكون في حالة مختلفة.

---

# تقييمي النهائي

أقيّم التصميم المقترح بالشكل التالي:

| العنصر                                        |              التقييم |
| --------------------------------------------- | -------------------: |
| اكتشاف السبب الجذري                           |                ⭐⭐⭐⭐⭐ |
| إصلاح MediaProcessingService                  |                ⭐⭐⭐⭐⭐ |
| Migration للبيانات القديمة                    |                ⭐⭐⭐⭐⭐ |
| جعل Backup ينسخ جميع الـ variants             |                ⭐⭐⭐⭐⭐ |
| فصل منطق استخراج ملفات الوسائط في خدمة مستقلة | ⭐⭐⭐⭐⭐ (أوصي به بشدة) |

**الخلاصة:** أوافق على الفكرة الأساسية، لكن أوصي بأن يكون `variants_json` مصدرًا **للملفات الإضافية** وليس بديلًا عن `storage_key`، وأن يتم نقل منطق استخراج مسارات الوسائط إلى خدمة مشتركة (`MediaAssetFileResolver`) تُستخدم في جميع أجزاء النظام. هذا يجعل التصميم أنظف وأكثر قابلية للصيانة والتوسع، خصوصًا مع تطور نظام الوسائط مستقبلاً.
