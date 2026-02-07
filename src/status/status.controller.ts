// src/status/status.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { StatusService } from './status.service';
import { SchoolJwtAuthGuard } from '../school/auth/guards/school-jwt-auth.guard';

/**
 * 🚦 متحكم الحالة (Boot Gate + Account Gate)
 * يُستخدم من جميع التطبيقات للتحقق من حالة المدرسة/المستخدم
 */
@Controller('status')
export class StatusController {
    constructor(private readonly statusService: StatusService) { }

    /**
     * ✅ Boot Gate (Public - بدون JWT)
     * GET /api/v1/status/schools/:uuid
     * التحقق من حالة المدرسة (موجودة؟ مفعّلة؟ نوعها؟)
     */
    @Get('schools/:uuid')
    async schoolStatus(@Param('uuid') uuid: string) {
        return this.statusService.getSchoolStatus(uuid);
    }

    /**
     * ✅ Account Gate (Protected by School JWT)
     * GET /api/v1/status/me
     * التحقق من حالة حسابي ومدرستي بعد تسجيل الدخول
     */
    @UseGuards(SchoolJwtAuthGuard)
    @Get('me')
    async me(@Req() req: any) {
        // req.user coming from JWT strategy: { sub, sc, ut, uc? }
        return this.statusService.getMyStatus(req.user);
    }
}
