// src/common/middleware/request-logger.middleware.ts
//
// Phase 2: Middleware لتسجيل الطلبات مع Request ID
// يسجل: request_id, method, path, status, duration
// لا يسجل: Authorization, body, cookies, personal data

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('API');

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    // قراءة X-Request-ID من Flutter أو إنشاء واحد
    const requestId =
      (req.headers['x-request-id'] as string) || this.generateId();

    // حفظ الـ request_id في الـ request object للاستخدام لاحقاً
    (req as any).requestId = requestId;

    // تسجيل عند اكتمال الاستجابة
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { method, originalUrl } = req;

      // تنظيف الـ path — حذف query params من endpoints حساسة
      const cleanPath = this.sanitizePath(originalUrl);

      this.logger.log(
        `[${requestId}] ${method} ${cleanPath} → ${res.statusCode} (${duration}ms)`,
      );
    });

    next();
  }

  private sanitizePath(url: string): string {
    // حذف query parameters من endpoints حساسة
    const sensitivePatterns = ['/auth/', '/profile/'];
    for (const pattern of sensitivePatterns) {
      if (url.includes(pattern)) {
        return url.split('?')[0]; // path فقط
      }
    }
    return url;
  }

  private generateId(): string {
    return Math.random().toString(16).substring(2, 10);
  }
}
