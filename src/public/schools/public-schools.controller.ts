// src/public/schools/public-schools.controller.ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicSchoolsService } from './public-schools.service';
import { SearchSchoolsQueryDto } from './dto/search-schools.query';
import { VerifySchoolCodeDto } from './dto/verify-school-code.dto';

@Controller('public/schools')
export class PublicSchoolsController {
  constructor(private readonly publicSchoolsService: PublicSchoolsService) { }

  // GET /public/schools/search?q=النور&limit=10&province=تعز
  // q اختياري عند وجود province
  @Get('search')
  async search(@Query() query: SearchSchoolsQueryDto) {
    return this.publicSchoolsService.searchSchools(query.q, query.limit ?? 10, query.province);
  }

  // POST /public/schools/verify-code  { "schoolCode": 1001 }
  @Post('verify-code')
  async verifyCode(@Body() body: VerifySchoolCodeDto) {
    return this.publicSchoolsService.verifyBySchoolCode(body.schoolCode);
  }

  // GET /public/schools/provinces
  @Get('provinces')
  async getProvinces() {
    return this.publicSchoolsService.getDistinctProvinces();
  }

  // GET /public/schools/by-user-code/2284844
  // «نسيت بيانات الدخول» — اسم المدرسة وهاتفها العام فقط (SRS-SCH-NUM-001 §4.4 / SR-NUM-003)
  // 🛡️ ThrottlerGuard إلزامي: 5/دقيقة + 20/ساعة لكل IP
  @Get('by-user-code/:code')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  async getSchoolContactByUserCode(@Param('code') code: string) {
    return this.publicSchoolsService.getSchoolContactByUserCode(code);
  }

  // GET /public/schools/:uuid/profile
  @Get(':uuid/profile')
  async getProfile(@Param('uuid') uuid: string) {
    return this.publicSchoolsService.getProfile(uuid);
  }
}

