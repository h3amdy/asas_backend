// srs/owner/admins/admins.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { AdminsService } from './admins.service';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { UpdateAdminStatusDto } from './dto/update-admin-status.dto';

@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) { }

  // كل المدراء
  @Get()
  findAll() {
    return this.adminsService.findAll();
  }

  // مدراء مدرسة معيّنة
  @Get('by-school/:uuid')
  findBySchool(@Param('uuid') uuid: string) {
    return this.adminsService.findBySchool(uuid);
  }



  // تحديث مدير
  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateAdminDto) {
    return this.adminsService.update(uuid, dto);
  }

  // تغيير حالة مدير (تفعيل/إيقاف)
  @Patch(':uuid/status')
  updateStatus(
    @Param('uuid') uuid: string,
    @Body() dto: UpdateAdminStatusDto,
  ) {
    return this.adminsService.updateStatus(uuid, dto.isActive);
  }
}