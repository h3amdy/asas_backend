// src/school/manager/subscription/subscription.controller.ts
import {
    Body, Controller, Delete, Get, Headers, Param, ParseIntPipe,
    Post, Put, Query, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { CodeBatchService } from './code-batch.service';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import {
    CreatePaymentMethodDto, UpdatePaymentMethodDto, ReorderPaymentMethodsDto,
} from './dto/payment-method.dto';
import { CreateCodeBatchDto, CodeCopiedDto, CodesBulkCopiedDto } from './dto/code-batch.dto';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('school/manager/subscription')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, RolesGuard)
@Roles('ADMIN')
export class SubscriptionController {
    constructor(
        private readonly service: SubscriptionService,
        private readonly codeBatchService: CodeBatchService,
    ) {}

    /** req.user.sub هو UUID — أعمدة الفاعل في القاعدة Int */
    private actorId(req: any): Promise<number> {
        return this.service.resolveActorUserId(req.schoolContext.id, req.user.sub);
    }

    // ═══════════════════════════════════════════════════════════
    // المرحلة 2: الإعدادات والتفعيل وطرق الدفع
    // ═══════════════════════════════════════════════════════════

    @Get('settings')
    getSettings(@Req() req: any) {
        return this.service.getSettings(req.schoolContext.id);
    }

    @Post('activate')
    @HttpCode(HttpStatus.CREATED)
    async activate(
        @Req() req: any,
        @Body() dto: ActivateSubscriptionDto,
        @Headers('x-idempotency-key') idempotencyKey?: string,
    ) {
        return this.service.activateSubscription(
            req.schoolContext.id,
            await this.actorId(req),
            dto,
            idempotencyKey,
        );
    }

    @Put('settings')
    updateSettings(@Req() req: any, @Body() dto: UpdateSettingsDto) {
        return this.service.updateSettings(req.schoolContext.id, dto);
    }

    // ─── Payment Methods ───────────────────────────────────────

    @Get('payment-methods')
    listPaymentMethods(@Req() req: any) {
        return this.service.listPaymentMethods(req.schoolContext.id);
    }

    @Post('payment-methods')
    @HttpCode(HttpStatus.CREATED)
    createPaymentMethod(@Req() req: any, @Body() dto: CreatePaymentMethodDto) {
        return this.service.createPaymentMethod(req.schoolContext.id, dto);
    }

    @Put('payment-methods/reorder')
    reorderPaymentMethods(@Req() req: any, @Body() dto: ReorderPaymentMethodsDto) {
        return this.service.reorderPaymentMethods(req.schoolContext.id, dto);
    }

    @Put('payment-methods/:id')
    updatePaymentMethod(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdatePaymentMethodDto,
    ) {
        return this.service.updatePaymentMethod(req.schoolContext.id, id, dto);
    }

    @Delete('payment-methods/:id')
    deletePaymentMethod(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.deletePaymentMethod(req.schoolContext.id, id);
    }

    // ═══════════════════════════════════════════════════════════
    // المرحلة 3: دفعات الرموز
    // ═══════════════════════════════════════════════════════════

    @Post('code-batches')
    @HttpCode(HttpStatus.CREATED)
    async createBatch(
        @Req() req: any,
        @Body() dto: CreateCodeBatchDto,
        @Headers('x-idempotency-key') idempotencyKey?: string,
    ) {
        return this.codeBatchService.createBatch(
            req.schoolContext.id,
            await this.actorId(req),
            dto,
            idempotencyKey,
        );
    }

    @Get('code-batches')
    listBatches(
        @Req() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.codeBatchService.listBatches(
            req.schoolContext.id,
            page ? +page : undefined,
            limit ? +limit : undefined,
        );
    }

    @Get('code-batches/:id')
    getBatchDetail(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.codeBatchService.getBatchDetail(req.schoolContext.id, id);
    }

    @Get('code-batches/:id/unused-codes')
    getUnusedCodes(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.codeBatchService.getUnusedCodes(
            req.schoolContext.id, id,
            page ? +page : undefined,
            limit ? +limit : undefined,
        );
    }

    @Get('code-batches/:id/used-codes')
    getUsedCodes(
        @Req() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.codeBatchService.getUsedCodes(
            req.schoolContext.id, id,
            page ? +page : undefined,
            limit ? +limit : undefined,
        );
    }

    // ─── Audit ─────────────────────────────────────────────────

    @Post('audit/code-copied')
    @HttpCode(HttpStatus.OK)
    async logCodeCopied(@Req() req: any, @Body() dto: CodeCopiedDto) {
        return this.codeBatchService.logCodeCopied(
            req.schoolContext.id,
            await this.actorId(req),
            dto.codeId,
        );
    }

    @Post('audit/codes-copied')
    @HttpCode(HttpStatus.OK)
    async logCodesBulkCopied(@Req() req: any, @Body() dto: CodesBulkCopiedDto) {
        return this.codeBatchService.logCodesBulkCopied(
            req.schoolContext.id,
            await this.actorId(req),
            dto.batchId,
            dto.codeIds,
        );
    }

    // ─── بحث الرموز ────────────────────────────────────────────

    @Get('activation-codes')
    searchCodes(
        @Req() req: any,
        @Query('studentUuid') studentUuid?: string,
    ) {
        return this.codeBatchService.searchCodesByStudent(
            req.schoolContext.id,
            studentUuid,
        );
    }
}
