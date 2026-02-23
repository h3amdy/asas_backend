
---


```md
# 🚀 Deployment Guide – Asas Backend

هذه الوثيقة توضح خطوات رفع التحديثات إلى بيئة الإنتاج في Hostinger (Ubuntu + aaPanel).

---

## 📁 1) الدخول إلى مجلد المشروع

```bash
cd /www/node-projects/asas-backend


---

🔄 2) سحب آخر تحديثات GitHub

git pull origin main




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

pm2 restart asas-backend

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

الدخول إلى اوامر قاعدة البيانات
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod
أو خيار افضل دخول مع تحكم 
 sudo -i -u postgres
 
 اظهار جداول قاعدة البيانات بعد الدخول 
  \dt
  إظهار حقول جدول 
  \d "User"
  # التأكد من قاعدة البيانات الحالية 
  SELECT current_database();

  £ اخذ نسخة احتياطية 
  pg_dump -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -Fc -f asasprod_backup.dump
# التأكد من السخة الاحتياطية 
 -lh asasprod_backup.dump
 تظهر 
 -rw-r--r-- 1 root root 19K Feb  9 18:27 asasprod_backup.dump

 الرمز السري لقاعجة البيانات asaar_olld
 XMrXJYmiGNnp
---

