import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UpdateCheckService } from './update-check.service';
import { CheckUpdateDto } from '../dto/check-update.dto';

/**
 * Public endpoint — بدون Authentication
 * يُستخدم من تطبيق المدارس لفحص التحديثات عند كل تشغيل
 */
@Controller('public/app')
export class UpdateCheckController {
  constructor(private readonly updateCheckService: UpdateCheckService) {}

  @Post('check-update')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60_000, limit: 30 },
    long: { ttl: 3_600_000, limit: 300 },
  })
  checkUpdate(@Body() dto: CheckUpdateDto) {
    return this.updateCheckService.checkUpdate(dto);
  }
}
