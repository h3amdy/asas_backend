// src/public/schools/public-schools.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicSchoolDto } from './dto/public-school.dto';
import { SCHOOL_AUTH_ERRORS } from '../../school/auth/constants';

@Injectable()
export class PublicSchoolsService {
  constructor(private readonly prisma: PrismaService) { }

  private toDto(s: any): PublicSchoolDto {
    return {
      uuid: s.uuid,
      displayName: s.displayName,
      schoolCode: s.schoolCode,
      appType: s.appType,
      isActive: s.isActive,

      phone: s.phone ?? null,
      email: s.email ?? null,

      province: s.province ?? null,
      district: s.district ?? null,
      addressArea: s.addressArea ?? null,
      address: s.address ?? null,

      educationType: s.educationType ?? null,
      deliveryPolicy: s.deliveryPolicy,

      logoMediaAssetId: s.logoMediaAssetId ?? null,
      primaryColor: s.primaryColor ?? null,
      secondaryColor: s.secondaryColor ?? null,
      backgroundColor: s.backgroundColor ?? null,
    };
  }

  async searchByName(q: string, limit = 10): Promise<{ items: PublicSchoolDto[] }> {
    const query = (q ?? '').trim();
    if (query.length < 2) throw new BadRequestException('q must be at least 2 characters');

    const take = Math.min(Math.max(limit ?? 10, 1), 50);

    const rows = await this.prisma.school.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        appType: 'PUBLIC',
        OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          // OPTIONAL: لو تريد دعم البحث بـ name الرسمي (لكن لا ترجعه)
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      take,
      orderBy: [{ displayName: 'asc' }],
      select: {
        uuid: true,
        displayName: true,
        name: true, // فقط للبحث (حتى لو ما تستخدمه في dto)
        schoolCode: true,
        appType: true,

        phone: true,
        email: true,
        province: true,
        district: true,
        addressArea: true,
        address: true,

        logoMediaAssetId: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
        educationType: true,
        deliveryPolicy: true,
        isActive: true,
      },
    });

    return { items: rows.map((s) => this.toDto(s)) };
  }

  async verifyBySchoolCode(schoolCode: number): Promise<{ school: PublicSchoolDto }> {
    if (!Number.isInteger(schoolCode) || schoolCode <= 0) {
      throw new BadRequestException('schoolCode must be a positive integer');
    }

    const school = await this.prisma.school.findFirst({
      where: {
        isDeleted: false,
        isActive: true,
        appType: 'PUBLIC',
        schoolCode,
      },
      select: {
        uuid: true,
        displayName: true,
        name: true, // لا نرجعه
        schoolCode: true,
        appType: true,

        phone: true,
        email: true,
        province: true,
        district: true,
        addressArea: true,
        address: true,

        logoMediaAssetId: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
        educationType: true,
        deliveryPolicy: true,
        isActive: true,
      },
    });

    if (!school) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SCHOOL_NOT_FOUND);
    return { school: this.toDto(school) };
  }

  /**
   * ملف المدرسة (بدون شرط isActive — حتى لو موقوفة)
   * GET /public/schools/:uuid/profile
   */
  async getProfile(uuid: string): Promise<{ school: PublicSchoolDto; serverTime: string }> {
    const school = await this.prisma.school.findFirst({
      where: { uuid, appType: 'PUBLIC', isDeleted: false },
      select: {
        uuid: true,
        displayName: true,
        name: true,
        schoolCode: true,
        appType: true,
        isActive: true,

        phone: true,
        email: true,
        province: true,
        district: true,
        addressArea: true,
        address: true,

        educationType: true,
        deliveryPolicy: true,

        logoMediaAssetId: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
      },
    });

    if (!school) throw new NotFoundException(SCHOOL_AUTH_ERRORS.SCHOOL_NOT_FOUND);

    return {
      school: this.toDto(school),
      serverTime: new Date().toISOString(),
    };
  }
}
