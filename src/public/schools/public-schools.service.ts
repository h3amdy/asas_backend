// src/public/schools/public-schools.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicSchoolDto } from './dto/public-school.dto';
import { SCHOOL_AUTH_ERRORS } from '../../school/auth/constants';
import { SCHOOL_LOGIN_ROLES, parseUserCode } from '../../common/user-code/user-code.policy';

/** استجابة واحدة لكل حالات الفشل — لا تميّز «صيغة خاطئة» عن «رقم غير موجود» */
const USER_CODE_SCHOOL_NOT_FOUND = {
  code: 'SCHOOL_NOT_FOUND',
  message: 'لم يتم العثور على مدرسة مرتبطة بهذا الرقم',
};

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
      logoMediaAssetUuid: s.logoMediaAsset?.uuid ?? null,
      primaryColor: s.primaryColor ?? null,
      secondaryColor: s.secondaryColor ?? null,
      backgroundColor: s.backgroundColor ?? null,
    };
  }

  async searchSchools(q?: string, limit = 10, province?: string): Promise<{ items: PublicSchoolDto[] }> {
    const query = (q ?? '').trim();

    // Guard: يجب وجود q أو province على الأقل
    if (!query && !province) {
      throw new BadRequestException('q or province is required');
    }

    // إذا وجد q يجب أن يكون >= 2 أحرف
    if (query && query.length < 2) {
      throw new BadRequestException('q must be at least 2 characters');
    }

    const take = Math.min(Math.max(limit ?? 10, 1), 50);

    // بناء where clause ديناميكي
    const where: any = {
      isDeleted: false,
      isActive: true,
    };

    // province filter
    if (province) {
      where.province = province;
    }

    // text search — فقط عند وجود q
    if (query) {
      where.OR = [
        { displayName: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.school.findMany({
      where,
      take,
      orderBy: [{ displayName: 'asc' }],
      select: {
        uuid: true,
        displayName: true,
        name: true,
        schoolCode: true,
        appType: true,

        phone: true,
        email: true,
        province: true,
        district: true,
        addressArea: true,
        address: true,

        logoMediaAssetId: true,
        logoMediaAsset: { select: { uuid: true } },
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
        logoMediaAsset: { select: { uuid: true } },
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
      where: { uuid, isDeleted: false },
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
        logoMediaAsset: { select: { uuid: true } },
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

  /**
   * «نسيت بيانات الدخول» بالرقم المدرسي (SRS-SCH-NUM-001 §4.4 — FR-NUM-012 / SR-NUM-003)
   * GET /public/schools/by-user-code/:code
   *
   * - يُرجع بيانات تواصل المدرسة العامة فقط { uuid, name, phone } — لا أي حقل يخص المستخدم.
   * - OWNER مستبعد بالدور، والمدرسة المحذوفة = غير موجودة.
   * - كل حالات الفشل تُرجع نفس 404 بنفس الرسالة.
   * ملاحظة: نجاح الاستعلام يكشف بطبيعته أن الرقم مرتبط بمدرسة؛ الحماية من التعداد هنا
   * هي Rate Limiting على المتحكم + عدم إرجاع أي بيانات شخصية (قرار SRS §7).
   */
  async getSchoolContactByUserCode(raw: string): Promise<{ uuid: string; name: string; phone: string | null }> {
    const code = parseUserCode(raw);
    if (code === null) throw new NotFoundException(USER_CODE_SCHOOL_NOT_FOUND);

    const user = await this.prisma.user.findFirst({
      where: {
        code,
        userType: { in: [...SCHOOL_LOGIN_ROLES] },
        isDeleted: false,
      },
      select: {
        school: {
          select: { uuid: true, name: true, displayName: true, phone: true, isDeleted: true },
        },
      },
    });

    if (!user?.school || user.school.isDeleted) {
      throw new NotFoundException(USER_CODE_SCHOOL_NOT_FOUND);
    }

    return {
      uuid: user.school.uuid,
      name: user.school.displayName ?? user.school.name,
      phone: user.school.phone ?? null,
    };
  }

  /**
   * جلب قائمة المحافظات المتاحة (DISTINCT)
   * GET /public/schools/provinces
   */
  async getDistinctProvinces(): Promise<{ provinces: string[] }> {
    const rows = await this.prisma.school.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        province: { not: null },
      },
      select: { province: true },
      distinct: ['province'],
      orderBy: { province: 'asc' },
    });
    return { provinces: rows.map((r) => r.province!).filter(Boolean) };
  }
}
