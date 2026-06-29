الان هل هل اقوم بتنفيذ الخطة 
لكي اتخلص من الازعاج المتكرر
الخطة التي تكلم عليه gemini
وما هي الخطوات التي افعلها سواء على المحلية او على ال vps
Edited distribute_wizard_view.dart
Edited distribute_wizard_view.dart
Viewed schema.prisma:880-1230

إليك قائمة بالسطور السبعة (7) التي تحتاج إلى تغيير في ملف [schema.prisma](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma) لحل هذه المشكلة نهائياً.

الفكرة هي تغيير كلمة `@@unique` إلى `@@index` لكي تفهم أداة Prisma أن هذه فهارس عادية للبحث والتسريع، وليست قيود فريدة كاملة (Unique Constraints)، وبذلك سيعتمد التطبيق بالكامل على الفهارس الجزئية الذكية (Partial Unique Indexes) التي قمت بإنشائها يدوياً في قاعدة البيانات والتي تتجاوز العناصر المحذوفة ناعماً.

---

### 📋 قائمة السطور المطلوب تعديلها:

| اسم الجدول في Prisma | رقم السطر | الكود الحالي (المطلوب تغييره) | الكود المقترح الجديد |
| :--- | :--- | :--- | :--- |
| **`Unit`** | [899](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L899) | `@@unique([subjectId, orderIndex], map: "units_subject_order_idx")` | `@@index([subjectId, orderIndex], map: "units_subject_order_idx")` |
| **`Unit`** | [900](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L900) | `@@unique([subjectDictionaryId, orderIndex], map: "units_subject_dict_order_idx")` | `@@index([subjectDictionaryId, orderIndex], map: "units_subject_dict_order_idx")` |
| **`LessonTemplate`** | [957](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L957) | `@@unique([unitId, orderIndex], map: "lesson_templates_unit_order_idx")` | `@@index([unitId, orderIndex], map: "lesson_templates_unit_order_idx")` |
| **`LessonContent`** | [991](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L991) | `@@unique([templateId, orderIndex], map: "lesson_contents_template_order_idx")` | `@@index([templateId, orderIndex], map: "lesson_contents_template_order_idx")` |
| **`Question`** | [1096](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L1096) | `@@unique([templateId, orderIndex], map: "questions_template_order_idx")` | `@@index([templateId, orderIndex], map: "questions_template_order_idx")` |
| **`QuestionOrderingItem`** | [1194](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L1194) | `@@unique([questionId, orderIndex], map: "ordering_items_order_idx")` | `@@index([questionId, orderIndex], map: "ordering_items_order_idx")` |
| **`QuestionFillBlank`** | [1219](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma#L1219) | `@@unique([questionId, orderIndex], map: "fill_blanks_question_order_idx")` | `@@index([questionId, orderIndex], map: "fill_blanks_question_order_idx")` |

---

### 💡 ماذا سيحدث لو عدلناها؟
عندما تُشغّل `npx prisma migrate dev` لاحقاً:
1. ستلاحظ Prisma أن بنية الملف [schema.prisma](file:///Users/hamdy/development/Projects/asas_backend/prisma/schema.prisma) تطابقت تماماً مع قاعدة البيانات (لأن وجود الفهرس الجزئي في قاعدة البيانات كافٍ لإرضاء شرط الـ `@@index` في Prisma).
2. لن يُطلب منك إنشاء أي هجرات إضافية لحذف أو إضافة هذه الفهارس مستقبلاً، وستصبح عمليات الـ Migration نظيفة تماماً ومخصصة فقط للميزات الجديدة التي تضيفها.

تفضّل بتقرير ما ترغب في فعله؛ وإذا أردت مني القيام بهذا التعديل تلقائياً على الملف، فقط أعطني الضوء الأخضر! 🟢