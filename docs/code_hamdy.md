تمام — خلّينا نعمل **خطة سيرفر كاملة** لميزة:

1. **جلب الملف الشخصي (My Profile)**
2. **تعديل الملف الشخصي**
3. **تغيير كلمة المرور “بدون خروج” وبدون أي حركة في الجلسات** ✅

وسأبني الخطة على هيكل مشروعك الحالي (school/auth + guards + decorators + prisma).

> ملاحظة مهمة: “بدون خروج” معناها **لا نعمل revoke للجلسة الحالية ولا نلغي باقي الجلسات**. فقط نغيّر `password_hash`.
> (هذا أقل أمانًا من المعتاد، لكنه يطابق طلبك للمـVP. لاحقًا Phase 2 ممكن تضيف خيار “logoutAllDevices”.)

---

## 0) أين نضع هذه الميزة داخل مشروعك؟

بما أنك عندك `src/school/` للأدوار (ADMIN/TEACHER/STUDENT/PARENT)، فالميزة تكون هنا:

```
src/school/profile/
  profile.module.ts
  profile.controller.ts
  profile.service.ts
  dto/
    update-my-profile.dto.ts
    change-my-password.dto.ts
```

وتتسجل في `school.module.ts` أو `app.module.ts` حسب تجميعك.

---

## 1) Endpoints النهائية (واضحة وثابتة)

### ✅ 1.1 جلب ملفي

**GET** `/api/v1/school/profile/me`
حماية: `SchoolJwtAuthGuard` + `SchoolContextGuard`

**Response 200**

```json
{
  "uuid": "user-uuid",
  "userType": "TEACHER",
  "code": 1001,
  "name": "أحمد محمد",
  "displayName": "أحمد",
  "gender": "M",
  "phone": "777...",
  "email": "a@..",
  "province": "...",
  "district": "...",
  "addressArea": "...",
  "addressDetails": "...",
  "updatedAt": "2026-02-14T..."
}
```

> لا ترجع `passwordHash` نهائيًا.

---

### ✅ 1.2 تعديل ملفي

**PATCH** `/api/v1/school/profile/me`
حماية: `SchoolJwtAuthGuard` + `SchoolContextGuard`

**Body (كلها اختيارية)**

* `displayName`
* `gender`
* `email`
* `province`
* `district`
* `addressArea`
* `addressDetails`

> *لا تسمح بتعديل*: `userType`, `code`, `schoolId`, `isActive`… إلخ.

**Response 200**: نفس شكل `GET /me`

---

### ✅ 1.3 تغيير كلمة المرور بدون خروج

**POST** `/api/v1/school/profile/change-password`
حماية: `SchoolJwtAuthGuard` + `SchoolContextGuard`

**Body**

```json
{ "oldPassword": "...", "newPassword": "..." }
```

**Response 200**

```json
{ "success": true }
```

> لا revoke ولا logout ولا invalidate tokens.
> (يبقى access token صالح لحد exp، والrefresh شغال.)

---

## 2) Guards و Context: كيف نضمن المستخدم صح؟

أنت عندك:

* `SchoolJwtStrategy` تتحقق من الجلسة في DB (ممتاز)
* `SchoolContextGuard` يطابق `x-school-uuid` مع `sc` داخل JWT

إذًا في profile endpoints:

* نستخدم `@CurrentUser()` (payload فيه `sub`, `sc`, `sid`, `ut`, `uc?`)
* نستخدم prisma لجلب user بناءً على `sub` + (schoolId matching)

قاعدة ذهبية في كل عمليات profile:

* تأكد من `user.uuid = sub`
* وتأكد أن `user.school.uuid = sc` (أو `schoolId` يطابق المدرسة)

---

## 3) DTOs (Validation) — قواعد واضحة

### 3.1 UpdateMyProfileDto

* `displayName`: optional, min 2 max 50
* `gender`: optional (يفضل enum لاحقًا، حاليًا string مقبول)
* `email`: optional, isEmail
* العناوين: optional max lengths

**مهم**: لا تقبل `name` إذا أنت تعتبره “اسم رسمي” غير قابل للتعديل (قرار منك).
إذا تريد تسمح بتعديله، أضفه صراحة واعتبره “اسم المستخدم”.

---

### 3.2 ChangeMyPasswordDto

* `oldPassword`: required min 6
* `newPassword`: required min 8 (أنصح 8 على الأقل)
* rule: `newPassword != oldPassword`

---

## 4) Service Logic بالتفصيل (بدون تعقيد)

### 4.1 getMe(userPayload)

1. prisma.user.findFirst:

   * where: uuid=sub AND isDeleted=false
   * include: school (للتحقق)
2. تأكد user.isActive=true وإلا throw `USER_INACTIVE` (أنت أصلاً تعملها في strategy غالبًا)
3. return safe mapped object

---

### 4.2 updateMe(userPayload, dto)

1. fetch user by uuid=sub + isDeleted=false
2. build `data` object فقط من الحقول المسموحة والتي جاءت فعلًا
3. prisma.user.update({ where: { id }, data })
4. return safe user

> لو `email` تريد uniqueness داخل المدرسة أو platform: ضع سياسة الآن:

* إذا تريد فريد داخل المدرسة: index لاحق
* أو اتركه بلا uniqueness (أسهل MVP)

---

### 4.3 changePassword(userPayload, dto) **بدون خروج**

1. fetch user (uuid=sub)
2. compare bcrypt(oldPassword, user.passwordHash)

   * إذا خطأ → `INVALID_CREDENTIALS` أو `OLD_PASSWORD_WRONG`
3. hash newPassword
4. prisma.user.update({ data: { passwordHash: newHash } })
5. (اختياري) سجل audit log لاحقًا
6. return `{ success: true }`

✅ لا تعمل:

* revoke session
* تغيير refreshTokenHash
* logoutAll

---

## 5) أخطاء موحدة (Constants) — مهم للـ Flutter

أضف في `src/school/auth/constants.ts` أو ملف جديد `profile.constants.ts`:

* `OLD_PASSWORD_WRONG` (401)
* `NEW_PASSWORD_SAME_AS_OLD` (400)
* `PROFILE_UPDATE_NOT_ALLOWED_FIELD` (400) (لو احتجته)
* `USER_NOT_FOUND` (404) (موجود لديك)
* `USER_INACTIVE` (403) (موجود لديك)

وخلي الاستجابات مثل نظامك: message = code ثابت.

---

## 6) Prisma / DB: هل نحتاج migrations؟

للـ profile: **لا**
لتغيير كلمة المرور: **لا**

**لكن** (مهم للمصادقة عمومًا):

* نفّذ Partial Unique Index لهاتف ولي الأمر داخل المدرسة (كما في ERD) — هذا يخص login أكثر من profile، لكن وجوده ممتاز.

---

## 7) Testing Checklist (قبل ربط Flutter)

### 7.1 Profile Me

* سجل دخول Teacher → GET profile/me ✅
* جرّب header مدرسة مختلفة → `SCHOOL_SCOPE_MISMATCH` ✅
* جرّب user inactive → `USER_INACTIVE` ✅

### 7.2 Update

* عدّل displayName فقط → يرجع updatedAt جديد ✅
* جرّب إرسال `userType` في body → لازم ValidationPipe يمنعه (whitelist + forbidNonWhitelisted) ✅

### 7.3 Change Password (No Logout)

* غيّر كلمة المرور → success ✅
* جرّب refresh مباشرة بعدها بنفس session → لازم ينجح ✅
* جرّب oldPassword غلط → 401 OLD_PASSWORD_WRONG ✅
* جرّب login بكلمة المرور القديمة → يفشل ✅
* login بالجديدة → ينجح ✅

---

## 8) ترتيب التنفيذ (خطة عمل يوم/جلسة واحدة)

1. إنشاء folder `src/school/profile/` + module/controller/service
2. إضافة DTOs + validations
3. إضافة endpoints الثلاثة + guards
4. إضافة constants للأخطاء
5. Postman/Insomnia tests
6. بعدها نربط Flutter: شاشة profile + edit + change password

---

## 9) ملاحظة صغيرة مهمة: Owner vs School Users

أنت طلبك الآن واضح: “الملف الشخصي للمستخدم داخل المدرسة”.
المالك لديك له مسار مختلف (`owner/`)، فخلي Profile المدرسة مستقل.

---

إذا أعطيتني الآن **ملفات auth الحالية** (أسماءها موجودة عندك):

* `school-auth.service.ts`
* `school-jwt.strategy.ts`
* `current-user.decorator.ts`
* `school-context.guard.ts`

سأعطيك مباشرة:

* أسماء الملفات النهائية + محتوى كل ملف (Controller/Service/DTO/Module) بنفس ستايل مشروعك وأكواد الأخطاء.
