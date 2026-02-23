# 🏫 Manager APIs — إدارة المدرسة

> جميع الـ APIs في هذا القسم **تتطلب دور ADMIN** وتخضع لثلاث طبقات حماية:
> - `SchoolJwtAuthGuard` — التحقق من JWT
> - `SchoolContextGuard` — التحقق من `x-school-uuid`
> - `RolesGuard` + `@Roles('ADMIN')` — التحقق من الدور

**Base Path:** `/school/manager/`

---

## 📑 الفهرس

1. [بيانات المدرسة](#1-بيانات-المدرسة-school-info)
2. [الصفوف والشُعب](#2-الصفوف-والشعب-grades--sections)
3. [السنوات والفصول](#3-السنوات-والفصول-academic-years--terms)
4. [الطلاب](#4-الطلاب-students)
5. [أولياء الأمور](#5-أولياء-الأمور-parents)
6. [المعلمين](#6-المعلمين-teachers)
7. [المواد والإسناد](#7-المواد-والإسناد-subjects)
8. [حالة التهيئة](#8-حالة-التهيئة-setup-status)
9. [Prisma Schema](#9-prisma-schema)

---

## 1. بيانات المدرسة (School Info)

### `GET /school/manager/school-info`
عرض بيانات المدرسة.

**Response:** `200 OK`
```json
{
  "uuid": "abc-123",
  "name": "مدرسة الأساس",
  "displayName": "مدرسة الأساس النموذجية",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "phone": "0771234567",
  "email": "info@asas.edu",
  "deliveryPolicy": "OPEN"
}
```

### `PATCH /school/manager/school-info`
تعديل بيانات المدرسة.

**Body:**
```json
{
  "displayName": "الاسم الجديد",
  "phone": "0779999999",
  "email": "new@email.com",
  "province": "بغداد",
  "address": "شارع فلسطين"
}
```
**حقول قابلة للتعديل:** `displayName`, `phone`, `email`, `province`, `district`, `addressArea`, `address`, `logoMediaAssetId`

---

## 2. الصفوف والشُعب (Grades & Sections)

### `GET /school/manager/grades/dictionary`
عرض القاموس الرسمي للصفوف لاختيار صفوف جاهزة.

### `GET /school/manager/grades`
قائمة صفوف المدرسة مع عدد الشُعب.

### `POST /school/manager/grades`
إنشاء صف جديد (يُنشئ شعبة افتراضية "أ" تلقائياً).

```json
{
  "dictionaryId": 5,
  "displayName": "الصف الأول (اختياري)",
  "sortOrder": 1
}
```

### `POST /school/manager/grades/bulk`
إنشاء عدة صفوف دفعة واحدة.
```json
{
  "grades": [
    { "dictionaryId": 5, "sortOrder": 1 },
    { "displayName": "تمهيدي", "sortOrder": 0 }
  ]
}
```
إنشاء صف جديد (يُنشئ شعبة افتراضية "أ" تلقائياً).

```json
{
  "displayName": "الصف الأول",
  "sortOrder": 1,
  "dictionaryId": 5
}
```

### `PATCH /school/manager/grades/:gradeId`
تعديل صف.

### `DELETE /school/manager/grades/:gradeId`
حذف صف — **يفشل إذا كانت هناك شُعب تحتوي على طلاب** (`GRADE_HAS_STUDENTS`).

### `GET /school/manager/grades/:gradeId/sections`
قائمة شُعب الصف.

### `POST /school/manager/grades/:gradeId/sections`
إنشاء شعبة في الصف.

```json
{ "name": "ب", "orderIndex": 2 }
```

### `DELETE /school/manager/grades/sections/:sectionId`
حذف شعبة — **يفشل إذا كانت تحتوي على طلاب** (`SECTION_HAS_STUDENTS`).

---

## 3. السنوات والفصول (Academic Years & Terms)

### `GET /school/manager/academic-years`
قائمة السنوات الدراسية مع فصولها.

### `POST /school/manager/academic-years`
إنشاء سنة دراسية جديدة (تصبح الحالية تلقائياً وتنشئ فصولاً).

```json
{
  "name": "2025-2026",
  "startDate": "2025-09-01",
  "endDate": "2026-06-30",
  "termsCount": 2
}
```
أو مع تخصيص الفصول:
```json
{
  "name": "2025-2026",
  "terms": [
    { "name": "الفصل الأول", "orderIndex": 1, "startDate": "2025-09-01" },
    { "name": "الفصل الثاني", "orderIndex": 2, "startDate": "2026-01-15" }
  ]
}
```

### `GET /school/manager/academic-years/current`
السنة الحالية مع فصولها.

### `POST /school/manager/academic-years/:yearId/advance-term`
التقدم للفصل التالي. يفشل إذا كان الفصل الحالي هو الأخير (`NO_NEXT_TERM`).

### `PATCH /school/manager/academic-years/terms/:termId`
تعديل بيانات فصل (اسم، تواريخ).

---

## 4. الطلاب (Students)

### `GET /school/manager/students`
قائمة الطلاب مع فلترة.

**Query params:** `gradeId`, `sectionId`, `yearId`, `q` (بحث بالاسم أو الكود).

### `POST /school/manager/students`
إنشاء طالب جديد.

```json
{
  "name": "أحمد محمد",
  "gender": "MALE",
  "gradeId": 1,
  "sectionId": 1,
  "password": "123456"
}
```

**Response:** يُرجع بيانات الدخول (code + password + schoolCode).
```json
{
  "uuid": "abc-123",
  "name": "أحمد محمد",
  "code": 15,
  "password": "123456",
  "schoolCode": 1001
}
```

> ⚠️ **ملاحظة:** إذا لم تُحدد كلمة مرور، يُولّد واحدة عشوائياً.

### `GET /school/manager/students/:uuid`
ملف الطالب الكامل (بيانات + قيد + أولياء أمور).

### `PATCH /school/manager/students/:uuid`
تعديل بيانات الطالب.

### `POST /school/manager/students/:uuid/transfer`
نقل الطالب لصف/شعبة أخرى.
```json
{ "gradeId": 2, "sectionId": 3 }
```

### `PATCH /school/manager/students/:uuid/toggle-active`
تفعيل/تعطيل الطالب.
```json
{ "isActive": false }
```

### `POST /school/manager/students/:uuid/reset-password`
إعادة تعيين كلمة المرور. يُرجع كلمة المرور الجديدة.

---

## 5. أولياء الأمور (Parents)

### `GET /school/manager/parents`
قائمة أولياء الأمور. Query: `q` (بحث بالاسم أو الهاتف).

### `POST /school/manager/parents`
إنشاء ولي أمر. إذا كان الهاتف موجوداً مسبقاً، يُرجع بيانات الموجود.

```json
{
  "name": "محمد علي",
  "phone": "0771234567"
}
```

### `GET /school/manager/parents/:uuid`
ملف ولي الأمر مع أبنائه.

### `PATCH /school/manager/parents/:uuid`
تعديل بيانات ولي الأمر.

### `POST /school/manager/parents/:uuid/link-children`
ربط أبناء بولي الأمر.
```json
{ "studentUserIds": [10, 15, 20] }
```

### `DELETE /school/manager/parents/:uuid/children/:studentId`
فك ربط ابن من ولي الأمر.

---

## 6. المعلمين (Teachers)

### `GET /school/manager/teachers`
قائمة المعلمين. Query: `q`.

### `POST /school/manager/teachers`
إنشاء معلم.
```json
{
  "name": "خالد أحمد",
  "phone": "0771234567",
  "specialization": "رياضيات"
}
```

### `GET /school/manager/teachers/:uuid`
ملف المعلم (بيانات + نطاقات إشراف + صلاحيات + مواد مُسندة).

### `POST /school/manager/teachers/:uuid/supervisor`
تعيين/إلغاء كمشرف.
```json
{ "isSupervisor": true }
```

### `POST /school/manager/teachers/:uuid/extra-permissions`
تعيين صلاحيات إضافية.
```json
{
  "canManageSubjects": true,
  "canManageTimetable": false,
  "canViewReports": true
}
```

### `POST /school/manager/teachers/:uuid/scopes`
إضافة نطاق إشراف (صف + شعبة اختيارية).
```json
{ "gradeId": 1, "sectionId": 2 }
```

### `DELETE /school/manager/teachers/scopes/:scopeId`
حذف نطاق إشراف.

---

## 7. المواد والإسناد (Subjects)

### `GET /school/manager/subjects`
قائمة المواد مع الشُعب والمعلمين. Query: `gradeId`.

### `POST /school/manager/subjects`
إنشاء مادة (تُسند تلقائياً لجميع شُعب الصف).
```json
{
  "displayName": "الرياضيات",
  "gradeId": 1
}
```

### `PATCH /school/manager/subjects/:subjectId`
تعديل مادة.

### `DELETE /school/manager/subjects/:subjectId`
حذف مادة (soft delete).

### `POST /school/manager/subjects/:subjectId/sections`
إسناد المادة لشُعب إضافية.
```json
{ "sectionIds": [3, 5] }
```

### `DELETE /school/manager/subjects/:subjectId/sections/:sectionId`
إزالة المادة من شعبة.

### `POST /school/manager/subjects/subject-sections/:ssId/teachers`
إسناد معلم لمادة في شعبة.
```json
{ "teacherUserId": 42, "role": "PRIMARY" }
```
الأدوار المتاحة: `PRIMARY`, `ASSISTANT`.

### `DELETE /school/manager/subjects/subject-sections/:ssId/teachers/:teacherId`
إزالة معلم من مادة.

---

## 8. حالة التهيئة (Setup Status)

Endpoint واحد يُرجع ملخص جاهزية المدرسة — يستخدمه Flutter كـ **Gatekeeper** قبل دخول الـ Dashboard.

### `GET /school/manager/setup/status`

**Response:** `200 OK`
```json
{
  "hasCurrentYear": true,
  "isFullyReady": false
}
```

### `POST /school/manager/setup/academic-initialization`
Endpoint لتهيئة المدرسة لأول مرة (ADM-006). يقوم بإنشاء الصفوف والشعب والسنة والفصول في **Transaction واحدة**.
يُستخدم في الـ Wizard. يفشل (`ACADEMIC_ALREADY_INITIALIZED`) إذا كانت السنة موجودة مسبقاً.

**Body:**
```json
{
  "grades": [
    { "dictionaryId": 5, "sortOrder": 1 },
    { "displayName": "التمهيدي", "sortOrder": 0 }
  ],
  "year": {
    "name": "2025-2026",
    "startDate": "2025-09-01",
    "endDate": "2026-06-30",
    "terms": [
      { "name": "الفصل الأول", "orderIndex": 1 },
      { "name": "الفصل الثاني", "orderIndex": 2 }
    ]
  }
}
```

**حقول الجاهزية:**

| الحقل | القاعدة |
|-------|--------|
| `isAcademicReady` | سنة حالية + فصول + صفوف + شُعب |
| `isReadyForStudents` | = `isAcademicReady` |
| `isFullyReady` | أكاديمي + مواد + معلمين |

**الاستخدام في Flutter:**
```dart
final status = await repo.getSetupStatus();
if (!status.isFullyReady) {
   navigateToSetupWizard();
} else {
   navigateToDashboard();
}
```

---

## 9. Prisma Schema

الموديلات المضافة في هذه المرحلة:

| Model | الجدول | الوصف |
|-------|--------|-------|
| `Year` | `years` | السنوات الدراسية |
| `Term` | `terms` | الفصول الدراسية |
| `SchoolGrade` | `school_grades` | صفوف المدرسة |
| `Section` | `sections` | الشُعب |
| `Student` | `students` | بيانات الطالب (1:1 مع User) |
| `Parent` | `parents` | بيانات ولي الأمر (1:1 مع User) |
| `Teacher` | `teachers` | بيانات المعلم (1:1 مع User) |
| `StudentEnrollment` | `student_enrollments` | قيد الطالب (student + year + grade + section) |
| `ParentStudent` | `parent_students` | ربط ولي أمر بطالب |
| `TeacherScope` | `teacher_scopes` | نطاق إشراف المعلم |
| `TeacherExtraPermission` | `teacher_extra_permissions` | صلاحيات إضافية (1:1) |
| `SubjectDictionary` | `subject_dictionary` | قاموس المواد الرسمي |
| `Subject` | `subjects` | مواد المدرسة |
| `SubjectSection` | `subject_sections` | المادة داخل الشعبة |
| `SubjectSectionTeacher` | `subject_section_teachers` | إسناد المعلم |

**Enums المضافة:** `EnrollmentStatus`, `ScopeType`, `SubjectSectionRole`

---

## ملاحظات التصميم

- **Auto Code Generation:** عند إنشاء طالب أو معلم، يُولّد كود فريد تلقائياً من `School.nextUserCode`.
- **Default Section:** عند إنشاء صف جديد، تُنشأ شعبة افتراضية "أ".
- **Subject Auto-Assign:** عند إنشاء مادة، تُسند تلقائياً لجميع شُعب الصف.
- **Soft Delete:** جميع عمليات الحذف تستخدم `isDeleted: true` بدون حذف فعلي.
- **Constraint Safety:** لا يمكن حذف صف/شعبة تحتوي على طلاب.
- **Transaction Safety:** كل عملية تعدّل أكثر من سجل محمية بـ `$transaction` (createYear, advanceToNextTerm, createGrade).
- **Error Handling:** أخطاء unique constraint تُحوّل لـ `409 Conflict` بدل `500`.
