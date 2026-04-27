# 👑 Owner API — لوحة المالك

> جميع الـ endpoints تحت `/api/v1`. المالك يملك JWT خاص ومستقل عن مدارسه.
>
> **الحماية:** `POST /auth/owner/login` عام. `PATCH /auth/owner/change-password` محمي بـ `OwnerJwtAuthGuard`.

> [!WARNING]
> **ملاحظة أمنية:** بقية الـ endpoints (المدارس، الصفوف، الملف الشخصي) **غير محمية حالياً بـ Guard**.
> هذا موثق كبند في خطة تأمين منصة المالك.

---

## 📑 الفهرس

1. [المصادقة](#-المصادقة)
2. [الملف الشخصي](#-الملف-الشخصي)
3. [المدارس](#-المدارس)
4. [مزامنة المدارس](#-مزامنة-المدارس)
5. [الصفوف الرسمية](#-الصفوف-الرسمية-gradedictionary)
6. [مزامنة الصفوف](#-مزامنة-الصفوف)

---

## 🔐 المصادقة

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `POST` | `/auth/owner/login` | تسجيل الدخول | ❌ |
| `PATCH` | `/auth/owner/change-password` | تغيير كلمة المرور | ✅ `OwnerJwtAuthGuard` |

---

### `POST /auth/owner/login`

**Request Body:**
```json
{
  "email": "owner@example.com",
  "password": "password123"
}
```

**Response:** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "name": "مالك النظام",
    "email": "owner@example.com",
    "role": "OWNER"
  }
}
```

> **JWT Payload:**
> ```json
> { "sub": "<user-uuid>", "role": "OWNER", "iat": ..., "exp": ... }
> ```
> - `issuer`: `asas-backend`
> - `audience`: `asas-owner-panel`
> - `TTL`: 24 ساعة

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `401` | البريد أو كلمة السر غير صحيحة |

> يبحث عن مستخدم `userType = OWNER` + `isDeleted = false` + `isActive = true`.

---

### `PATCH /auth/owner/change-password`

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
| `401` | المستخدم غير مصرح (توكن مفقود) |
| `404` | المستخدم غير موجود |

---

## 👤 الملف الشخصي

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/owner/profile` | جلب بيانات المالك | ⚠️ غير محمي |
| `PATCH` | `/owner/profile` | تحديث بيانات المالك | ⚠️ غير محمي |

---

### `GET /owner/profile`

> يجلب أول مستخدم `userType = OWNER` من قاعدة البيانات.

**Response:** `200 OK`
```json
{
  "uuid": "owner-uuid-1234-5678-abcd",
  "name": "مالك النظام",
  "email": "owner@asas.com",
  "phone": "777000000",
  "userType": "OWNER",
  "isActive": true
}
```

---

### `PATCH /owner/profile`

**Request Body:** (جميع الحقول اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `name` | `string` | الاسم الجديد |
| `email` | `string` | البريد الإلكتروني (يُتحقق كـ email) |
| `phone` | `string` | رقم الهاتف |
| `newPassword` | `string` | كلمة المرور الجديدة (6 أحرف على الأقل) |

**Request Example:**
```json
{
  "name": "المالك الجديد",
  "email": "newowner@asas.com",
  "phone": "778000000"
}
```

**Response:** `200 OK`
```json
{
  "uuid": "owner-uuid-1234-5678-abcd",
  "name": "المالك الجديد",
  "email": "newowner@asas.com",
  "phone": "778000000",
  "userType": "OWNER",
  "isActive": true
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | `No owner found` |

> ⚠️ لا يُرجع `id` أو `createdAt` أو `updatedAt`. يُرجع فقط الحقول المحددة في `select`.

---

## 🏫 المدارس

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/schools` | قائمة المدارس | ⚠️ غير محمي |
| `GET` | `/schools/stats` | إحصائيات | ⚠️ غير محمي |
| `GET` | `/schools/:uuid` | مدرسة محددة | ⚠️ غير محمي |
| `POST` | `/schools` | إنشاء مدرسة | ⚠️ غير محمي |
| `PATCH` | `/schools/:uuid` | تحديث مدرسة | ⚠️ غير محمي |
| `PATCH` | `/schools/:uuid/status` | تفعيل/إيقاف | ⚠️ غير محمي |
| `DELETE` | `/schools/:uuid` | حذف (Soft) | ⚠️ غير محمي |
| `GET` | `/schools/:uuid/manager` | جلب المدير | ⚠️ غير محمي |
| `POST` | `/schools/:uuid/manager` | إنشاء/تحديث المدير | ⚠️ غير محمي |
| `POST` | `/schools/:uuid/manager/reset-password` | إعادة تعيين كلمة مرور المدير | ⚠️ غير محمي |

---

### `GET /schools`

جلب قائمة بجميع المدارس (`isDeleted = false`)، مرتبة بـ `createdAt DESC`.

**Response:** `200 OK` — مصفوفة من كامل بيانات المدرسة.

---

### `GET /schools/stats`

**Response:** `200 OK`
```json
{
  "totalSchools": 25,
  "activeSchools": 20,
  "inactiveSchools": 5
}
```

> يحسب فقط المدارس غير المحذوفة (`isDeleted = false`).

---

### `GET /schools/:uuid`

**Response:** `200 OK` — كامل بيانات المدرسة.

| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |

> يتحقق من `isDeleted` أيضاً.

---

### `POST /schools` — إنشاء مدرسة

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | `string` | ✅ | اسم المدرسة |
| `appType` | `enum` | ✅ | `PUBLIC` / `PRIVATE` |
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
  "province": "صنعاء",
  "educationType": "أهلي",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FF5722",
  "backgroundColor": "#FFFFFF"
}
```

**Response:** `201 Created` — كامل بيانات المدرسة.

> - `schoolCode` يُولّد تلقائياً (آخر كود + 1، يبدأ من 1001).
> - `displayName` = `name` عند الإنشاء.
> - الحقول الاختيارية غير المرسلة تُحفظ كـ `null`.

---

### `PATCH /schools/:uuid` — تحديث

**Request Body:** (جميع الحقول اختيارية)

`name`, `appType`, `phone`, `email`, `address`, `province`, `educationType`, `ownerNotes`, `primaryColor`, `secondaryColor`, `backgroundColor`

**Response:** `200 OK` — كامل بيانات المدرسة بعد التحديث.

---

### `PATCH /schools/:uuid/status`

```json
{ "isActive": false }
```

**Response:** `200 OK` — كامل بيانات المدرسة.

---

### `DELETE /schools/:uuid`

> ⚠️ حذف منطقي للمدرسة **وجميع مستخدميها**: يُعيّن `isDeleted = true` + `isActive = false` + `deletedAt` للمدرسة ولكل المستخدمين غير المحذوفين.

**Response:** `200 OK`
```json
{ "success": true }
```

---

### `GET /schools/:uuid/manager`

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

> يبحث عن `userType = ADMIN` + `isDeleted = false` في المدرسة.

---

### `POST /schools/:uuid/manager`

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | `string` | ✅ | اسم المدير |
| `phone` | `string` | ✅ | رقم الهاتف |
| `password` | `string` | ✅* | كلمة المرور (مطلوبة عند الإنشاء فقط، 6 أحرف على الأقل) |

> *عند التحديث: يمكن إرسال `password` لتغييرها، أو تجاهلها للإبقاء على الحالية.

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

| الكود | الوصف |
|-------|-------|
| `400` | كلمة المرور مطلوبة عند إنشاء مدير جديد وبطول لا يقل عن 6 أحرف |
| `404` | لم يتم العثور على المدرسة |

> عند الإنشاء: يُولّد `code` تلقائياً عبر `nextUserCode` في المدرسة.

---

### `POST /schools/:uuid/manager/reset-password`

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

| الكود | الوصف |
|-------|-------|
| `404` | لم يتم العثور على المدرسة |
| `404` | لا يوجد مدير معين لهذه المدرسة |

> ⚠️ كلمة المرور الجديدة (8 أرقام) تظهر **مرة واحدة** فقط.

---

## 🔄 مزامنة المدارس

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/schools-sync?since=...&full=true` | سحب التغييرات | ⚠️ غير محمي |
| `POST` | `/schools-sync` | دفع التغييرات | ⚠️ غير محمي |

---

### `GET /schools-sync` — سحب

```
GET /schools-sync                          → Full Sync (أول مرة)
GET /schools-sync?full=true                → Full Sync (إجباري)
GET /schools-sync?since=2026-02-01T00:00Z  → Incremental
```

> إذا كانت `since` أقدم من 90 يوم → Full Sync تلقائياً.

**Response:** `200 OK`
```json
{
  "serverTime": "2026-02-05T15:30:00.000Z",
  "items": [
    {
      "id": 1,
      "uuid": "...",
      "name": "مدرسة النور",
      "schoolCode": 1001,
      "appType": "PUBLIC",
      "...": "...",
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

---

### `POST /schools-sync` — دفع

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `changes` | `array` | ✅ | مصفوفة التغييرات |

**بنية كل تغيير:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `uuid` | `string` | ✅ | معرف المدرسة |
| `name` | `string` | ❌ | الاسم |
| `phone`, `email`, `address`, `province` | `string` | ❌ | بيانات |
| `educationType`, `ownerNotes` | `string` | ❌ | |
| `primaryColor`, `secondaryColor`, `backgroundColor` | `string` | ❌ | ألوان |
| `isActive` | `boolean` | ❌ | الحالة |
| `action` | `enum` | ❌ | `UPSERT` (افتراضي) / `DELETE` |
| `updatedAtDevice` | `ISO Date` | ❌ | تاريخ التحديث على الجهاز |

**Response:** `200 OK`
```json
{ "serverTime": "2026-02-05T15:35:00.000Z" }
```

> ⚠️ لا يمكن إنشاء مدارس جديدة عبر المزامنة. يجب استخدام `POST /schools`.

---

## 📊 الصفوف الرسمية (GradeDictionary)

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/grades` | قائمة الصفوف الرسمية | ⚠️ غير محمي |
| `GET` | `/grades/:uuid` | صف محدد | ⚠️ غير محمي |
| `POST` | `/grades` | إنشاء صف | ⚠️ غير محمي |
| `PATCH` | `/grades/:uuid` | تحديث صف | ⚠️ غير محمي |
| `PATCH` | `/grades/:uuid/status` | تفعيل/إيقاف | ⚠️ غير محمي |
| `DELETE` | `/grades/:uuid` | حذف (Soft) | ⚠️ غير محمي |

---

### `POST /grades` — إنشاء صف

```json
{
  "code": "G01",
  "defaultName": "الأول الأساسي",
  "shortName": "1 ب",
  "stage": "أساسي",
  "sortOrder": 1
}
```

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `code` | `string` | ✅ | كود فريد (G01, G02, KG1…) |
| `defaultName` | `string` | ✅ | الاسم الرسمي |
| `shortName` | `string` | ❌ | اختصار |
| `stage` | `string` | ❌ | المرحلة (نص حر: رياض أطفال، أساسي، ثانوي…) |
| `sortOrder` | `int` | ❌ | ترتيب العرض |

> **ملاحظة:** هذا القاموس المركزي. المرحلة (`stage`) هنا نص حر عربي.
> عند إضافة صف لمدرسة عبر Manager API، يتم تحويله تلقائياً لـ enum (`KG`, `BASIC`, `SECONDARY`, `OTHER`).

---

## 🔄 مزامنة الصفوف

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/grades-sync?since=...&full=true` | سحب التغييرات | ⚠️ غير محمي |
| `POST` | `/grades-sync` | دفع التغييرات | ⚠️ غير محمي |

---

### `POST /grades-sync`

```json
{
  "changes": [
    {
      "uuid": "...", "code": "G01", "defaultName": "الأول",
      "stage": "أساسي", "sortOrder": 1, "action": "UPSERT"
    }
  ]
}
```

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `uuid` | `string` | ✅ | معرف الصف |
| `code` | `string` | ✅ | كود فريد |
| `defaultName` | `string` | ✅ | الاسم |
| `shortName` | `string` | ❌ | اختصار |
| `stage` | `string` | ❌ | المرحلة |
| `sortOrder` | `int` | ❌ | الترتيب |
| `isActive` | `bool` | ❌ | الحالة |
| `action` | `enum` | ❌ | `UPSERT` (افتراضي) / `DELETE` |
