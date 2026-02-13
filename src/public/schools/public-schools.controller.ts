// src/public/schools/public-schools.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PublicSchoolsService } from './public-schools.service';
import { SearchSchoolsQueryDto } from './dto/search-schools.query';
import { VerifySchoolCodeDto } from './dto/verify-school-code.dto';

@Controller('public/schools')
export class PublicSchoolsController {
  constructor(private readonly publicSchoolsService: PublicSchoolsService) { }

  // GET /public/schools/search?q=النور&limit=10
  @Get('search')
  async search(@Query() query: SearchSchoolsQueryDto) {
    return this.publicSchoolsService.searchByName(query.q, query.limit ?? 10);
  }

  // POST /public/schools/verify-code  { "schoolCode": 1001 }
  @Post('verify-code')
  async verifyCode(@Body() body: VerifySchoolCodeDto) {
    return this.publicSchoolsService.verifyBySchoolCode(body.schoolCode);
  }

  // GET /public/schools/:uuid/profile
  @Get(':uuid/profile')
  async getProfile(@Param('uuid') uuid: string) {
    return this.publicSchoolsService.getProfile(uuid);
  }
}
