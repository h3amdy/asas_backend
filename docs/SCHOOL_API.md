# 🏫 School API — مستخدمو المدرسة

> جميع الـ endpoints تبدأ بـ `/api/v1`. للتفاصيل الأكاديمية (الصفوف، السنوات، التهيئة) → [ACADEMIC_SETUP_README.md](./ACADEMIC_SETUP_README.md)

---

## 🚦 البوابات (Gates)

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/status/schools/:uuid` | Boot Gate — حالة المدرسة | ❌ |
| `GET` | `/status/me` | Account Gate — حالة حسابي | ✅ JWT |

### `GET /status/schools/:uuid` (Boot Gate)
```json
// Response 200
{ "school_uuid": "...", "is_active": true, "app_type": "PUBLIC", "display_name": "مدرسة النور", "reason": null }
```
| `reason` | الوصف |
|----------|-------|
| `null` | نشطة |
| `SCHOOL_DISABLED` | موقوفة |

### `GET /status/me` (Account Gate)
```json
{
  "user_uuid": "...", "user_type": "TEACHER", "user_is_active": true,
  "school_uuid": "...", "school_is_active": true, "reason": null
}
```
| `reason` | الوصف |
|----------|-------|
| `SCHOOL_DISABLED` | المدرسة موقوفة |
| `USER_DISABLED` | الحساب موقوف |

---

## 🌍 المدارس العامة (بدون مصادقة)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/public/schools/search?q=...&limit=5` | بحث بالاسم |
| `POST` | `/public/schools/verify-code` | تحقق من كود المدرسة |
| `GET` | `/public/schools/:uuid/profile` | ملف المدرسة الكامل |

### `POST /public/schools/verify-code`
```json
// Request
{ "schoolCode": 1001 }
// Response — بيانات المدرسة الكاملة مع الثيم
```

---

## 🔐 المصادقة (School Auth)

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `POST` | `/school/auth/login` | تسجيل الدخول | ❌ |
| `POST` | `/school/auth/refresh` | تجديد التوكن | ❌ |
| `POST` | `/school/auth/logout` | تسجيل الخروج | ✅ JWT |

### `POST /school/auth/login`

```json
// ADMIN/TEACHER/STUDENT
{ "schoolUuid": "...", "userCode": 1001, "password": "...", "deviceFingerprint": "...", "deviceType": "ANDROID" }

// PARENT
{ "schoolUuid": "...", "phone": "777123456", "password": "...", "deviceFingerprint": "...", "deviceType": "IOS" }
```

**Response:**
```json
{
  "accessToken": "eyJ...", "refreshToken": "...", "sessionId": "...",
  "refreshExpiresAt": "2026-03-07T00:00:00.000Z",
  "user": { "uuid": "...", "userType": "TEACHER", "code": 1001, "displayName": "أحمد" },
  "school": { "uuid": "...", "displayName": "مدرسة النور", "appType": "PUBLIC" }
}
```

| خطأ | HTTP | الوصف |
|-----|------|-------|
| `INVALID_CREDENTIALS` | `401` | كود/هاتف أو كلمة مرور خاطئة |
| `SCHOOL_INACTIVE` | `403` | المدرسة موقوفة |
| `USER_INACTIVE` | `403` | الحساب موقوف |

### `POST /school/auth/refresh`
```json
{ "sessionId": "...", "refreshToken": "...", "deviceFingerprint": "...", "deviceType": "ANDROID" }
```
> 🔐 يدعم تدوير Refresh Token. التوكن القديم يصبح غير صالح بعد التجديد.

### `POST /school/auth/logout`
```json
{ "sessionId": "..." }            // جلسة واحدة
{ "sessionId": "...", "logoutAll": true }  // جميع الجلسات
```

### 🔑 JWT Payload

| الحقل | الوصف |
|-------|-------|
| `sub` | UUID المستخدم |
| `ut` | نوع المستخدم (`ADMIN`/`TEACHER`/`STUDENT`/`PARENT`) |
| `sc` | UUID المدرسة |
| `sid` | UUID الجلسة |
| `uc` | كود المستخدم (اختياري) |

---

## 👤 الملف الشخصي

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/school/profile/me` | جلب بياناتي |
| `PATCH` | `/school/profile/me` | تعديل بياناتي |
| `POST` | `/school/profile/change-password` | تغيير كلمة المرور |

> 📖 تفاصيل: [PROFILE_README.md](./PROFILE_README.md)

---

## 📅 السياق الأكاديمي (جميع الأدوار)

**الحماية:** `JWT + SchoolContext` (بدون تقييد دور)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/school/academic-context` | السنة الحالية + الفصل الحالي |

### `GET /school/academic-context`

**UC-CTX-060** — يُستخدم في الشاشة الرئيسية لعرض مؤشر السنة/الفصل.

**Response:** `200 OK`
```json
{
  "academicYear": {
    "uuid": "year-uuid",
    "name": "2025/2026",
    "startDate": "2025-09-01T00:00:00.000Z",
    "endDate": "2026-06-30T00:00:00.000Z"
  },
  "term": {
    "uuid": "term-uuid",
    "name": "الفصل الأول",
    "orderIndex": 1,
    "startDate": "2025-09-01T00:00:00.000Z",
    "endDate": "2025-12-31T00:00:00.000Z"
  }
}
```

> إذا المدرسة **غير مهيأة** → `{ "academicYear": null, "term": null }`

> 💡 **Flutter:** يمكن حساب "المتبقي حتى نهاية الفصل" محلياً من `term.endDate`.

---

## 🏫 Manager APIs (ADMIN فقط)

**الحماية:** `JWT + SchoolContext + @Roles('ADMIN')`
**Headers:** `Authorization: Bearer <jwt>` + `x-school-uuid: <uuid>`

### ملخص جميع الـ Endpoints

| فئة | Method | Endpoint | الوصف |
|------|--------|----------|-------|
| **بيانات المدرسة** | `GET` | `/school/manager/school-info` | عرض |
| | `PATCH` | `/school/manager/school-info` | تعديل |
| **الصفوف** | `GET` | `/school/manager/grades/dictionary` | القاموس الرسمي |
| | `GET` | `/school/manager/grades` | قائمة صفوف المدرسة |
| | `POST` | `/school/manager/grades` | إنشاء صف |
| | `POST` | `/school/manager/grades/bulk` | إنشاء عدة صفوف (Atomic) |
| | `PATCH` | `/school/manager/grades/:id` | تعديل صف |
| | `DELETE` | `/school/manager/grades/:id` | حذف صف |
| **الشُعب** | `GET` | `/school/manager/grades/:id/sections` | قائمة الشُعب |
| | `POST` | `/school/manager/grades/:id/sections` | إنشاء شعبة |
| | `PATCH` | `/school/manager/grades/sections/:id` | تعديل شعبة |
| | `DELETE` | `/school/manager/grades/sections/:id` | حذف شعبة |
| **السنوات** | `GET` | `/school/manager/academic-years` | قائمة السنوات |
| | `POST` | `/school/manager/academic-years` | إنشاء سنة (+ فصول) |
| | `GET` | `/school/manager/academic-years/current` | السنة الحالية |
| | `PATCH` | `/school/manager/academic-years/:id` | تعديل سنة |
| | `POST` | `/school/manager/academic-years/:id/advance-term` | التقدم للفصل التالي |
| **الفصول** | `PATCH` | `/school/manager/academic-years/terms/:id` | تعديل فصل |
| **الطلاب** | `GET` | `/school/manager/students` | قائمة الطلاب |
| | `POST` | `/school/manager/students` | إنشاء طالب |
| | `GET` | `/school/manager/students/:uuid` | ملف الطالب |
| | `PATCH` | `/school/manager/students/:uuid` | تعديل |
| | `POST` | `/school/manager/students/:uuid/transfer` | نقل |
| | `POST` | `/school/manager/students/:uuid/reset-password` | إعادة كلمة المرور |
| **أولياء الأمور** | `GET` | `/school/manager/parents` | قائمة |
| | `POST` | `/school/manager/parents` | إنشاء |
| | `POST` | `/school/manager/parents/:uuid/link-children` | ربط أبناء |
| **المعلمين** | `GET` | `/school/manager/teachers` | قائمة |
| | `POST` | `/school/manager/teachers` | إنشاء |
| | `POST` | `/school/manager/teachers/:uuid/scopes` | نطاق إشراف |
| **المواد** | `GET` | `/school/manager/subjects` | قائمة |
| | `POST` | `/school/manager/subjects` | إنشاء مادة |
| | `POST` | `/school/manager/subjects/:id/sections` | إسناد لشُعب |
| | `POST` | `/school/manager/subjects/subject-sections/:id/teachers` | إسناد معلم |
| **التهيئة** | `GET` | `/school/manager/setup/status` | حالة التهيئة |
| | `POST` | `/school/manager/setup/academic-initialization` | التهيئة الأولى (Wizard) |

> 📖 **تفاصيل كاملة عن الصفوف والسنوات والتهيئة:** [ACADEMIC_SETUP_README.md](./ACADEMIC_SETUP_README.md)
> 📖 **ملخص Manager:** [MANAGER_README.md](./MANAGER_README.md)

---

## 📋 أكواد الأخطاء الموحدة

| الكود | HTTP | الوصف |
|-------|------|-------|
| `SCHOOL_NOT_FOUND` | `404` | المدرسة غير موجودة |
| `SCHOOL_INACTIVE` | `403` | المدرسة موقوفة |
| `SCHOOL_SCOPE_MISMATCH` | `403` | عدم تطابق المدرسة في Header و JWT |
| `INVALID_CREDENTIALS` | `401` | كود/هاتف أو كلمة مرور خاطئة |
| `USER_NOT_FOUND` | `404` | المستخدم غير موجود |
| `USER_INACTIVE` | `403` | حساب المستخدم موقوف |
| `DEVICE_MISMATCH` | `403` | بصمة الجهاز لا تطابق الجلسة |
| `SESSION_NOT_FOUND` | `404` | الجلسة غير موجودة |
| `SESSION_EXPIRED` | `403` | الجلسة منتهية |
| `SESSION_REVOKED` | `403` | الجلسة ملغية |
| `REFRESH_TOKEN_INVALID` | `403` | Refresh Token غير صالح |
| `NOT_YOUR_SESSION` | `403` | الجلسة لا تخص المستخدم |
| `INVALID_SESSION` | `403` | عدم تطابق بيانات الجلسة |

> للأخطاء الأكاديمية (صفوف، فصول، تهيئة) → [ACADEMIC_SETUP_README.md](./ACADEMIC_SETUP_README.md#8-أكواد-الأخطاء)
