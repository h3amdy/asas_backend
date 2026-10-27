// src/school/student/subscription/student-subscription.controller.ts
import {
    Body, Controller, Get, Headers, Post, Req, UseGuards,
    ForbiddenException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { StudentSubscriptionService } from './student-subscription.service';
import { ActivateCodeDto } from './dto/activate-code.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { ParentStudentContextGuard } from '../../common/guards/parent-student-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

/**
 * 🎫 Controller اشتراك الطالب — المرحلة 6
 *
 * Guards: JWT → SchoolContext → ParentStudentContext → Roles(STUDENT)
 *
 * ولي الأمر في وضع X-Student-Context:
 * - GET /my-status → يعمل (يرى حالة ابنه)
 * - GET /payment-info → يعمل
 * - POST /activate → يُرفض 403 (التفعيل من حساب الطالب فقط)
 */
@Controller('school/student/subscription')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, ParentStudentContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentSubscriptionController {
    constructor(private readonly service: StudentSubscriptionService) {}

    // ─── GET /my-status ────────────────────────────────────────

    @Get('my-status')
    async getMyStatus(@Req() req: any) {
        // req.user.sub = UUID الطالب الفعلي (بعد ParentStudentContextGuard)
        return this.service.getMyStatus(req.schoolContext.id, req.user.sub);
    }

    // ─── POST /activate ────────────────────────────────────────

    @Post('activate')
    @HttpCode(HttpStatus.OK)
    async activate(
        @Req() req: any,
        @Body() dto: ActivateCodeDto,
        @Headers('x-idempotency-key') idempotencyKey?: string,
    ) {
        // رفض التفعيل من سياق ولي الأمر
        if (req.originalParentSub) {
            throw new ForbiddenException('PARENT_CANNOT_ACTIVATE_CODE');
        }

        return this.service.activateCode(
            req.schoolContext.id,
            req.user.sub, // UUID الطالب
            dto,
            idempotencyKey,
        );
    }

    // ─── GET /payment-info ─────────────────────────────────────

    @Get('payment-info')
    async getPaymentInfo(@Req() req: any) {
        return this.service.getPaymentInfo(req.schoolContext.id);
    }
}
