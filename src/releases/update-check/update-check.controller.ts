import { Controller, Post, Body } from '@nestjs/common';
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
  checkUpdate(@Body() dto: CheckUpdateDto) {
    return this.updateCheckService.checkUpdate(dto);
  }
}
