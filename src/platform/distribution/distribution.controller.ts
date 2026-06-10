// src/platform/distribution/distribution.controller.ts
import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { CreateDistributionDto } from './dto/create-distribution.dto';
import { DistributionQueryDto } from './dto/distribution-query.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';

/**
 * 📤 Platform Distribution Controller
 * توزيع المحتوى على المدارس — منصة المحتوى
 */
@Controller('platform')
@UseGuards(PlatformJwtAuthGuard)
export class DistributionController {
    constructor(private readonly service: DistributionService) {}

    /** POST — توزيع دروس على مدارس */
    @Post('distribute')
    distribute(@Req() req: any, @Body() dto: CreateDistributionDto) {
        return this.service.distribute(req.user.sub, dto);
    }

    /** GET — سجل التوزيعات (مع فلاتر) */
    @Get('distributions')
    getDistributions(@Req() req: any, @Query() query: DistributionQueryDto) {
        return this.service.getDistributions(req.user.sub, query);
    }

    /** GET — ملخص التوزيعات لكل مدرسة */
    @Get('distributions/summary')
    getSummary(@Req() req: any) {
        return this.service.getSummary(req.user.sub);
    }

    /** GET — أرشيف عمليات التوزيع */
    @Get('distributions/batches')
    getBatches(@Req() req: any) {
        return this.service.getBatches(req.user.sub);
    }
}
