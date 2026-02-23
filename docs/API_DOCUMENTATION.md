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
│
├── 📂 prisma/                              # ملفات Prisma ORM
│   ├── schema.prisma                       # تعريف النماذج والعلاقات
│   ├── migrations/                         # سجل هجرات قاعدة البيانات
│   └── generated/                          # ملفات Prisma Client المُولّدة
│
├── 📂 src/                                 # الكود المصدري الرئيسي
│   │
│   ├── main.ts                             # 🚀 نقطة الدخول: إعداد CORS, ValidationPipe, تشغيل الخادم
│   ├── app.module.ts                       # 📦 الوحدة الجذر: تجميع كل الوحدات الفرعية
│   ├── app.controller.ts                   # 🎮 متحكم الجذر: endpoint صحة الخادم
│   ├── app.service.ts                      # ⚙️ خدمة الجذر: منطق عام
│   │
│   ├── 📂 owner/                           # 👑 وحدة المالك (تجميع)
│   │   ├── owner.module.ts                 # تسجيل الوحدة
│   │   ├── owner.controller.ts             # endpoints: getProfile, updateProfile
│   │   ├── owner.service.ts                # منطق تحديث بيانات المالك
│   │   ├── 📂 dto/
│   │   │   └── update-owner.dto.ts         # DTO: تحديث المالك
│   │   │
│   │   ├── 📂 auth/                        # 🔐 وحدة المصادقة للمالك 
│   │   │   ├── auth.module.ts              # تسجيل الوحدة مع JWT
│   │   │   ├── auth.controller.ts          # endpoints: login, change-password
│   │   │   ├── auth.service.ts             # منطق تسجيل الدخول والتحقق
│   │   │   ├── jwt.strategy.ts             # استراتيجية Passport JWT
│   │   │   ├── 📂 guards/
│   │   │   │   └── jwt-auth.guard.ts       # حارس حماية الـ endpoints المحمية
│   │   │   └── 📂 dto/
│   │   │       ├── owner-login.dto.ts      # DTO: email + password للدخول
│   │   │       └── change-password.dto.ts  # DTO: oldPassword + newPassword
│   │   │
│   │   ├── 📂 schools/                     # 🏫 وحدة المدارس للمالك
│   │   │   ├── schools.module.ts           # تسجيل الوحدة
│   │   │   ├── schools.controller.ts       # CRUD endpoints للمدارس
│   │   │   ├── schools.service.ts          # منطق إدارة المدارس والمدراء
│   │   │   ├── schools-sync.controller.ts  # endpoints المزامنة (pull/push)
│   │   │   ├── schools-sync.service.ts     # منطق المزامنة التزايدية والكاملة
│   │   │   └── 📂 dto/
│   │   │       ├── create-school.dto.ts    # DTO: إنشاء مدرسة
│   │   │       ├── update-school.dto.ts    # DTO: تحديث مدرسة (جزئي)
│   │   │       ├── update-school-status.dto.ts # DTO: تفعيل/إيقاف مدرسة
│   │   │       ├── create-school-manager.dto.ts# DTO: إنشاء/تحديث مدير
│   │   │       └── school-sync.dto.ts      # DTOs: المزامنة (Pull Query + Push Body)
│   │   │
│   │   ├── 📂 grades/                      # 📊  وحدة الصفوف الدراسية الرسمية للمالك
│   │   │   ├── grades.module.ts            # تسجيل الوحدة
│   │   │   ├── grades.controller.ts        # CRUD endpoints للصفوف
│   │   │   ├── grades.service.ts           # منطق إدارة الصفوف
│   │   │   ├── grades-sync.controller.ts   # endpoints المزامنة
│   │   │   ├── grades-sync.service.ts      # منطق مزامنة الصفوف
│   │   │   └── 📂 dto/
│   │   │       ├── create-grade.dto.ts     # DTO: إنشاء صف
│   │   │       ├── update-grade.dto.ts     # DTO: تحديث صف
│   │   │       ├── update-grade-status.dto.ts # DTO: تفعيل/إيقاف صف
│   │   │       └── grade-sync.dto.ts       # DTOs: المزامنة
│   │   │

│   │
│   ├── 📂 status/                           # 🚦 وحدة Boot Gate (حالة المدرسة)
│   │   ├── status.module.ts                # تسجيل الوحدة
│   │   ├── status.controller.ts            # endpoint: GET /status/schools/:uuid
│   │   └── status.service.ts               # منطق جلب حالة المدرسة
│   │
│   ├── 📂 school/                          # 🆕 وحدة أدوار المدرسة (ADMIN/TEACHER/STUDENT/PARENT)
│   │   ├── school.module.ts                # الوحدة الرئيسية: تجميع auth + sessions + common + profile + manager
│   │   │
│   │   ├── 📂 auth/                        # 🔐 مصادقة مستخدمي المدرسة
│   │   │   ├── school-auth.module.ts       # وحدة المصادقة مع JWT
│   │   │   ├── school-auth.controller.ts   # endpoints: login, refresh, logout
│   │   │   ├── school-auth.service.ts      # منطق تسجيل الدخول/الخروج
│   │   │   ├── constants.ts                # ثوابت JWT (issuer, audience, TTL)
│   │   │   ├── 📂 strategies/
│   │   │   │   └── school-jwt.strategy.ts  # 🔑 استراتيجية JWT للـ Passport
│   │   │   ├── 📂 guards/
│   │   │   │   └── school-jwt-auth.guard.ts # 🛡️ حارس JWT
│   │   │   ├── 📂 utils/
│   │   │   │   └── crypto.util.ts          # دوال sha256 + randomToken
│   │   │   └── 📂 dto/
│   │   │       ├── school-login.dto.ts     # DTO: schoolUuid + userCode/phone + password
│   │   │       ├── refresh.dto.ts          # DTO: sessionId + refreshToken
│   │   │       └── logout.dto.ts           # DTO: sessionId + logoutAll
│   │   │
│   │   ├── 📂 profile/                      # 👤 الملف الشخصي لمستخدمي المدرسة
│   │   │   ├── profile.module.ts           # وحدة الملف الشخصي
│   │   │   ├── profile.controller.ts       # endpoints: me, update, change-password
│   │   │   ├── profile.service.ts          # منطق جلب/تعديل/تغيير كلمة المرور
│   │   │   └── 📂 dto/
│   │   │       ├── update-profile.dto.ts   # DTO: تعديل البيانات
│   │   │       └── change-password.dto.ts  # DTO: تغيير كلمة المرور
│   │   │
│   │   ├── 📂 manager/                      # 🏫 وحدة إدارة المدير (ADMIN فقط)
│   │   │   ├── manager.module.ts           # الوحدة الرئيسية للمدير
│   │   │   ├── 📂 school-info/             # تعديل بيانات المدرسة
│   │   │   ├── 📂 grades/                  # إدارة الصفوف والشُعب
│   │   │   ├── 📂 academic-years/          # إدارة السنوات والفصول
│   │   │   ├── 📂 students/                # إدارة الطلاب
│   │   │   ├── 📂 parents/                 # إدارة أولياء الأمور
│   │   │   ├── 📂 teachers/                # إدارة المعلمين
│   │   │   ├── 📂 subjects/                # إدارة المواد والإسناد
│   │   │   └── 📂 setup/                   # 🎯 حالة التهيئة الأكاديمية
│   │   │
│   │   ├── 📂 sessions/                    # 🔄 إدارة الجلسات والأجهزة
│   │   │   ├── sessions.module.ts          # وحدة الجلسات
│   │   │   └── sessions.service.ts         # خدمة auth_sessions + user_devices
│   │   │
│   │   └── 📂 common/                      # 🔧 مكونات مشتركة
│   │       ├── school-common.module.ts     # وحدة المكونات المشتركة
│   │       ├── constants.ts                # ثوابت Headers (x-school-uuid)
│   │       ├── 📂 guards/
│   │       │   ├── school-context.guard.ts # 🛡️ حارس سياق المدرسة
│   │       │   └── roles.guard.ts          # 🛡️ حارس الأدوار (@Roles)
│   │       └── 📂 decorators/
│   │           ├── current-user.decorator.ts  # @CurrentUser()
│   │           └── school-context.decorator.ts # @SchoolCtx()
│   │
│   ├── 📂 public/                          # 🌍 الـ endpoints العامة (بدون مصادقة)
│   │   ├── public.module.ts                # الوحدة الرئيسية
│   │   └── 📂 schools/                     # 🔍 البحث عن المدارس العامة
│   │       ├── public-schools.module.ts    # وحدة المدارس العامة
│   │       ├── public-schools.controller.ts# endpoints: search, verify-code, getprofile
│   │       ├── public-schools.service.ts   # منطق البحث والتحقق
│   │       └── 📂 dto/
│   │           ├── public-school.dto.ts    # DTO: بيانات المدرسة العامة
│   │           ├── search-schools.query.ts # Query: q + limit
│   │           └── verify-school-code.dto.ts # DTO: schoolCode
│   │
│   ├── 📂 prisma/                          # 🔗 خدمة Prisma المشتركة
│   │   ├── prisma.module.ts                # وحدة Prisma العامة
│   │   └── prisma.service.ts               # خدمة الاتصال بقاعدة البيانات
│   │
│   ├── 📂 users/                           # 👥 نماذج المستخدمين
│   │   └── user.model.ts                   # نموذج/واجهة المستخدم
│   │
│   └── 📂 tools/                           # 🔧 أدوات مساعدة
│       └── hash.js                         # أداة لتوليد bcrypt hash
│
├── 📂 test/                                # اختبارات e2e
├── 📂 dist/                                # الكود المُترجم للإنتاج
├── 📂 node_modules/                        # المكتبات المُثبّتة
│
├── package.json                            # تعريف المشروع والمكتبات
├── tsconfig.json                           # إعدادات TypeScript
├── nest-cli.json                           # إعدادات NestJS CLI
├── .env                                    # المتغيرات البيئية (DATABASE_URL, JWT_SECRET, PORT)
└── DBDIGRAM.md                             # توثيق مخطط قاعدة البيانات
```

---

## 🌐 API Endpoints

> **Base URL:** `http://localhost:3000/api/v1`
>
> جميع الـ endpoints تبدأ بـ `/api/v1`. الأمثلة أدناه تظهر المسار النسبي فقط.

### 🚦 حالة المدرسة والحساب (Status Gates)

> 📍 **Boot Gate** - عامة بدون مصادقة. للتحقق من حالة المدرسة قبل تسجيل الدخول.
> 
> 📍 **Account Gate** - محمية بـ JWT. للتحقق من حالة الحساب والمدرسة بعد تسجيل الدخول.

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/status/schools/:uuid` | Boot Gate - حالة المدرسة | ❌ |
| `GET` | `/status/me` | Account Gate - حالة حسابي ومدرستي | ✅ JWT |

---

#### `GET /status/schools/:uuid` (Boot Gate)

جلب معلومات خفيفة لـ Boot التطبيق (موجودة؟ مفعّلة؟ نوعها؟).

**Path Parameters:**
| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `uuid` | `string` | ✅ | UUID المدرسة |

**Request Example:**
```
GET /status/schools/s1s2s3s4-e5f6-7890-abcd-ef1234567890
```

**Response:** `200 OK`
```json
{
  "school_uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "is_active": true,
  "app_type": "PUBLIC",
  "display_name": "مدرسة النور الأهلية",
  "reason": null
}
```

**Response مدرسة موقوفة:** `200 OK`
```json
{
  "school_uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "is_active": false,
  "app_type": "PUBLIC",
  "display_name": "مدرسة النور الأهلية",
  "reason": "SCHOOL_DISABLED"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | `School not found` |

---

#### `GET /status/me` (Account Gate)

التحقق من حالة حسابي ومدرستي بعد تسجيل الدخول.

**Headers:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `Authorization` | `string` | ✅ | `Bearer <accessToken>` |

**Response:** `200 OK`
```json
{
  "user_uuid": "user-uuid-here",
  "user_type": "TEACHER",
  "user_display_name": "أحمد محمد",
  "user_is_active": true,
  "school_uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "school_display_name": "مدرسة النور الأهلية",
  "school_is_active": true,
  "reason": null
}
```

**Response حساب موقوف:** `200 OK`
```json
{
  "user_uuid": "user-uuid-here",
  "user_type": "STUDENT",
  "user_display_name": "محمد علي",
  "user_is_active": false,
  "school_uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "school_display_name": "مدرسة النور الأهلية",
  "school_is_active": true,
  "reason": "USER_DISABLED"
}
```

**قيم `reason` المحتملة:**
| القيمة | الوصف |
|-------|-------|
| `null` | كل شيء نشط |
| `SCHOOL_DISABLED` | المدرسة موقوفة |
| `USER_DISABLED` | الحساب موقوف |

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `401` | `Unauthorized` - توكن غير صالح |
| `403` | `INVALID_SESSION` |
| `404` | `USER_NOT_FOUND` / `SCHOOL_NOT_FOUND` |

> 💡 **ملاحظة:** ترتيب الأسباب: المدرسة أولاً ثم المستخدم.

---

### 🌍 المدارس العامة (Public Schools)

> ⚠️ **ملاحظة:** هذه الـ endpoints عامة ولا تتطلب مصادقة. تُستخدم لاختيار المدرسة قبل تسجيل الدخول.

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/public/schools/search` | البحث عن مدارس بالاسم | ❌ |
| `POST` | `/public/schools/verify-code` | التحقق من كود المدرسة | ❌ |
| `GET` | `/public/schools/:uuid/profile` | ملف المدرسة الكامل | ❌ |

---

#### `GET /public/schools/search`

البحث عن المدارس العامة (PUBLIC) بالاسم.

**Query Parameters:**
| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `q` | `string` | ✅ | نص البحث (حرفين على الأقل) |
| `limit` | `number` | ❌ | عدد النتائج (1-50، افتراضي: 10) |

**Request Example:**
```
GET /public/schools/search?q=النور&limit=5
```

**Response:** `200 OK`
```json
{
  "items": [
    {
      "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
      "displayName": "مدرسة النور الأهلية",
      "schoolCode": 1001,
      "appType": "PUBLIC",
      "phone": "777123456",
      "email": "school@example.com",
      "province": "صنعاء",
      "district": "شميلة",
      "addressArea": "حي النور",
      "address": "شارع الجامعة",
      "logoMediaAssetId": 5,
      "primaryColor": "#1976D2",
      "secondaryColor": "#FF5722",
      "backgroundColor": "#FFFFFF"
    }
  ]
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `400` | `q must be at least 2 characters` |

> 💡 **ملاحظة:** يتم البحث في `displayName` و `name` باستخدام `ILIKE` (case-insensitive).

---

#### `POST /public/schools/verify-code`

التحقق من كود المدرسة وجلب بياناتها.

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `schoolCode` | `number` | ✅ | كود المدرسة (رقم موجب) |

**Request Example:**
```json
{
  "schoolCode": 1001
}
```

**Response:** `200 OK`
```json
{
  "school": {
    "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
    "displayName": "مدرسة النور الأهلية",
    "schoolCode": 1001,
    "appType": "PUBLIC",
    "isActive": true,
    "phone": "777123456",
    "email": "school@example.com",
    "province": "صنعاء",
    "district": "شميلة",
    "addressArea": "حي النور",
    "address": "شارع الجامعة",
    "educationType": "أهلي",
    "deliveryPolicy": "OPEN",
    "logoMediaAssetId": 5,
    "primaryColor": "#1976D2",
    "secondaryColor": "#FF5722",
    "backgroundColor": "#FFFFFF"
  }
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `400` | `schoolCode must be a positive integer` |
| `404` | `SCHOOL_NOT_FOUND` |

> ⚠️ **ملاحظة:** يتم إرجاع فقط المدارس النشطة (`isActive=true`) وغير المحذوفة (`isDeleted=false`) ونوعها `PUBLIC`.

---

#### `GET /public/schools/:uuid/profile`

جلب ملف المدرسة الكامل (بيانات + ألوان الثيم + عنوان + تواصل). يُستخدم لعرض صفحة المدرسة وتطبيق الثيم.

> 💡 **ملاحظة مهمة:** هذا الـ endpoint يُرجع المدرسة **حتى لو كانت موقوفة** (`isActive=false`)، لأن Flutter يحتاج عرض شاشة الحجب بشكل صحيح.

**Path Parameters:**
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `uuid` | `string` | UUID المدرسة |

**Response:** `200 OK`
```json
{
  "school": {
    "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
    "displayName": "مدرسة النور الأهلية",
    "schoolCode": 1001,
    "appType": "PUBLIC",
    "isActive": true,
    "phone": "777123456",
    "email": "school@example.com",
    "province": "صنعاء",
    "district": "شميلة",
    "addressArea": "حي النور",
    "address": "شارع الجامعة",
    "educationType": "أهلي",
    "deliveryPolicy": "OPEN",
    "logoMediaAssetId": 5,
    "primaryColor": "#1976D2",
    "secondaryColor": "#FF5722",
    "backgroundColor": "#FFFFFF"
  },
  "serverTime": "2026-02-13T22:10:00.000Z"
}
```

**Error Responses:**
| الكود | الوصف |
|-------|-------|
| `404` | `SCHOOL_NOT_FOUND` |

> ⚠️ **ملاحظة:** يتم إرجاع المدارس غير المحذوفة (`isDeleted=false`) بغض النظر عن `appType` أو حالة `isActive`.

---

### 🔐 مصادقة المدرسة (School Auth)

> ⚠️ **ملاحظة:** هذه الـ endpoints لمستخدمي المدرسة (ADMIN/TEACHER/STUDENT/PARENT). بدون مصادقة للدخول، مع JWT للعمليات اللاحقة.

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `POST` | `/school/auth/login` | تسجيل دخول مستخدمي المدرسة | ❌ |
| `POST` | `/school/auth/refresh` | تجديد التوكن | ❌ |
| `POST` | `/school/auth/logout` | تسجيل الخروج | ✅ JWT |

#### 🔑 بنية Access Token (JWT Payload)

> 💡 **للمطوّر:** الـ Access Token يحتوي على البيانات التالية، يمكن استخراجها محلياً بدون طلب API.

| الحقل | النوع | الوصف |
|-------|-------|-------|
| `sub` | `string` | UUID المستخدم |
| `ut` | `enum` | نوع المستخدم: `ADMIN` / `TEACHER` / `STUDENT` / `PARENT` |
| `sc` | `string` | UUID المدرسة |
| `sid` | `string` | UUID الجلسة |
| `uc` | `number?` | كود المستخدم (اختياري) |
| `iat` | `number` | وقت الإصدار (Unix timestamp) |
| `exp` | `number` | وقت الانتهاء (Unix timestamp) |

---

#### `POST /school/auth/login`

تسجيل دخول مستخدمي المدرسة. يدعم:
- **ADMIN/TEACHER/STUDENT:** باستخدام `userCode`
- **PARENT:** باستخدام `phone`

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `schoolUuid` | `string` | ✅ | UUID المدرسة |
| `userCode` | `number` | ⚠️ | كود المستخدم (ADMIN/TEACHER/STUDENT) |
| `phone` | `string` | ⚠️ | رقم الهاتف (PARENT فقط) |
| `password` | `string` | ✅ | كلمة المرور |
| `deviceFingerprint` | `string` | ✅ | معرّف تثبيت التطبيق (Installation ID) |
| `deviceType` | `enum` | ✅ | `ANDROID` / `IOS` / `WEB` |
| `pushToken` | `string` | ❌ | FCM Token للإشعارات |

> ⚠️ يجب إرسال واحد فقط من `userCode` أو `phone`، وليس كلاهما.
>
> 💡 **`deviceFingerprint`:** يُولّد محليًا ويُحفظ على الجهاز. قد يتغير عند حذف التطبيق وإعادة تثبيته، وهذا متوقع.

**Request Example (TEACHER/STUDENT/ADMIN):**
```json
{
  "schoolUuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "userCode": 1001,
  "password": "mypassword",
  "deviceFingerprint": "abc123-device-id",
  "deviceType": "ANDROID",
  "pushToken": "fcm-token-here"
}
```

**Request Example (PARENT):**
```json
{
  "schoolUuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
  "phone": "777123456",
  "password": "mypassword",
  "deviceFingerprint": "abc123-device-id",
  "deviceType": "IOS"
}
```

**Response:** `200 OK`
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "random-base64url-token",
  "sessionId": "session-uuid-here",
  "refreshExpiresAt": "2026-03-07T00:00:00.000Z",
  "user": {
    "uuid": "user-uuid-here",
    "userType": "TEACHER",
    "code": 1001,
    "displayName": "أحمد محمد"
  },
  "school": {
    "uuid": "s1s2s3s4-e5f6-7890-abcd-ef1234567890",
    "displayName": "مدرسة النور الأهلية",
    "appType": "PUBLIC"
  }
}
```

**Error Responses:**
| الكود | الرسالة | الوصف |
|-------|---------|-------|
| `400` | `Either phone or userCode is required` | لم يتم إرسال أي معرف |
| `400` | `Provide only one of phone or userCode` | تم إرسال كلا المعرفين |
| `401` | `INVALID_CREDENTIALS` | كود/هاتف أو كلمة المرور خاطئة |
| `403` | `SCHOOL_INACTIVE` | المدرسة موقوفة |
| `403` | `USER_INACTIVE` | المستخدم موجود لكن حسابه موقوف |
| `404` | `SCHOOL_NOT_FOUND` | المدرسة غير موجودة |

---

#### `POST /school/auth/refresh`

تجديد Access Token باستخدام Refresh Token.

> 🔐 **Security:** refresh يعتمد على تدوير refresh token مع كل طلب (Rotation) ويمنع التحديث من جهاز مختلف عبر التحقق من `deviceFingerprint` (Device mismatch).

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `sessionId` | `string` | ✅ | UUID الجلسة |
| `refreshToken` | `string` | ✅ | Refresh Token الحالي |
| `deviceFingerprint` | `string` | ✅ | معرّف تثبيت التطبيق (Installation ID) |
| `deviceType` | `enum` | ✅ | `ANDROID` / `IOS` / `WEB` |
| `pushToken` | `string` | ❌ | FCM Token (لتحديثه) |

**Request Example:**
```json
{
  "sessionId": "session-uuid-here",
  "refreshToken": "old-refresh-token",
  "deviceFingerprint": "abc123-device-id",
  "deviceType": "ANDROID"
}
```

**Response:** `200 OK`
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...(new)",
  "refreshToken": "new-refresh-token",
  "sessionId": "session-uuid-here",
  "refreshExpiresAt": "2026-03-07T00:00:00.000Z",
  "user": { ... },
  "school": { ... }
}
```

**Error Responses:**
| الكود | الرسالة | الوصف |
|-------|---------|-------|
| `403` | `SESSION_REVOKED` | الجلسة تم إلغاؤها |
| `403` | `SESSION_EXPIRED` | الجلسة منتهية الصلاحية |
| `403` | `REFRESH_TOKEN_INVALID` | Refresh Token غير صالح |
| `403` | `DEVICE_MISMATCH` | بصمة الجهاز لا تطابق الجلسة |
| `403` | `DEVICE_NOT_FOUND` | الجهاز المرتبط بالجلسة غير موجود |
| `403` | `DEVICE_INACTIVE` | الجهاز معطل |
| `403` | `USER_INACTIVE` | المستخدم موقوف |
| `403` | `SCHOOL_INACTIVE` | المدرسة موقوفة |
| `403` | `INVALID_SESSION` | عدم تطابق المستخدم مع المدرسة في الجلسة |
| `404` | `SESSION_NOT_FOUND` | الجلسة غير موجودة |

> 💡 **ملاحظة:** بعد كل refresh ناجح، يجب حفظ الـ `refreshToken` الجديد. الـ Token القديم يصبح غير صالح.

---

#### `POST /school/auth/logout`

تسجيل الخروج وإلغاء الجلسة/الجلسات.

> ⚠️ **محمي بـ JWT** - يجب إرسال `Authorization: Bearer <accessToken>` ويتم التحقق من أن الجلسة تخص المستخدم الحالي.

**Headers:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `Authorization` | `string` | ✅ | `Bearer <accessToken>` |

**Request Body:**
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `sessionId` | `string` | ✅ | UUID الجلسة |
| `logoutAll` | `boolean` | ❌ | إلغاء جميع الجلسات (افتراضي: `false`) |
| `deviceFingerprint` | `string` | ❌ | معرّف الجهاز (لتحديث lastSeen) |

**Request Example (جلسة واحدة):**
```json
{
  "sessionId": "session-uuid-here"
}
```

**Request Example (جميع الجلسات):**
```json
{
  "sessionId": "session-uuid-here",
  "logoutAll": true
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "logoutAll": false
}
```

**Error Responses:**
| الكود | الرسالة | الوصف |
|-------|---------|-------|
| `401` | `Unauthorized` | توكن غير صالح أو مفقود |
| `403` | `NOT_YOUR_SESSION` | الجلسة لا تخص المستخدم الحالي |
| `404` | `SESSION_NOT_FOUND` | الجلسة غير موجودة |

---

### 👤 الملف الشخصي (School User Profile)

> 📖 **وثيقة تفصيلية:** راجع [`PROFILE_README.md`](file:///Users/hamdy/development/Projects/asas_backend/docs/PROFILE_README.md) للتفاصيل الكاملة.

| Method | Endpoint | الوصف | الحماية |
|--------|----------|-------|---------|
| `GET` | `/school/profile/me` | جلب بياناتي | ✅ JWT + Context |
| `PATCH` | `/school/profile/me` | تعديل بياناتي | ✅ JWT + Context |
| `POST` | `/school/profile/change-password` | تغيير كلمة المرور (بدون خروج) | ✅ JWT + Context |

**الحقول القابلة للتعديل:** `displayName`, `gender`, `email`, `province`, `district`, `addressArea`, `addressDetails`

**أكواد الأخطاء الخاصة:**
| الكود | الرسالة | الوصف |
|-------|---------|-------|
| `401` | `OLD_PASSWORD_WRONG` | كلمة المرور القديمة غير صحيحة |
| `400` | `NEW_PASSWORD_SAME_AS_OLD` | كلمة المرور الجديدة مطابقة للقديمة |

---

### 🏫 إدارة المدرسة (Manager APIs — ADMIN فقط)

> 📖 **وثيقة تفصيلية:** راجع [`MANAGER_README.md`](file:///Users/hamdy/development/Projects/asas_backend/docs/MANAGER_README.md) للتفاصيل الكاملة.

**الحماية:** JWT + SchoolContext + `@Roles('ADMIN')`

| فئة | Method | Endpoint | الوصف |
|------|--------|----------|-------|
| **بيانات المدرسة** | `GET` | `/school/manager/school-info` | عرض بيانات المدرسة |
| | `PATCH` | `/school/manager/school-info` | تعديل بيانات المدرسة |
| **الصفوف** | `GET` | `/school/manager/grades` | قائمة الصفوف |
| | `POST` | `/school/manager/grades` | إنشاء صف (+ شعبة افتراضية) |
| | `PATCH` | `/school/manager/grades/:id` | تعديل صف |
| | `DELETE` | `/school/manager/grades/:id` | حذف صف (شرط عدم وجود طلاب) |
| **الشُعب** | `GET` | `/school/manager/grades/:id/sections` | قائمة الشُعب |
| | `POST` | `/school/manager/grades/:id/sections` | إنشاء شعبة |
| | `PATCH` | `/school/manager/grades/sections/:id` | تعديل شعبة |
| | `DELETE` | `/school/manager/grades/sections/:id` | حذف شعبة |
| **السنوات** | `GET` | `/school/manager/academic-years` | قائمة السنوات |
| | `POST` | `/school/manager/academic-years` | إنشاء سنة (+ فصول) |
| | `GET` | `/school/manager/academic-years/current` | السنة الحالية |
| | `PATCH` | `/school/manager/academic-years/:id` | تعديل سنة |
| | `POST` | `/school/manager/academic-years/:id/advance-term` | التقدم للفصل التالي |
| **الطلاب** | `GET` | `/school/manager/students` | قائمة الطلاب (فلترة بصف/شعبة) |
| | `POST` | `/school/manager/students` | إنشاء طالب |
| | `GET` | `/school/manager/students/:uuid` | ملف الطالب |
| | `PATCH` | `/school/manager/students/:uuid` | تعديل بيانات |
| | `POST` | `/school/manager/students/:uuid/transfer` | نقل لصف/شعبة |
| | `POST` | `/school/manager/students/:uuid/reset-password` | إعادة تعيين كلمة المرور |
| **أولياء الأمور** | `GET` | `/school/manager/parents` | قائمة أولياء الأمور |
| | `POST` | `/school/manager/parents` | إنشاء ولي أمر |
| | `GET` | `/school/manager/parents/:uuid` | ملف ولي الأمر |
| | `POST` | `/school/manager/parents/:uuid/link-children` | ربط أبناء |
| | `DELETE` | `/school/manager/parents/:uuid/children/:id` | فك ربط ابن |
| **المعلمين** | `GET` | `/school/manager/teachers` | قائمة المعلمين |
| | `POST` | `/school/manager/teachers` | إنشاء معلم |
| | `GET` | `/school/manager/teachers/:uuid` | ملف المعلم |
| | `POST` | `/school/manager/teachers/:uuid/supervisor` | تعيين/إلغاء مشرف |
| | `POST` | `/school/manager/teachers/:uuid/extra-permissions` | صلاحيات إضافية |
| | `POST` | `/school/manager/teachers/:uuid/scopes` | إضافة نطاق إشراف |
| **المواد** | `GET` | `/school/manager/subjects` | قائمة المواد |
| | `POST` | `/school/manager/subjects` | إنشاء مادة (+ إسناد للشُعب) |
| | `POST` | `/school/manager/subjects/:id/sections` | إسناد لشُعب إضافية |
| | `POST` | `/school/manager/subjects/subject-sections/:id/teachers` | إسناد معلم لمادة |
| **التهيئة** | `GET` | `/school/manager/setup/status` | حالة تهيئة المدرسة |

---

### 📝 ملاحظات مهمة حول الأجهزة (UserDevice)

- `deviceFingerprint` مرتبط بالمستخدم، لذلك **نفس الجهاز يمكن أن يسجل بأكثر من حساب**.
- `pushToken` قد يتغير أو يتكرر تاريخيًا، لذلك لا يُعتبر معرّفًا فريدًا.

---

### 🔒 التحقق من الجلسة (SchoolJwtStrategy)

> ⚠️ **مهم جداً:** كل request محمي بـ JWT يتم التحقق من صلاحية الجلسة في قاعدة البيانات. هذا يعني أن إلغاء الجلسة أو إيقاف المستخدم/المدرسة **يسري فوراً** على جميع الـ endpoints المحمية.

**الفحوصات التي تتم تلقائياً:**
1. ✅ الجلسة موجودة وغير ملغية (`revokedAt = null`)
2. ✅ الجلسة لم تنتهِ (`expiresAt > now`)
3. ✅ المستخدم موجود ونشط وغير محذوف
4. ✅ المدرسة موجودة ونشطة وغير محذوفة
5. ✅ الجهاز نشط (إن وُجد)
6. ✅ تطابق `sub` و `sc` في التوكن مع بيانات الجلسة

**Error Responses (قد تظهر من أي endpoint محمي):**
| الكود | الرسالة | الوصف |
|-------|---------|-------|
| `403` | `SESSION_NOT_FOUND` | الجلسة غير موجودة |
| `403` | `SESSION_REVOKED` | الجلسة ملغية (logout سابق) |
| `403` | `SESSION_EXPIRED` | الجلسة منتهية الصلاحية |
| `403` | `USER_NOT_FOUND` | المستخدم محذوف |
| `403` | `USER_INACTIVE` | المستخدم موقوف |
| `403` | `INVALID_SESSION` | عدم تطابق بيانات التوكن مع الجلسة |
| `403` | `SCHOOL_NOT_FOUND` | المدرسة محذوفة |
| `403` | `SCHOOL_INACTIVE` | المدرسة موقوفة |
| `403` | `DEVICE_INACTIVE` | الجهاز موقوف |

---

### 🛡️ حارس سياق المدرسة (SchoolContextGuard)

> ⚠️ **ملاحظة:** يتم تطبيقه على كل الـ endpoints المحمية التي تحتاج سياق مدرسة. يتحقق من تطابق المدرسة في الـ JWT مع الـ Header.

**المتطلبات:**
| الحقل | المصدر | الوصف |
|-------|--------|-------|
| `Authorization` | Header | `Bearer <accessToken>` |
| `x-school-uuid` | Header | UUID المدرسة |

**آلية العمل:**
1. يقرأ `x-school-uuid` من الـ Header
2. يطابقه مع `sc` داخل الـ JWT
3. يتحقق من وجود المدرسة ونشاطها
4. يحفظ السياق في `req.schoolContext`

**Error Responses:**
| الكود | الرسالة | الوصف |
|-------|---------|-------|
| `401` | `Missing header: x-school-uuid` | لم يتم إرسال header المدرسة |
| `401` | `Missing token school scope` | الـ JWT لا يحتوي على معرف مدرسة |
| `403` | `SCHOOL_SCOPE_MISMATCH` | عدم تطابق المدرسة في الـ Header مع الـ JWT |
| `403` | `SCHOOL_NOT_FOUND` | المدرسة غير موجودة |
| `403` | `SCHOOL_INACTIVE` | المدرسة موقوفة |

---

### 📋 مرجع أكواد الأخطاء الموحدة (Error Codes Reference)

> 💡 **للمطوّر (Flutter):** جميع رسائل الأخطاء تُرجع كأكواد ثابتة (constants) بدلاً من نصوص حرة. يمكن الاعتماد على `message` كمعرّف ثابت و `statusCode` لتحديد نوع الخطأ.
>
> الأكواد مُعرّفة في `src/school/auth/constants.ts` → `SCHOOL_AUTH_ERRORS`

| الكود الثابت | HTTP Status | الوصف |
|-------------|-------------|-------|
| `SCHOOL_NOT_FOUND` | `404` | المدرسة غير موجودة |
| `SCHOOL_INACTIVE` | `403` | المدرسة موقوفة |
| `SCHOOL_SCOPE_MISMATCH` | `403` | عدم تطابق المدرسة في Header و JWT |
| `INVALID_CREDENTIALS` | `401` | كود/هاتف أو كلمة مرور خاطئة |
| `USER_NOT_FOUND` | `404` | المستخدم غير موجود |
| `USER_INACTIVE` | `403` | حساب المستخدم موقوف |
| `DEVICE_NOT_FOUND` | `403` | الجهاز غير موجود |
| `DEVICE_INACTIVE` | `403` | الجهاز معطل |
| `DEVICE_MISMATCH` | `403` | بصمة الجهاز لا تطابق الجلسة |
| `SESSION_NOT_FOUND` | `404` | الجلسة غير موجودة |
| `SESSION_EXPIRED` | `403` | الجلسة منتهية الصلاحية |
| `SESSION_REVOKED` | `403` | الجلسة تم إلغاؤها |
| `REFRESH_TOKEN_INVALID` | `403` | Refresh Token غير صالح |
| `NOT_YOUR_SESSION` | `403` | الجلسة لا تخص المستخدم الحالي |
| `INVALID_SESSION` | `403` | عدم تطابق المستخدم مع المدرسة في الجلسة |

---

//////////////////////////////////////////////////////
//. ما يخص المالك يحتاج مراجعة 
//////////////////////////////////////////////////////


### 🔐 المصادقة (Auth - Owner)

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
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "name": "...",
    "email": "...",
    "role": "OWNER"
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
    "logoMediaAssetId": null,
    "address": "صنعاء",
    "province": "صنعاء",
    "educationType": "أهلي",
    "deliveryPolicy": "OPEN",
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

> ℹ️ **ملاحظة:** 
> - `schoolCode` يُولّد تلقائياً ولا يمكن تعديله.
> - `displayName` يأخذ نفس قيمة `name` عند الإنشاء.

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
  "displayName": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "phone": "778888888",
  "email": "school@example.com",
  "logoMediaAssetId": null,
  "address": "صنعاء",
  "province": "صنعاء",
  "district": null,
  "addressArea": null,
  "educationType": "أهلي",
  "ownerNotes": "ملاحظات خاصة",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FF5722",
  "backgroundColor": "#FFFFFF",
  "deliveryPolicy": "OPEN",
  "nextUserCode": 5,
  "isActive": true,
  "isDeleted": false,
  "deletedAt": null,
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-02-05T15:10:00.000Z"
}
```

> ℹ️ **ملاحظة:** يتم إرجاع كامل بيانات المدرسة بعد التحديث.

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
  "displayName": "مدرسة النور",
  "schoolCode": 1001,
  "appType": "PUBLIC",
  "phone": "777123456",
  "email": "school@example.com",
  "logoMediaAssetId": null,
  "address": "صنعاء",
  "province": "صنعاء",
  "district": null,
  "addressArea": null,
  "educationType": "أهلي",
  "ownerNotes": "ملاحظات خاصة",
  "primaryColor": "#1976D2",
  "secondaryColor": "#FF5722",
  "backgroundColor": "#FFFFFF",
  "deliveryPolicy": "OPEN",
  "nextUserCode": 5,
  "isActive": false,
  "isDeleted": false,
  "deletedAt": null,
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-02-05T15:15:00.000Z"
}
```

> ℹ️ **ملاحظة:** يتم إرجاع كامل بيانات المدرسة بعد تغيير الحالة.

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
