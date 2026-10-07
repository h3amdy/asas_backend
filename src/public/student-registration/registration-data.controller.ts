// src/public/student-registration/registration-data.controller.ts
import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { RegistrationDataService } from './registration-data.service';

/**
 * 🌍 API عامة — بيانات مرجعية للتسجيل الذاتي
 * G5-A: provinces, districts, grades
 * لا تحتاج auth
 */
@Controller('public')
export class RegistrationDataController {
  constructor(private readonly dataService: RegistrationDataService) {}

  /**
   * قائمة المحافظات
   */
  @Get('provinces')
  async getProvinces() {
    return this.dataService.getProvinces();
  }

  /**
   * مديريات محافظة معينة
   */
  @Get('provinces/:id/districts')
  async getDistricts(@Param('id', ParseIntPipe) provinceId: number) {
    return this.dataService.getDistricts(provinceId);
  }

  /**
   * الصفوف النشطة في مدرسة مفهوم فقط
   */
  @Get('registration/grades')
  async getRegistrationGrades() {
    return this.dataService.getRegistrationGrades();
  }
}
