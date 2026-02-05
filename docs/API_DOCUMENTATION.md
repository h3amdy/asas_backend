# 📚 دليل مشروع Asas Backend

## 📋 نظرة عامة

**Asas Backend** هو خادم REST API لإدارة المدارس، مبني باستخدام NestJS مع قاعدة بيانات PostgreSQL وORM Prisma.

---

## 🛠️ التقنيات المستخدمة

| التقنية | الوصف | الإصدار |
|---------|-------|---------|
| **NestJS** | إطار عمل Node.js للخوادم | `^11.0.1` |
| **TypeScript** | لغة البرمجة | `^5.7.3` |
| **Prisma** | ORM لقاعدة البيانات | `^6.0.0` |
| **PostgreSQL** | قاعدة البيانات العلائقية | - |
| **JWT** | للمصادقة والتوكنات | `@nestjs/jwt ^11.0.1` |
| **Passport** | للحماية والـ Guards | `^0.7.0` |
| **bcrypt** | لتشفير كلمات المرور | `^6.0.0` |
| **class-validator** | للتحقق من البيانات | `^0.14.3` |
| **class-transformer** | لتحويل البيانات | `^0.5.1` |

---

## 📁 هيكلية المشروع

```
asas_backend/
├── prisma/                    # ملفات Prisma
│   ├── schema.prisma          # تعريف قاعدة البيانات
│   ├── migrations/            # ملفات الهجرة
│   └── generated/             # ملفات Prisma المُولّدة
│
├── src/                       # الكود المصدري
│   ├── main.ts                # نقطة الدخول الرئيسية
│   ├── app.module.ts          # الوحدة الرئيسية
│   ├── app.controller.ts      # المتحكم الرئيسي
│   ├── app.service.ts         # الخدمة الرئيسية
│   │
│   ├── auth/                  # 🔐 المصادقة
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── jwt.strategy.ts
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts
│   │   └── dto/
│   │       ├── owner-login.dto.ts
│   │       └── change-password.dto.ts
│   │
│   ├── schools/               # 🏫 المدارس
│   │   ├── schools.controller.ts
│   │   ├── schools.service.ts
│   │   ├── schools.module.ts
│   │   ├── schools-sync.controller.ts
│   │   ├── schools-sync.service.ts
│   │   └── dto/
│   │       ├── create-school.dto.ts
│   │       ├── update-school.dto.ts
│   │       ├── update-school-status.dto.ts
│   │       ├── create-school-manager.dto.ts
│   │       └── school-sync.dto.ts
│   │
│   ├── grades/                # 📊 الصفوف الدراسية
│   │   ├── grades.controller.ts
│   │   ├── grades.service.ts
│   │   ├── grades.module.ts
│   │   ├── grades-sync.controller.ts
│   │   ├── grades-sync.service.ts
│   │   └── dto/
│   │       ├── create-grade.dto.ts
│   │       ├── update-grade.dto.ts
│   │       ├── update-grade-status.dto.ts
│   │       └── grade-sync.dto.ts
│   │
│   ├── admins/                # 👨‍💼 مدراء المدارس
│   │   ├── admins.controller.ts
│   │   ├── admins.service.ts
│   │   ├── admins.module.ts
│   │   └── dto/
│   │       ├── create-admin.dto.ts
│   │       ├── update-admin.dto.ts
│   │       └── update-admin-status.dto.ts
│   │
│   ├── owner/                 # 👑 المالك
│   │   ├── owner.controller.ts
│   │   ├── owner.service.ts
│   │   ├── owner.module.ts
│   │   └── dto/
│   │       └── update-owner.dto.ts
│   │
│   ├── prisma/                # 🔗 خدمة Prisma
│   │   └── prisma.service.ts
│   │
│   ├── users/                 # 👥 المستخدمين
│   │   └── ...
│   │
│   └── tools/                 # 🔧 أدوات مساعدة
│       └── ...
│
├── test/                      # الاختبارات
├── dist/                      # الكود المُترجم
└── node_modules/              # المكتبات
```

---

## 🌐 API Endpoints

### 🔐 المصادقة (Auth)

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `POST` | `/auth/owner/login` | تسجيل دخول المالك | ❌ |
| `PATCH` | `/auth/owner/change-password` | تغيير كلمة المرور | ✅ JWT |

#### `POST /auth/owner/login`
**Request Body:**
```json
{
  "email": "owner@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "uuid": "...",
    "name": "...",
    "email": "..."
  }
}
```

---

#### `PATCH /auth/owner/change-password`
**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "oldPassword": "currentPass",
  "newPassword": "newSecurePass"
}
```

---

### 🏫 المدارس (Schools)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/schools` | جلب جميع المدارس |
| `GET` | `/schools/stats` | إحصائيات المدارس |
| `GET` | `/schools/:uuid` | جلب مدرسة بالـ UUID |
| `POST` | `/schools` | إنشاء مدرسة جديدة |
| `PATCH` | `/schools/:uuid` | تحديث بيانات مدرسة |
| `PATCH` | `/schools/:uuid/status` | تغيير حالة المدرسة |
| `DELETE` | `/schools/:uuid` | حذف مدرسة |
| `GET` | `/schools/:uuid/manager` | جلب مدير المدرسة |
| `POST` | `/schools/:uuid/manager` | إنشاء/تحديث مدير المدرسة |
| `POST` | `/schools/:uuid/manager/reset-password` | إعادة تعيين كلمة مرور المدير |

---

#### `GET /schools`

جلب قائمة بجميع المدارس (غير المحذوفة).

**Headers:**
```
Content-Type: application/json
```

**Response:** `200 OK`
```json
[
  {
    "id": 1,
    "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
    "name": "مدرسة النور",
    "schoolCode": 1001,
    "appType": "PUBLIC",
    "phone": "777123456",
    "email": "school@example.com",
    "logoUrl": null,
    "address": "صنعاء",
    "province": "صنعاء",
    "educationType": "أهلي",
    "ownerNotes": "ملاحظات خاصة",
    "primaryColor": "#1976D2",
    "secondaryColor": "#FF5722",
    "backgroundColor": "#FFFFFF",
    "nextUserCode": 5,
    "isActive": true,
    "isDeleted": false,
    "deletedAt": null,
    "createdAt": "2026-01-15T10:30:00.000Z",
    "updatedAt": "2026-02-01T14:00:00.000Z"
  }
]
```

---

#### `GET /schools/stats`

إحصائيات المدارس في النظام.

**Response:** `200 OK`
```json
{
  "totalSchools": 25,
  "activeSchools": 20,
  "inactiveSchools": 5
}
```

---

#### `GET /schools/:uuid`

جلب بيانات مدرسة محددة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Response:** `200 OK`
```json
{
  "id": 1,
  "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "name": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "phone": "777123456",
  "email": "school@example.com",
  "logoUrl": null,
  "address": "صنعاء",
  "province": "صنعاء",
  "educationType": "أهلي",
  "ownerNotes": "ملاحظات خاصة",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FF5722",
  "backgroundColor": "#FFFFFF",
  "isActive": true,
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-02-01T14:00:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |

---

#### `POST /schools`

إنشاء مدرسة جديدة.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | `string` | ✅ | اسم المدرسة |
| `appType` | `enum` | ✅ | نوع التطبيق (`PUBLIC` / `PRIVATE`) |
| `phone` | `string` | ❌ | رقم الهاتف |
| `email` | `string` | ❌ | البريد الإلكتروني |
| `address` | `string` | ❌ | العنوان |
| `province` | `string` | ❌ | المحافظة |
| `educationType` | `string` | ❌ | نوع التعليم (`حكومي` / `أهلي`) |
| `ownerNotes` | `string` | ❌ | ملاحظات خاصة بالمالك |
| `primaryColor` | `string` | ❌ | اللون الأساسي (Hex) |
| `secondaryColor` | `string` | ❌ | اللون الثانوي (Hex) |
| `backgroundColor` | `string` | ❌ | لون الخلفية (Hex) |

**Request Example:**
```json
{
  "name": "مدرسة النور",
  "appType": "PUBLIC",
  "phone": "777123456",
  "email": "school@example.com",
  "address": "صنعاء - شارع الجامعة",
  "province": "صنعاء",
  "educationType": "أهلي",
  "ownerNotes": "ملاحظات خاصة",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FF5722",
  "backgroundColor": "#FFFFFF"
}
```

**Response:** `201 Created`
```json
{
  "id": 26,
  "uuid": "new-school-uuid-1234",
  "name": "مدرسة النور",
  "schoolCode": 1026,
  "appType": "PUBLIC",
  "phone": "777123456",
  "email": "school@example.com",
  "address": "صنعاء - شارع الجامعة",
  "province": "صنعاء",
  "educationType": "أهلي",
  "ownerNotes": "ملاحظات خاصة",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FF5722",
  "backgroundColor": "#FFFFFF",
  "nextUserCode": 1,
  "isActive": true,
  "createdAt": "2026-02-05T15:00:00.000Z",
  "updatedAt": "2026-02-05T15:00:00.000Z"
}
```

> ⚠️ **ملاحظة:** `schoolCode` يُولّد تلقائياً ولا يمكن تعديله.

---

#### `PATCH /schools/:uuid`

تحديث بيانات مدرسة موجودة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Request Body:** (جميع الحقول اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `name` | `string` | اسم المدرسة |
| `appType` | `enum` | نوع التطبيق (`PUBLIC` / `PRIVATE`) |
| `phone` | `string` | رقم الهاتف |
| `email` | `string` | البريد الإلكتروني |
| `address` | `string` | العنوان |
| `province` | `string` | المحافظة |
| `educationType` | `string` | نوع التعليم |
| `ownerNotes` | `string` | ملاحظات خاصة |
| `primaryColor` | `string` | اللون الأساسي |
| `secondaryColor` | `string` | اللون الثانوي |
| `backgroundColor` | `string` | لون الخلفية |

**Request Example:**
```json
{
  "name": "مدرسة النور المتطورة",
  "phone": "778888888"
}
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "name": "مدرسة النور المتطورة",
  "phone": "778888888",
  "updatedAt": "2026-02-05T15:10:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |

---

#### `PATCH /schools/:uuid/status`

تفعيل أو إيقاف مدرسة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `isActive` | `boolean` | ✅ | `true` للتفعيل، `false` للإيقاف |

**Request Example:**
```json
{
  "isActive": false
}
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "name": "مدرسة النور",
  "isActive": false,
  "updatedAt": "2026-02-05T15:15:00.000Z"
}
```

---

#### `DELETE /schools/:uuid`

حذف منطقي (Soft Delete) للمدرسة وجميع مستخدميها.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Response:** `200 OK`
```json
{
  "success": true
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |

> ⚠️ **تحذير:** هذه العملية تحذف المدرسة وجميع المستخدمين المرتبطين بها (حذف منطقي).

---

#### `GET /schools/:uuid/manager`

جلب بيانات مدير المدرسة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Response (إذا وُجد مدير):** `200 OK`
```json
{
  "hasManager": true,
  "schoolName": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "manager": {
    "name": "أحمد محمد",
    "phone": "777123456",
    "code": 1,
    "isActive": true
  }
}
```

**Response (إذا لم يوجد مدير):** `200 OK`
```json
{
  "hasManager": false,
  "schoolName": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |

---

#### `POST /schools/:uuid/manager`

إنشاء أو تحديث مدير المدرسة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | `string` | ✅ | اسم المدير |
| `phone` | `string` | ✅ | رقم الهاتف |
| `password` | `string` | ✅* | كلمة المرور (مطلوبة عند الإنشاء، 6 أحرف على الأقل) |

> *كلمة المرور مطلوبة فقط عند إنشاء مدير جديد. عند التحديث يمكن تجاهلها.

**Request Example (إنشاء):**
```json
{
  "name": "أحمد محمد علي",
  "phone": "777123456",
  "password": "securePass123"
}
```

**Request Example (تحديث):**
```json
{
  "name": "أحمد محمد سعيد",
  "phone": "778888888"
}
```

**Response:** `200 OK`
```json
{
  "schoolName": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "managerCode": 1,
  "managerName": "أحمد محمد علي"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `400` | كلمة المرور مطلوبة عند إنشاء مدير جديد |
| `404` | لم يتم العثور على المدرسة |

---

#### `POST /schools/:uuid/manager/reset-password`

إعادة تعيين كلمة مرور المدير بكلمة عشوائية جديدة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Response:** `200 OK`
```json
{
  "schoolName": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "managerCode": 1,
  "managerName": "أحمد محمد",
  "newPassword": "45678923"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة / لا يوجد مدير معين لهذه المدرسة |

> ⚠️ **تنبيه:** كلمة المرور الجديدة تظهر مرة واحدة فقط. يجب حفظها أو إرسالها للمدير.

---

### 🔄 مزامنة المدارس (Schools Sync)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/schools-sync?since=...&full=true` | سحب التغييرات |
| `POST` | `/schools-sync` | دفع التغييرات |

---

#### `GET /schools-sync`

سحب التغييرات من الخادم للمزامنة.

**Query Parameters:**
| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `since` | `ISO Date` | ❌ | تاريخ آخر مزامنة |
| `full` | `boolean` | ❌ | `true` لجلب جميع البيانات (Full Sync) |

**Request Examples:**
```
GET /schools-sync                          → Full Sync (أول مرة)
GET /schools-sync?full=true                → Full Sync (إجباري)
GET /schools-sync?since=2026-02-01T00:00:00.000Z  → Incremental Sync
```

**Response:** `200 OK`
```json
{
  "serverTime": "2026-02-05T15:30:00.000Z",
  "items": [
    {
      "id": 1,
      "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
      "name": "مدرسة النور",
      "schoolCode": 1001,
      "appType": "PUBLIC",
      "phone": "777123456",
      "email": "school@example.com",
      "address": "صنعاء",
      "province": "صنعاء",
      "educationType": "أهلي",
      "isActive": true,
      "isDeleted": false,
      "createdAt": "2026-01-15T10:30:00.000Z",
      "updatedAt": "2026-02-01T14:00:00.000Z",
      "manager": {
        "name": "أحمد محمد",
        "phone": "777123456",
        "code": 1,
        "isActive": true
      }
    }
  ]
}
```

> 💡 **ملاحظة:** إذا كانت `since` قديمة جداً (أكثر من 90 يوم)، سيتم إرجاع Full Sync تلقائياً.

---

#### `POST /schools-sync`

دفع التغييرات المحلية للخادم.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `changes` | `array` | ✅ | مصفوفة التغييرات |

**بنية كل تغيير:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `uuid` | `string` | ✅ | معرف المدرسة |
| `name` | `string` | ❌ | الاسم الجديد |
| `phone` | `string` | ❌ | الهاتف |
| `email` | `string` | ❌ | البريد |
| `address` | `string` | ❌ | العنوان |
| `province` | `string` | ❌ | المحافظة |
| `educationType` | `string` | ❌ | نوع التعليم |
| `ownerNotes` | `string` | ❌ | ملاحظات المالك |
| `primaryColor` | `string` | ❌ | اللون الأساسي |
| `secondaryColor` | `string` | ❌ | اللون الثانوي |
| `backgroundColor` | `string` | ❌ | لون الخلفية |
| `isActive` | `boolean` | ❌ | الحالة |
| `action` | `enum` | ❌ | `UPSERT` (افتراضي) / `DELETE` |
| `updatedAtDevice` | `ISO Date` | ❌ | تاريخ التحديث على الجهاز |

**Request Example (تحديث):**
```json
{
  "changes": [
    {
      "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
      "name": "مدرسة النور المتميزة",
      "phone": "778888888",
      "action": "UPSERT"
    }
  ]
}
```

**Request Example (حذف):**
```json
{
  "changes": [
    {
      "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
      "action": "DELETE"
    }
  ]
}
```

**Response:** `200 OK`
```json
{
  "serverTime": "2026-02-05T15:35:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `400` | `changes must be a non-empty array` |
| `400` | كل سجل يحتاج `uuid` |
| `400` | إنشاء المدارس الجديدة يجب أن يتم أونلاين عبر `/schools` |

> ⚠️ **ملاحظة مهمة:** لا يمكن إنشاء مدارس جديدة عبر المزامنة. يجب استخدام `POST /schools` بدلاً من ذلك.

---

### 📊 الصفوف الدراسية (Grades)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/grades` | جلب جميع الصفوف |
| `GET` | `/grades/:uuid` | جلب صف بالـ UUID |
| `POST` | `/grades` | إنشاء صف جديد |
| `PATCH` | `/grades/:uuid` | تحديث بيانات صف |
| `PATCH` | `/grades/:uuid/status` | تغيير حالة الصف |
| `DELETE` | `/grades/:uuid` | حذف منطقي للصف |

---

### 🔄 مزامنة الصفوف (Grades Sync)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/grades-sync?since=...&full=true` | سحب التغييرات |
| `POST` | `/grades-sync` | دفع التغييرات |

---

### 👨‍💼 مدراء المدارس (Admins)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/admins` | جلب جميع المدراء |
| `GET` | `/admins/by-school/:uuid` | جلب مدراء مدرسة معينة |
| `POST` | `/admins` | إنشاء مدير جديد |
| `PATCH` | `/admins/:uuid` | تحديث بيانات مدير |
| `PATCH` | `/admins/:uuid/status` | تغيير حالة المدير |

---

#### `GET /admins`

جلب قائمة بجميع مدراء المدارس في النظام.

**Headers:**
```
Content-Type: application/json
```

**Response:** `200 OK`
```json
[
  {
    "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "أحمد محمد",
    "email": "ahmed@school.com",
    "phone": "777123456",
    "isActive": true,
    "school": {
      "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
      "name": "مدرسة النور",
      "schoolCode": 1001,
      "appType": "PUBLIC"
    }
  }
]
```

---

#### `GET /admins/by-school/:uuid`

جلب قائمة مدراء مدرسة محددة.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدرسة (UUID) |

**Response:** `200 OK`
```json
[
  {
    "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "أحمد محمد",
    "email": "ahmed@school.com",
    "phone": "777123456",
    "isActive": true
  }
]
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |

---

#### `POST /admins`

إنشاء مدير مدرسة جديد.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | `string` | ✅ | اسم المدير |
| `email` | `string` | ✅ | البريد الإلكتروني (فريد) |
| `phone` | `string` | ✅ | رقم الهاتف |
| `password` | `string` | ✅ | كلمة المرور (6 أحرف على الأقل) |
| `schoolUuid` | `string` | ✅ | معرف المدرسة (UUID) |

**Request Example:**
```json
{
  "name": "أحمد محمد علي",
  "email": "ahmed@school.com",
  "phone": "777123456",
  "password": "securePass123",
  "schoolUuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890"
}
```

**Response:** `201 Created`
```json
{
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "أحمد محمد علي",
  "email": "ahmed@school.com",
  "phone": "777123456",
  "userType": "ADMIN",
  "school": {
    "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
    "name": "مدرسة النور",
    "schoolCode": 1001
  }
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `400` | البريد مستخدم مسبقاً |
| `404` | لم يتم العثور على المدرسة |

---

#### `PATCH /admins/:uuid`

تحديث بيانات مدير موجود.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدير (UUID) |

**Headers:**
```
Content-Type: application/json
```

**Request Body:** (جميع الحقول اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `name` | `string` | الاسم الجديد |
| `email` | `string` | البريد الإلكتروني الجديد |
| `phone` | `string` | رقم الهاتف الجديد |

**Request Example:**
```json
{
  "name": "أحمد محمد سعيد",
  "phone": "778888888"
}
```

**Response:** `200 OK`
```json
{
  "id": 5,
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "أحمد محمد سعيد",
  "email": "ahmed@school.com",
  "phone": "778888888",
  "userType": "ADMIN",
  "isActive": true,
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-02-05T15:00:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدير |

---

#### `PATCH /admins/:uuid/status`

تفعيل أو إيقاف حساب مدير.

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `uuid` | `string` | معرف المدير (UUID) |

**Headers:**
```
Content-Type: application/json
```

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `isActive` | `boolean` | ✅ | `true` للتفعيل، `false` للإيقاف |

**Request Example:**
```json
{
  "isActive": false
}
```

**Response:** `200 OK`
```json
{
  "id": 5,
  "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "أحمد محمد سعيد",
  "email": "ahmed@school.com",
  "isActive": false,
  "updatedAt": "2026-02-05T15:05:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدير |

---

### 👑 المالك (Owner)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/owner/profile` | جلب بيانات المالك |
| `PATCH` | `/owner/profile` | تحديث بيانات المالك |

---

#### `GET /owner/profile`

جلب بيانات حساب المالك.

**Headers:**
```
Content-Type: application/json
```

**Response:** `200 OK`
```json
{
  "name": "مالك النظام",
  "email": "owner@asas.com",
  "phone": "777000000"
}
```

---

#### `PATCH /owner/profile`

تحديث بيانات حساب المالك.

**Headers:**
```
Content-Type: application/json
```

**Request Body:** (جميع الحقول اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `name` | `string` | الاسم الجديد |
| `email` | `string` | البريد الإلكتروني الجديد |
| `phone` | `string` | رقم الهاتف الجديد |
| `newPassword` | `string` | كلمة المرور الجديدة (6 أحرف على الأقل) |

**Request Example:**
```json
{
  "name": "المالك الجديد",
  "email": "newowner@asas.com",
  "phone": "778000000",
  "newPassword": "newSecurePass123"
}
```

**Response:** `200 OK`
```json
{
  "id": 1,
  "uuid": "owner-uuid-1234-5678-abcd",
  "name": "المالك الجديد",
  "email": "newowner@asas.com",
  "phone": "778000000",
  "userType": "OWNER",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-02-05T15:10:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المالك |

---

## 🗄️ نماذج قاعدة البيانات (Prisma Models)

### أنواع المستخدمين (UserType)
```
OWNER | ADMIN | TEACHER | STUDENT | PARENT
```

### أنواع التطبيق (AppType)
```
PUBLIC | PRIVATE
```

### الجداول الرئيسية:
- **User** - المستخدمون
- **School** - المدارس
- **GradeDictionary** - قاموس الصفوف
- **UserDevice** - أجهزة المستخدمين (FCM)

---

## 🚀 تشغيل المشروع

```bash
# تثبيت المكتبات
npm install

# تشغيل الهجرات
npm run prisma:migrate

# تشغيل في وضع التطوير
npm run start:dev

# تشغيل في الإنتاج
npm run build
npm run start:prod
```

---

## ⚙️ المتغيرات البيئية (.env)

```env
DATABASE_URL="postgresql://user:password@localhost:5432/asas_db"
JWT_SECRET="your-secret-key"
PORT=3000
```

---

## 🔒 الحماية

- **JWT Guard**: يحمي الـ endpoints التي تحتاج مصادقة
- **ValidationPipe**: يتحقق من صحة البيانات الواردة
- **bcrypt**: لتشفير كلمات المرور
- **CORS**: مفعّل للسماح بالوصول من تطبيق Flutter

---

## 📝 ملاحظات

- جميع الحذف في النظام **حذف منطقي** (Soft Delete) باستخدام `isDeleted` و `deletedAt`
- كل جدول يحتوي على `uuid` فريد للاستخدام في الـ API
- يتم تتبع التغييرات باستخدام `createdAt` و `updatedAt`
