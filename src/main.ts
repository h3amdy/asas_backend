// 🛡️ STG-001: تحميل .env قبل أي شيء آخر — مطلوب لأن PM2 يشغّل node dist/main.js مباشرة
import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { validateEnvironment } from './config/environment-safety';

// ── BigInt → JSON: Prisma يُرجع BigInt لكن JSON.stringify لا يدعمه ──
// eslint-disable-next-line no-extend-native
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
async function bootstrap() {
  // 🛡️ STG-001: التحقق من سلامة الإعدادات قبل بدء التطبيق
  validateEnvironment();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('raw', { limit: '100mb' });

  // ✅ تفعيل CORS عشان Flutter (وحتى لو صار عندك Web)
  app.enableCors({
    origin: '*', // لاحقاً ممكن نحدد الدومينات بدلاً من النجمة
  });

  // ✅ إضافة prefix لجميع الـ routes
  app.setGlobalPrefix('api/v1');

  // ✅ تفعيل الـ ValidationPipe زي ما هو
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // يحذف الحقول الزيادة
      forbidNonWhitelisted: true, // يرمي خطأ لو فيه حقل مش معروف
      transform: true,            // يحول body إلى DTO تلقائياً
    }),
  );

  // ✅ قراءة البورت من env (مهم للـ VPS)
  const port = process.env.PORT || 3000;
  await app.listen(port);

  const appEnv = process.env.APP_ENV || 'unknown';
  console.log(`🚀 Server is running on port ${port} [${appEnv}]`);
}
bootstrap();