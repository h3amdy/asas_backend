// src/common/middleware/request-logger.middleware.ts
//
// Phase 2: Middleware لتسجيل الطلبات مع Request ID
// يسجل: request_id, method, path, status, duration
// لا يسجل: Authorization, body, cookies, personal data

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';

const SAFE_REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('API');

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();

    // قراءة X-Request-ID من Flutter أو إنشاء واحد بعد التحقق الصارم (SEC-LOG-01)
    const requestId = this.resolveRequestId(req.headers['x-request-id']);

    // حفظ الـ request_id في الـ request object للاستخدام لاحقاً
    (req as any).requestId = requestId;

    // تسجيل عند اكتمال الاستجابة
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { method, originalUrl } = req;

      // تنظيف الـ path — حذف query params من endpoints حساسة ومنع حقن السجلات
      const safeMethod = String(method || '').replace(/[\r\n\x00-\x1f\x7f]/g, '');
      const cleanPath = this.sanitizePath(originalUrl || '');

      this.logger.log(
        `[${requestId}] ${safeMethod} ${cleanPath} → ${res.statusCode} (${duration}ms)`,
      );
    });

    next();
  }

  private resolveRequestId(rawHeader: string | string[] | undefined): string {
    const candidate = typeof rawHeader === 'string' ? rawHeader : undefined;
    if (candidate && SAFE_REQUEST_ID_REGEX.test(candidate)) {
      return candidate;
    }
    return this.generateId();
  }

  private sanitizePath(url: string): string {
    const cleaned = String(url).replace(/[\r\n\x00-\x1f\x7f]/g, '');
    // حذف query parameters من endpoints حساسة
    const sensitivePatterns = ['/auth/', '/profile/'];
    for (const pattern of sensitivePatterns) {
      if (cleaned.includes(pattern)) {
        return cleaned.split('?')[0]; // path فقط
      }
    }
    return cleaned;
  }

  private generateId(): string {
    return randomBytes(4).toString('hex');
  }
}
