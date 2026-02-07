import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  console.log(`🚀 Server is running on port ${port}`);
}
bootstrap();