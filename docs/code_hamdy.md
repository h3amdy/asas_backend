تمام. نبدأ **من السيرفر** ونطلع Endpoint واضح اسمه “School Profile” يرجّع **كل بيانات المدرسة اللازمة للثيم + صفحة بيانات المدرسة**، ويكون **Public** (بدون JWT) لأنك تحتاجه مباشرة بعد اختيار المدرسة وقبل تسجيل الدخول أحيانًا.

## 1) قرار سريع لشكل الـ API

### Endpoint جديد (Public)

**GET** `/api/v1/public/schools/:uuid/profile`

* يعيد بيانات المدرسة كاملة (قدر الإمكان) حتى لو المستخدم لم يسجل دخول.
* **المدرسة PUBLIC فقط** (مثل search/verify).
* يفضّل يعيد أيضًا `isActive` حتى لو موقوفة (عشان تعرض شاشة الحجب صح).
* يرجع `serverTime` (اختياري لكن مفيد جدًا لتخزين `serverTimeAtSave`).

### Response المقترح (مطابق لـ SchoolContext.fromJson عندك)

```json
{
  "school": {
    "uuid": "....",
    "schoolCode": 1001,
    "displayName": "مدرسة النور الأهلية",
    "appType": "PUBLIC",
    "isActive": true,

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
  },
  "serverTime": "2026-02-13T22:10:00.000Z"
}
```

> ملاحظة: أنت الآن في Flutter تستقبل camelCase (تمام).

---

## 2) ملفات السيرفر التي سنضيفها (NestJS)

داخل: `src/public/schools/`

### (A) DTO جديد

`src/public/schools/dto/public-school-profile.dto.ts`

* نفس حقول `school` أعلاه.

### (B) Route جديد في Controller

`public-schools.controller.ts`

* إضافة:

```ts
@Get(':uuid/profile')
getSchoolProfile(@Param('uuid') uuid: string) { ... }
```

### (C) Service Method

`public-schools.service.ts`

* `getProfile(uuid: string)`

---

## 3) منطق الـ Service (Prisma) — عملي وواضح

### قواعد الاستعلام

* `uuid` يطابق المدرسة
* `appType = PUBLIC`
* `isDeleted = false` (إذا عندك)
* **لا تشترط isActive** (نرجعها كما هي)

### Prisma select (مثال)

```ts
const school = await this.prisma.school.findFirst({
  where: { uuid, appType: 'PUBLIC', isDeleted: false },
  select: {
    uuid: true,
    code: true,              // schoolCode
    displayName: true,
    appType: true,
    isActive: true,

    phone: true,
    email: true,

    province: true,
    district: true,
    addressArea: true,
    address: true,

    logoMediaAssetId: true,  // أو logo_media_asset_id حسب موديلك
    primaryColor: true,
    secondaryColor: true,
    backgroundColor: true,
  },
});
if (!school) throw new NotFoundException('SCHOOL_NOT_FOUND');
```

> إذا حقول العنوان/الألوان غير موجودة عندك في جدول School الآن:
> **إما تضيفها** (أفضل) أو ترجع null مؤقتًا.

---

## 4) Error Codes (موحّد)

مثل بقية public endpoints:

* `404 SCHOOL_NOT_FOUND`
* `403 SCHOOL_NOT_PUBLIC` (إذا أنت تسمح بالبحث العام فقط للـ PUBLIC)

بس أنا أنصح: بما أنه `/public/...` أساسًا، يكفي ترجع `404` لو مش PUBLIC.

---

## 5) كود جاهز (سيرفر) — Skeleton كامل

### `public-schools.controller.ts`

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicSchoolsService } from './public-schools.service';

@Controller('public/schools')
export class PublicSchoolsController {
  constructor(private readonly service: PublicSchoolsService) {}

  // موجود عندك:
  // GET /search
  // POST /verify-code

  @Get(':uuid/profile')
  async getSchoolProfile(@Param('uuid') uuid: string) {
    const school = await this.service.getProfile(uuid);
    return {
      school,
      serverTime: new Date().toISOString(),
    };
  }
}
```

### `public-schools.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PublicSchoolsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(uuid: string) {
    const school = await this.prisma.school.findFirst({
      where: { uuid, appType: 'PUBLIC', isDeleted: false },
      select: {
        uuid: true,
        code: true,
        displayName: true,
        appType: true,
        isActive: true,
        phone: true,
        email: true,
        province: true,
        district: true,
        addressArea: true,
        address: true,
        logoMediaAssetId: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
      },
    });

    if (!school) throw new NotFoundException('SCHOOL_NOT_FOUND');

    // تحويل للأسماء المتوقعة في Flutter
    return {
      uuid: school.uuid,
      schoolCode: school.code,
      displayName: school.displayName,
      appType: school.appType,
      isActive: school.isActive,
      phone: school.phone,
      email: school.email,
      province: school.province,
      district: school.district,
      addressArea: school.addressArea,
      address: school.address,
      logoMediaAssetId: school.logoMediaAssetId,
      primaryColor: school.primaryColor,
      secondaryColor: school.secondaryColor,
      backgroundColor: school.backgroundColor,
    };
  }
}
```

> إذا عندك أسماء أعمدة مختلفة في Prisma Model (مثل `logo_media_asset_id`) قلّي/ارسل model School من schema.prisma وانا أعدّل mapping بدقة.

---

## 6) ترتيب التنفيذ (خطواتك الآن)

1. **أضف الحقول الناقصة** في `School` إن لم تكن موجودة (province/district/addressArea/address/backgroundColor/logoMediaAssetId).
2. نفّذ Endpoint: `GET /public/schools/:uuid/profile`.
3. جرّبه في Postman:

   * مدرسة موجودة PUBLIC
   * مدرسة غير موجودة
   * مدرسة PRIVATE (لازم 404)
   * مدرسة موقوفة (يرجع isActive:false)
4. بعدها نبدأ دمجه في Flutter (لكن أنت قلت الآن السيرفر فقط—تمام).

---

## نقطة مهمة جدًا قبل ما نكمل

هل جدول `School` عندك في Prisma يحتوي فعلاً على هذه الحقول؟

* `province, district, addressArea, address`
* `primaryColor, secondaryColor, backgroundColor`
* `logoMediaAssetId`
* `isDeleted` / `deletedAt`

إذا أرسلت لي **model School من schema.prisma** (فقط هذا الجزء)، سأعطيك **كود نهائي 100% مطابق** بدون افتراضات.
