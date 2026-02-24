# 📚 Asas Backend — نظرة عامة

> هذا الملف يشرح بنية السيرفر بشكل عام. للتفاصيل التقنية راجع:
> - [OWNER_API.md](./OWNER_API.md) — لوحة المالك
> - [SCHOOL_API.md](./SCHOOL_API.md) — مستخدمو المدرسة
> - [MANAGER_README.md](./MANAGER_README.md) — ملخص سريع لـ Manager
> - [ACADEMIC_SETUP_README.md](./ACADEMIC_SETUP_README.md) — مرجع Flutter للتهيئة الأكاديمية

---

## 📋 ما هو Asas Backend؟

**Asas Backend** هو خادم REST API لإدارة المدارس، مبني باستخدام:

| التقنية | الوصف |
|---------|-------|
| **NestJS** | إطار عمل Node.js |
| **TypeScript** | لغة البرمجة |
| **Prisma** | ORM لقاعدة البيانات |
| **PostgreSQL** | قاعدة البيانات |
| **JWT** | للمصادقة والتوكنات |
| **bcrypt** | لتشفير كلمات المرور |

---

## 🏗️ بنية الوحدات

```
src/
├── owner/          👑 لوحة المالك (Auth + Schools + Grades + Sync)
├── school/         🏫 وحدة المدرسة
│   ├── auth/           🔐 مصادقة مستخدمي المدرسة
│   ├── profile/        👤 الملف الشخصي
│   ├── sessions/       🔄 إدارة الجلسات
│   ├── manager/        🏫 إدارة المدير (ADMIN فقط)
│   │   ├── school-info/
│   │   ├── grades/         إدارة الصفوف والشُعب
│   │   ├── academic-years/ إدارة السنوات والفصول
│   │   ├── students/
│   │   ├── parents/
│   │   ├── teachers/
│   │   ├── subjects/
│   │   └── setup/          التهيئة الأولى (Wizard)
│   └── common/         🔧 Guards + Decorators
├── status/         🚦 Boot & Account Gates
├── public/         🌍 بحث المدارس (بدون مصادقة)
└── prisma/         🔗 خدمة Prisma
```

---

## 🔑 نظام المصادقة

### المالك (Owner)
- JWT بسيط: `POST /auth/owner/login` → `{ token }`
- حماية: `@UseGuards(JwtAuthGuard)` خاص بالمالك

### مستخدمو المدرسة (School Users)
- JWT مع جلسات: `POST /school/auth/login` → `{ accessToken, refreshToken, sessionId }`
- تدوير Refresh Token مع كل تجديد
- حماية: `SchoolJwtAuthGuard` + `SchoolContextGuard` + `RolesGuard`

### فحوصات الجلسة التلقائية

كل request محمي يتحقق من:
1. ✅ الجلسة موجودة وغير ملغية
2. ✅ الجلسة لم تنتهِ
3. ✅ المستخدم نشط وغير محذوف
4. ✅ المدرسة نشطة وغير محذوفة
5. ✅ الجهاز نشط
6. ✅ تطابق بيانات التوكن مع الجلسة

---

## 🚦 Gates (بوابات التحقق)

| البوابة | الـ Endpoint | الغرض |
|---------|-------------|-------|
| **Boot Gate** | `GET /status/schools/:uuid` | هل المدرسة موجودة ونشطة؟ (قبل Login) |
| **Account Gate** | `GET /status/me` | هل حسابي ومدرستي نشطين؟ (بعد Login) |
| **Setup Gate** | `GET /school/manager/setup/status` | هل المدرسة مهيأة أكاديمياً؟ (Wizard vs Dashboard) |

---

## 🛡️ حارس سياق المدرسة (SchoolContextGuard)

كل endpoints المدرسة المحمية تتطلب:
- `Authorization: Bearer <accessToken>` (Header)
- `x-school-uuid: <uuid>` (Header)

يطابق الـ Guard بين UUID في الـ Header و JWT. يحفظ السياق في `req.schoolContext`.

---

## 📝 قواعد عامة

| القاعدة | التطبيق |
|---------|---------|
| **Soft Delete** | كل الحذف عبر `isDeleted + deletedAt` |
| **UUID** | كل جدول لديه `uuid` فريد للاستخدام في الـ API |
| **Timestamps** | `createdAt` + `updatedAt` تلقائي |
| **Base URL** | `http://localhost:3000/api/v1` |
| **Validation** | `class-validator` + `ValidationPipe` عام |
| **Transactions** | العمليات الحرجة محمية بـ `$transaction` |

---

## 🚀 تشغيل المشروع

```bash
npm install            # تثبيت المكتبات
npm run prisma:migrate # تشغيل الهجرات
npm run start:dev      # وضع التطوير
npm run build && npm run start:prod  # الإنتاج
```

## ⚙️ المتغيرات البيئية (.env)

```env
DATABASE_URL="postgresql://user:password@localhost:5432/asas_db"
JWT_SECRET="your-secret-key"
PORT=3000
```
