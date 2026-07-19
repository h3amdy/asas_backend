import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppDto } from '../dto/create-app.dto';
import { UpdateAppDto } from '../dto/update-app.dto';

@Injectable()
export class AppsService {
  constructor(private prisma: PrismaService) {}

  /** قائمة التطبيقات مع آخر إصدار وعدد الأجهزة */
  async findAll() {
    const apps = await this.prisma.app.findMany({
      where: { isDeleted: false },
      include: {
        school: { select: { id: true, name: true, schoolCode: true } },
        releases: {
          where: { isDeleted: false, status: 'PUBLISHED' },
          orderBy: { versionCode: 'desc' },
          take: 1,
          select: {
            uuid: true,
            versionName: true,
            versionCode: true,
            status: true,
            publishedAt: true,
          },
        },
        _count: {
          select: {
            releases: { where: { isDeleted: false } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // عدد الأجهزة لكل تطبيق
    const deviceCounts = await this.prisma.deviceInstallation.groupBy({
      by: ['appCode'],
      _count: { id: true },
    });
    const deviceMap = new Map(
      deviceCounts.map((d) => [d.appCode, d._count.id]),
    );

    return apps.map((app) => ({
      ...app,
      latestRelease: app.releases[0] || null,
      releases: undefined,
      deviceCount: deviceMap.get(app.code) || 0,
      releaseCount: app._count.releases,
      _count: undefined,
    }));
  }

  /** تفاصيل تطبيق واحد */
  async findOne(uuid: string) {
    const app = await this.prisma.app.findUnique({
      where: { uuid },
      include: {
        school: { select: { id: true, name: true, schoolCode: true } },
        releases: {
          where: { isDeleted: false },
          orderBy: { versionCode: 'desc' },
          include: {
            distributions: true,
            _count: {
              select: { deviceInstallations: true },
            },
          },
        },
      },
    });

    if (!app || app.isDeleted) {
      throw new NotFoundException('التطبيق غير موجود');
    }

    return app;
  }

  /** إنشاء تطبيق جديد */
  async create(dto: CreateAppDto) {
    // التحقق من عدم تكرار الكود
    const existing = await this.prisma.app.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`التطبيق بالكود "${dto.code}" موجود مسبقاً`);
    }

    // التحقق من المدرسة إن وُجدت
    if (dto.schoolId) {
      const school = await this.prisma.school.findUnique({
        where: { id: dto.schoolId },
      });
      if (!school) {
        throw new NotFoundException('المدرسة غير موجودة');
      }
    }

    return this.prisma.app.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        appType: dto.appType as any,
        packageName: dto.packageName,
        bundleId: dto.bundleId,
        schoolId: dto.schoolId,
        platforms: (dto.platforms as any) || ['ANDROID'],
      },
      include: {
        school: { select: { id: true, name: true, schoolCode: true } },
      },
    });
  }

  /** تعديل تطبيق */
  async update(uuid: string, dto: UpdateAppDto) {
    const app = await this.prisma.app.findUnique({ where: { uuid } });
    if (!app || app.isDeleted) {
      throw new NotFoundException('التطبيق غير موجود');
    }

    // التحقق من عدم تكرار الكود إن تغيّر
    if (dto.code && dto.code !== app.code) {
      const existing = await this.prisma.app.findUnique({
        where: { code: dto.code },
      });
      if (existing) {
        throw new ConflictException(
          `التطبيق بالكود "${dto.code}" موجود مسبقاً`,
        );
      }
    }

    return this.prisma.app.update({
      where: { uuid },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.appType !== undefined && { appType: dto.appType as any }),
        ...(dto.packageName !== undefined && { packageName: dto.packageName }),
        ...(dto.bundleId !== undefined && { bundleId: dto.bundleId }),
        ...(dto.schoolId !== undefined && { schoolId: dto.schoolId }),
        ...(dto.platforms !== undefined && {
          platforms: dto.platforms as any,
        }),
        ...(dto.status !== undefined && { status: dto.status as any }),
      },
      include: {
        school: { select: { id: true, name: true, schoolCode: true } },
      },
    });
  }
}
