# 👑 Owner API — لوحة المالك

> جميع الـ endpoints تحت `/api/v1`. المالك يملك JWT خاص ومستقل عن مدارسه.

---

## 🔐 المصادقة

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `POST` | `/auth/owner/login` | تسجيل الدخول | ❌ |
| `PATCH` | `/auth/owner/change-password` | تغيير كلمة المرور | ✅ JWT |

### `POST /auth/owner/login`

```json
// Request
{ "email": "owner@example.com", "password": "password123" }

// Response 200
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "name": "...", "email": "...", "role": "OWNER" }
}
```

### `PATCH /auth/owner/change-password`
**Headers:** `Authorization: Bearer <token>`
```json
{ "oldPassword": "currentPass", "newPassword": "newSecurePass" }
```

---

## 👤 الملف الشخصي

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/owner/profile` | جلب بيانات المالك |
| `PATCH` | `/owner/profile` | تحديث بيانات المالك |

### `GET /owner/profile`
```json
{ "name": "مالك النظام", "email": "owner@asas.com", "phone": "777000000" }
```

### `PATCH /owner/profile`
```json
// Request (جميع الحقول اختيارية)
{ "name": "المالك الجديد", "email": "new@asas.com", "phone": "778000000", "newPassword": "newPass" }
```

---

## 🏫 المدارس

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/schools` | قائمة المدارس |
| `GET` | `/schools/stats` | إحصائيات |
| `GET` | `/schools/:uuid` | مدرسة محددة |
| `POST` | `/schools` | إنشاء مدرسة |
| `PATCH` | `/schools/:uuid` | تحديث مدرسة |
| `PATCH` | `/schools/:uuid/status` | تفعيل/إيقاف |
| `DELETE` | `/schools/:uuid` | حذف (Soft) |
| `GET` | `/schools/:uuid/manager` | جلب المدير |
| `POST` | `/schools/:uuid/manager` | إنشاء/تحديث المدير |
| `POST` | `/schools/:uuid/manager/reset-password` | إعادة تعيين كلمة مرور المدير |

### `POST /schools` — إنشاء مدرسة
```json
{
  "name": "مدرسة النور", "appType": "PUBLIC",
  "phone": "777123456", "email": "school@example.com",
  "province": "صنعاء", "educationType": "أهلي",
  "primaryColor": "#1976D2", "secondaryColor": "#FF5722", "backgroundColor": "#FFFFFF"
}
```
> `schoolCode` يُولّد تلقائياً. `displayName` = `name` عند الإنشاء.

### `PATCH /schools/:uuid` — تحديث
جميع الحقول اختيارية: `name`, `appType`, `phone`, `email`, `address`, `province`, `educationType`, `ownerNotes`, `primaryColor`, `secondaryColor`, `backgroundColor`

### `PATCH /schools/:uuid/status`
```json
{ "isActive": false }
```

### `DELETE /schools/:uuid`
> ⚠️ حذف منطقي للمدرسة وجميع مستخدميها.

### `POST /schools/:uuid/manager`
```json
{ "name": "أحمد محمد", "phone": "777123456", "password": "securePass" }
```
> `password` مطلوب فقط عند الإنشاء.

### `POST /schools/:uuid/manager/reset-password`
```json
// Response
{ "schoolName": "...", "managerCode": 1, "newPassword": "45678923" }
```
> ⚠️ كلمة المرور الجديدة تظهر **مرة واحدة** فقط.

---

## 🔄 مزامنة المدارس

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/schools-sync?since=...&full=true` | سحب التغييرات |
| `POST` | `/schools-sync` | دفع التغييرات |

### `GET /schools-sync`
```
GET /schools-sync                          → Full Sync (أول مرة)
GET /schools-sync?full=true                → Full Sync (إجباري)
GET /schools-sync?since=2026-02-01T00:00Z  → Incremental
```
> إذا كانت `since` أقدم من 90 يوم → Full Sync تلقائياً.

### `POST /schools-sync`
```json
{
  "changes": [
    { "uuid": "...", "name": "مدرسة النور المتميزة", "action": "UPSERT" }
  ]
}
```
> ⚠️ لا يمكن إنشاء مدارس جديدة عبر المزامنة.

---

## 📊 الصفوف الرسمية (GradeDictionary)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/grades` | قائمة الصفوف الرسمية |
| `GET` | `/grades/:uuid` | صف محدد |
| `POST` | `/grades` | إنشاء صف |
| `PATCH` | `/grades/:uuid` | تحديث صف |
| `PATCH` | `/grades/:uuid/status` | تفعيل/إيقاف |
| `DELETE` | `/grades/:uuid` | حذف (Soft) |

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

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/grades-sync?since=...&full=true` | سحب التغييرات |
| `POST` | `/grades-sync` | دفع التغييرات |

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
