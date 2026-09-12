// src/common/health/health.controller.ts
//
// Phase 2: Health endpoint بسيط — هل يستطيع الجهاز الوصول للـ VPS؟
// بدون authentication, بدون database query

import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
