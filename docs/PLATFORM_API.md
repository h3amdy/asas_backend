# 🏢 Platform API — منصة المحتوى التعليمي

> جميع الـ endpoints تحت `/api/v1`. المنصة تملك JWT خاص ومستقل عن المالك والمدارس.
>
> **الحماية:** `POST /auth/platform/login` عام. بقية الـ endpoints محمية بـ `PlatformJwtAuthGuard`.
> endpoints إدارة المعلمين محمية أيضاً بـ `PlatformAdminGuard`.

---

## 📑 الفهرس

1. [المصادقة](#-المصادقة)
2. [إدارة المعلمين](#-إدارة-المعلمين)
3. [المواد والإسناد](#-المواد-والإسناد)
4. [الملف الشخصي](#-الملف-الشخصي)

---

## 🔐 المصادقة

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `POST` | `/auth/platform/login` | تسجيل الدخول | ❌ |

---

### `POST /auth/platform/login`

يدعم تسجيل الدخول بالبريد الإلكتروني **أو** اسم المستخدم.

**Request Body:**
```json
{
  "login": "admin@asas.com",
  "password": "password123"
}
```

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `login` | `string` | ✅ | البريد الإلكتروني أو اسم المستخدم |
| `password` | `string` | ✅ | كلمة المرور (6 أحرف على الأقل) |

**Response:** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "uuid": "platform-user-uuid",
    "name": "مدير المنصة",
    "email": "admin@asas.com",
    "username": "admin@asas.com",
    "role": "PLATFORM_ADMIN"
  }
}
```

> **JWT Payload:**
> ```json
> { "sub": "<uuid>", "role": "PLATFORM_ADMIN", "iat": ..., "exp": ... }
> ```
> - `issuer`: `asas-backend`
> - `audience`: `asas-platform`
> - `TTL`: 24 ساعة

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `401` | اسم المستخدم/البريد أو كلمة المرور غير صحيحة |
| `401` | الحساب موقوف — تواصل مع مدير المنصة |

> يبحث عن مستخدم `isDeleted = false` ثم يتحقق من `isActive = true`.

---

## 👥 إدارة المعلمين

> جميع endpoints هذا القسم محمية بـ `PlatformJwtAuthGuard` + `PlatformAdminGuard`.

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/platform/users` | قائمة المعلمين |
| `GET` | `/platform/users/:uuid` | تفاصيل معلم |
| `POST` | `/platform/users` | إضافة معلم |
| `PATCH` | `/platform/users/:uuid` | تعديل بيانات |
| `PATCH` | `/platform/users/:uuid/status` | تفعيل/تعطيل |
| `POST` | `/platform/users/:uuid/reset-password` | إعادة تعيين كلمة مرور |

---

### `GET /platform/users`

قائمة جميع معلمي المنصة (`isDeleted = false`)، مرتبة بـ `createdAt DESC`.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK` — مصفوفة:
```json
[
  {
    "uuid": "teacher-uuid",
    "username": "ahmed_math",
    "email": "ahmed@asas.com",
    "name": "أحمد محمد",
    "displayName": null,
    "phone": "777123456",
    "role": "PLATFORM_TEACHER",
    "isActive": true,
    "createdAt": "2026-04-27T...",
    "updatedAt": "2026-04-27T...",
    "assignedSubjects": [
      {
        "uuid": "assignment-uuid",
        "subjectDictionary": {
          "uuid": "subject-uuid",
          "defaultName": "الرياضيات",
          "code": "MATH-G01",
          "gradeDictionary": {
            "uuid": "grade-uuid",
            "defaultName": "الأول الأساسي",
            "code": "G01"
          }
        }
      }
    ]
  }
]
```

---

### `GET /platform/users/:uuid`

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK` — نفس هيكل العنصر الواحد من القائمة أعلاه.

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | المستخدم غير موجود |

---

### `POST /platform/users` — إضافة معلم

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | `string` | ✅ | الاسم الكامل |
| `username` | `string` | ✅ | اسم المستخدم (فريد) |
| `email` | `string` | ❌ | البريد الإلكتروني (فريد إذا أُرسل) |
| `password` | `string` | ✅ | كلمة المرور (6 أحرف على الأقل) |
| `phone` | `string` | ❌ | رقم الهاتف |

**Request Example:**
```json
{
  "name": "أحمد محمد علي",
  "username": "ahmed_math",
  "email": "ahmed@asas.com",
  "password": "securePass123",
  "phone": "777123456"
}
```

**Response:** `201 Created`
```json
{
  "uuid": "new-teacher-uuid",
  "username": "ahmed_math",
  "email": "ahmed@asas.com",
  "name": "أحمد محمد علي",
  "displayName": null,
  "phone": "777123456",
  "role": "PLATFORM_TEACHER",
  "isActive": true,
  "createdAt": "2026-04-27T...",
  "updatedAt": "2026-04-27T..."
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `409` | اسم المستخدم مستخدم بالفعل |
| `409` | البريد الإلكتروني مستخدم بالفعل |

> الدور الافتراضي: `PLATFORM_TEACHER`. كلمة المرور تُشفّر بـ `bcrypt`.

---

### `PATCH /platform/users/:uuid` — تعديل بيانات

**Headers:** `Authorization: Bearer <token>`

**Request Body:** (جميع الحقول اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `name` | `string` | الاسم |
| `email` | `string` | البريد الإلكتروني |
| `phone` | `string` | رقم الهاتف |

> ⚠️ `username` ثابت بعد الإنشاء ولا يُعدّل.

**Response:** `200 OK` — بيانات المستخدم بعد التعديل.

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | المستخدم غير موجود |
| `409` | البريد الإلكتروني مستخدم بالفعل |

---

### `PATCH /platform/users/:uuid/status` — تفعيل/تعطيل

**Headers:** `Authorization: Bearer <token>`

```json
{ "isActive": false }
```

**Response:** `200 OK` — بيانات المستخدم بعد التعديل.

> عند التعطيل (`isActive: false`):
> - ❌ لا يمكن للمستخدم تسجيل الدخول
> - ✅ تبقى جميع البيانات والمحتوى محفوظة

---

### `POST /platform/users/:uuid/reset-password`

**Headers:** `Authorization: Bearer <token>`

**Request Body:** (اختياري)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `newPassword` | `string` | ❌ | كلمة المرور الجديدة (6 أحرف على الأقل). إذا لم تُرسل تُولّد كلمة عشوائية |

**Response:** `200 OK`
```json
{
  "uuid": "teacher-uuid",
  "name": "أحمد محمد",
  "username": "ahmed_math",
  "message": "تم إعادة تعيين كلمة المرور بنجاح"
}
```

> ⚠️ إذا أُرسلت `newPassword` أقل من 6 أحرف، سيتم تجاهلها وتوليد كلمة عشوائية بدلاً.

---

## 📚 المواد والإسناد

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/platform/subjects` | المواد المتاحة | ✅ `PlatformAuth` |
| `POST` | `/platform/users/:uuid/subjects` | إسناد مواد | ✅ `PlatformAdmin` |
| `DELETE` | `/platform/users/:uuid/subjects/:subjectUuid` | إلغاء إسناد | ✅ `PlatformAdmin` |

---

### `GET /platform/subjects`

قائمة المواد الرسمية النشطة مرتبة حسب الصف ثم ترتيب المادة.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
[
  {
    "uuid": "subject-uuid",
    "code": "MATH-G01",
    "defaultName": "الرياضيات",
    "shortName": "رياضيات",
    "sortOrder": 1,
    "gradeDictionary": {
      "uuid": "grade-uuid",
      "code": "G01",
      "defaultName": "الأول الأساسي",
      "stage": "أساسي",
      "sortOrder": 1
    }
  }
]
```

---

### `POST /platform/users/:uuid/subjects` — إسناد مواد

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "subjectUuids": ["subject-uuid-1", "subject-uuid-2"]
}
```

**Response:** `200 OK`
```json
{
  "userUuid": "teacher-uuid",
  "results": [
    { "subject": "الرياضيات", "status": "assigned" },
    { "subject": "العلوم", "status": "already_assigned" }
  ]
}
```

> **الحالات الممكنة:**
> - `assigned` — تم الإسناد
> - `already_assigned` — الإسناد موجود مسبقاً
> - `reactivated` — إعادة تفعيل إسناد محذوف سابقاً

---

### `DELETE /platform/users/:uuid/subjects/:subjectUuid` — إلغاء إسناد

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{ "message": "تم إلغاء الإسناد بنجاح" }
```

> يُنفّذ كـ **Soft Delete** — يمكن إعادة الإسناد لاحقاً.

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | المستخدم غير موجود |
| `404` | المادة غير موجودة |
| `404` | الإسناد غير موجود |

---

## 👤 الملف الشخصي

> متاح لجميع مستخدمي المنصة (Admin + Teacher). يعتمد على JWT لتحديد المستخدم.

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/platform/profile` | جلب الملف الشخصي | ✅ `PlatformAuth` |
| `PATCH` | `/platform/profile` | تعديل البيانات | ✅ `PlatformAuth` |
| `PATCH` | `/platform/profile/password` | تغيير كلمة المرور | ✅ `PlatformAuth` |

---

### `GET /platform/profile`

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "uuid": "user-uuid",
  "username": "ahmed_math",
  "email": "ahmed@asas.com",
  "name": "أحمد محمد",
  "displayName": null,
  "phone": "777123456",
  "role": "PLATFORM_TEACHER",
  "isActive": true,
  "assignedSubjects": [
    {
      "uuid": "assignment-uuid",
      "subjectDictionary": {
        "uuid": "subject-uuid",
        "defaultName": "الرياضيات",
        "code": "MATH-G01",
        "gradeDictionary": {
          "uuid": "grade-uuid",
          "defaultName": "الأول الأساسي"
        }
      }
    }
  ]
}
```

---

### `PATCH /platform/profile`

**Headers:** `Authorization: Bearer <token>`

**Request Body:** (جميع الحقول اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `name` | `string` | الاسم |
| `phone` | `string` | رقم الهاتف |

**Response:** `200 OK` — بيانات الملف الشخصي بعد التعديل.

---

### `PATCH /platform/profile/password`

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "oldPassword": "currentPass",
  "newPassword": "newSecurePass"
}
```

**Response:** `200 OK`
```json
{ "message": "تم تحديث كلمة المرور بنجاح" }
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `401` | كلمة المرور الحالية غير صحيحة |
| `404` | المستخدم غير موجود |
