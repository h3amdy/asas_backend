// src/public/student-registration/registration-data.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { REGISTRATION_CONFIG, REGISTRATION_ERRORS } from './registration.constants';

/**
 * G5-A — بيانات مرجعية للتسجيل الذاتي
 * قراءة فقط، بدون auth
 */
@Injectable()
export class RegistrationDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * جميع المحافظات (مرتبة)
   */
  async getProvinces() {
    const provinces = await this.prisma.province.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
    return provinces;
  }

  /**
   * مديريات محافظة معينة (مرتبة)
   * يتحقق أن المحافظة موجودة
   */
  async getDistricts(provinceId: number) {
    const province = await this.prisma.province.findUnique({
      where: { id: provinceId },
      select: { id: true },
    });
    if (!province) {
      throw new NotFoundException(REGISTRATION_ERRORS.PROVINCE_NOT_FOUND);
    }

    const districts = await this.prisma.district.findMany({
      where: { provinceId },
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
    return districts;
  }

  /**
   * الصفوف النشطة في مدرسة مفهوم فقط
   * Contract invariant: يعيد فقط صفوف مدرسة مفهوم النشطة
   */
  async getRegistrationGrades() {
    const mafhoomSchool = await this.prisma.school.findFirst({
      where: {
        schoolCode: REGISTRATION_CONFIG.mafhoomSchoolCode,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (!mafhoomSchool) {
      throw new NotFoundException(REGISTRATION_ERRORS.MAFHOOM_SCHOOL_NOT_FOUND);
    }

    const grades = await this.prisma.schoolGrade.findMany({
      where: {
        schoolId: mafhoomSchool.id,
        isActive: true,
        isDeleted: false,
      },
      select: { id: true, displayName: true },
      orderBy: { sortOrder: 'asc' },
    });
    return grades;
  }
}
