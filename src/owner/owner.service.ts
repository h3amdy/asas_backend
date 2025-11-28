// src/owner/owner.service.ts
import { Injectable } from '@nestjs/common';
import { SchoolsService } from '../schools/schools.service';

@Injectable()
export class OwnerService {
  constructor(private readonly schoolsService: SchoolsService) {}

  // لوحة التحكم: ملخص + قائمة مبسطة للمدارس
 async getDashboardSummary(){
    const stats = await this.schoolsService.getStats();
    const schools =await this.schoolsService.findAll();

    // نرجع نسخة مبسطة من بيانات المدارس (بدون كل التفاصيل)
    const schoolList = schools.map((s) => ({
      uuid: s.uuid,
      name: s.name,
      schoolCode: s.schoolCode,
      appType: s.appType,
      province: s.province,
      phone: s.phone,
      isActive: s.isActive,
      createdAt: s.createdAt,
    }));

    return {
      summary: {
        total_schools: stats.totalSchools,
        active_schools: stats.activeSchools,
        inactive_schools: stats.inactiveSchools,
      },
      schools: schoolList,
    };
  }
}
