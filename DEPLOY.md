# 🚀 Deployment Guide – Asas Backend

هذه الوثيقة توضح خطوات رفع التحديثات إلى بيئة الإنتاج في Hostinger (Ubuntu + aaPanel).

---

## 🖥️ معلومات بيئة الإنتاج

| العنصر          | القيمة                          |
| --------------- | ------------------------------- |
| Server          | Hostinger VPS                   |
| OS              | Ubuntu 24.04 LTS                |
| Control Panel   | aaPanel                         |
| Process Manager | PM2                             |
| Reverse Proxy   | Nginx (via aaPanel)             |
| Node            | v22.x                           |
| Database        | PostgreSQL                      |
| Framework       | NestJS                          |
| Domain          | https://api.mafhooom.com        |

---

## ✅ 1) التحقق قبل النشر

```bash
cd /www/node-projects/asas-backend

# التأكد من حالة المشروع
git status

# معرفة الفرع الحالي
git branch

# معرفة آخر Commits
git log --oneline -5
```

---

## 🔄 2) سحب آخر تحديثات GitHub

```bash
git pull origin main
```

---

## 📦 3) تثبيت التبعيات

```bash
npm install
```

---

## 🗄️ 4) تحديث Prisma

```bash
npx prisma generate
npx prisma migrate deploy
```

---

## 🏭 5) بناء مشروع NestJS

```bash
npm run build
```

---

## 🚀 6) إعادة تشغيل PM2

```bash
pm2 restart asas-backend
pm2 save
```

> ⚠️ وجود `pm2 save` مهم حتى تبقى العمليات محفوظة بعد إعادة تشغيل السيرفر.

---

## ✅ 7) التحقق بعد النشر

```bash
# التحقق من حالة PM2
pm2 status

# تفقد السجلات
pm2 logs asas-backend
# لإيقاف السجلات: CTRL + C
```

```bash
# التحقق من الاستجابة محليًا
curl http://127.0.0.1:3010/api/v1

# التحقق من الاستجابة عبر الدومين
curl https://api.mafhooom.com/api/v1
```

إذا ظهر `Hello World!` فالسيرفر يعمل بنجاح. ✅

---

## 🎯 8) ملخص خطوات النشر السريعة

كل عملية نشر تتبع نفس الخطوات:

```bash
cd /www/node-projects/asas-backend
git pull origin main
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 restart asas-backend
pm2 save
```

---

## 🔀 Reverse Proxy

> ⚠️ **لا تعدل ملف nginx يدويًا:**
> `/www/server/panel/vhost/nginx/api.mafhooom.com.conf`

أي تعديل على Reverse Proxy يتم من خلال:

```
aaPanel → Website → api.mafhooom.com → Reverse Proxy
```

- **Target URL:** `http://127.0.0.1:3010`

---

## 🔒 SSL

يتم إدارة شهادة SSL بالكامل من aaPanel:

```
aaPanel → Website → api.mafhooom.com → SSL
```

- لا تضف شهادات يدويًا داخل nginx.
- تأكد أن الحالة: **Current Certs → Deployed**

---

## 💾 النسخ الاحتياطي

### نسخة احتياطية من قاعدة البيانات

```bash
pg_dump \
  -h 127.0.0.1 \
  -p 5432 \
  -U asasuser \
  -d asasprod \
  -Fc \
  -f asasprod_$(date +%F).dump
```

### التأكد من النسخة الاحتياطية

```bash
ls -lh asasprod_*.dump
```

### نسخة احتياطية من إعدادات nginx

```bash
tar -czf ~/api-mafhooom-nginx-backup-$(date +%F).tar.gz \
  /www/server/panel/vhost/nginx/api.mafhooom.com.conf \
  /www/server/panel/vhost/nginx/proxy/api.mafhooom.com \
  /www/server/panel/vhost/cert/api.mafhooom.com
```

---

## 🗃️ أوامر قاعدة البيانات المفيدة

```bash
# الدخول إلى قاعدة البيانات
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod

# أو خيار أفضل: دخول مع تحكم كامل
sudo -i -u postgres
```

بعد الدخول:

```sql
-- إظهار جداول قاعدة البيانات
\dt

-- إظهار حقول جدول
\d "User"

-- التأكد من قاعدة البيانات الحالية
SELECT current_database();
```

---

## 🔑 بيانات الاعتماد

> ⚠️ **لا تحفظ كلمات المرور في Git أو في وثائق المشروع.**

بيانات الاعتماد لقاعدة البيانات موجودة في:

```
.env.production
```

أو

```
.env
```

---

## 🆘 مشاكل شائعة

| المشكلة                   | الحل                                          |
| ------------------------- | --------------------------------------------- |
| ❌ Error بعد التشغيل      | `pm2 logs asas-backend`                       |
| ❌ Prisma client not found | `npx prisma generate`                         |
| ❌ Migration failed        | راجع ملف `schema.prisma`                      |
| ❌ SSL لا يعمل             | تأكد من aaPanel → SSL → Deployed              |
| ❌ 502 Bad Gateway         | تأكد من Reverse Proxy → `http://127.0.0.1:3010` |
