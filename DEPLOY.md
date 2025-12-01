
---


```md
# 🚀 Deployment Guide – Asas Backend

هذه الوثيقة توضح خطوات رفع التحديثات إلى بيئة الإنتاج في Hostinger (Ubuntu + aaPanel).

---

## 📁 1) الدخول إلى مجلد المشروع

```bash
cd /www/node-projects/asas_backend


---

🔄 2) سحب آخر تحديثات GitHub

git pull origin main

إن كان الفرع مختلفًا:

git pull origin dev


---

📦 3) تثبيت التبعيات (اختياري)

npm install


---

🗄️ 4) تحديث Prisma (عند تعديل قاعدة البيانات فقط)

npx prisma generate
npx prisma migrate deploy


---

🏭 5) بناء مشروع NestJS

npm run build


---

🚀 6) إعادة تشغيل PM2

pm2 restart asas_backend

للتحقق:

pm2 status


---

📜 7) تفقد السجلات

pm2 logs asas_backend

لإيقاف السجلات:

CTRL + C


---

🎯 8) ملاحظة مهمة

لا حاجة لتعديل الإعدادات داخل aaPanel — المشروع يعمل من خلال PM2 فقط.
كل عملية نشر تتبع نفس الخطوات:

1. git pull


2. npm install


3. npm run build


4. pm2 restart asas_backend




---

🆘 مشاكل شائعة

❌ بعد التشغيل يظهر Error

افحص السجلات:

pm2 logs asas_backend

❌ Prisma client not found

npx prisma generate

❌ Migration failed

ربما يوجد تعديل غير مكتمل — راجع ملف schema.prisma.


---

