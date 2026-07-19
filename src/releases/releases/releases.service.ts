import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReleaseDto } from '../dto/create-release.dto';
import { UpdateReleaseDto } from '../dto/update-release.dto';
import { CreateDistributionDto } from '../dto/create-distribution.dto';

@Injectable()
export class ReleasesService {
  constructor(private prisma: PrismaService) {}

  /** إصدارات تطبيق معين */
  async findByApp(appUuid: string) {
    const app = await this.prisma.app.findUnique({
      where: { uuid: appUuid },
    });
    if (!app || app.isDeleted) {
      throw new NotFoundException('التطبيق غير موجود');
    }

    return this.prisma.release.findMany({
      where: { appId: app.id, isDeleted: false },
      include: {
        distributions: true,
        _count: {
          select: {
            deviceInstallations: true,
            schoolAssignments: { where: { isActive: true } },
          },
        },
      },
      orderBy: { versionCode: 'desc' },
    });
  }

  /** إنشاء إصدار جديد */
  async create(appUuid: string, dto: CreateReleaseDto) {
    const app = await this.prisma.app.findUnique({
      where: { uuid: appUuid },
    });
    if (!app || app.isDeleted) {
      throw new NotFoundException('التطبيق غير موجود');
    }

    // التحقق من عدم تكرار versionCode
    const existing = await this.prisma.release.findUnique({
      where: {
        appId_versionCode: {
          appId: app.id,
          versionCode: dto.versionCode,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `الإصدار بالكود ${dto.versionCode} موجود مسبقاً لهذا التطبيق`,
      );
    }

    return this.prisma.release.create({
      data: {
        appId: app.id,
        versionName: dto.versionName,
        versionCode: dto.versionCode,
        buildNumber: dto.buildNumber,
        channel: (dto.channel as any) || 'STABLE',
        updatePolicy: (dto.updatePolicy as any) || 'OPTIONAL',
        minimumSupportedVersionCode: dto.minimumSupportedVersionCode,
        releaseNotesAr: dto.releaseNotesAr,
        releaseNotesEn: dto.releaseNotesEn,
        checksum: dto.checksum,
      },
      include: { distributions: true },
    });
  }

  /** تعديل إصدار */
  async update(uuid: string, dto: UpdateReleaseDto) {
    const release = await this.prisma.release.findUnique({
      where: { uuid },
    });
    if (!release || release.isDeleted) {
      throw new NotFoundException('الإصدار غير موجود');
    }

    // لا يمكن تعديل إصدار منشور (إلا الملاحظات والسياسة)
    if (release.status === 'PUBLISHED' || release.status === 'DEPRECATED') {
      const allowedFields = [
        'updatePolicy',
        'minimumSupportedVersionCode',
        'releaseNotesAr',
        'releaseNotesEn',
      ];
      const dtoKeys = Object.keys(dto).filter(
        (k) => dto[k] !== undefined,
      );
      const disallowed = dtoKeys.filter((k) => !allowedFields.includes(k));
      if (disallowed.length > 0) {
        throw new BadRequestException(
          `لا يمكن تعديل الحقول التالية لإصدار منشور: ${disallowed.join(', ')}`,
        );
      }
    }

    return this.prisma.release.update({
      where: { uuid },
      data: {
        ...(dto.versionName !== undefined && {
          versionName: dto.versionName,
        }),
        ...(dto.versionCode !== undefined && {
          versionCode: dto.versionCode,
        }),
        ...(dto.buildNumber !== undefined && {
          buildNumber: dto.buildNumber,
        }),
        ...(dto.channel !== undefined && { channel: dto.channel as any }),
        ...(dto.updatePolicy !== undefined && {
          updatePolicy: dto.updatePolicy as any,
        }),
        ...(dto.minimumSupportedVersionCode !== undefined && {
          minimumSupportedVersionCode: dto.minimumSupportedVersionCode,
        }),
        ...(dto.releaseNotesAr !== undefined && {
          releaseNotesAr: dto.releaseNotesAr,
        }),
        ...(dto.releaseNotesEn !== undefined && {
          releaseNotesEn: dto.releaseNotesEn,
        }),
        ...(dto.checksum !== undefined && { checksum: dto.checksum }),
      },
      include: { distributions: true },
    });
  }

  /** تغيير حالة الإصدار: DRAFT → TESTING */
  async setTesting(uuid: string) {
    return this._transition(uuid, ['DRAFT'], 'TESTING');
  }

  /** نشر إصدار: DRAFT/TESTING → PUBLISHED */
  async publish(uuid: string) {
    // ── Publish Validation: يجب أن يوجد Distribution مفعّل واحد على الأقل ──
    const release = await this.prisma.release.findUnique({
      where: { uuid },
      include: {
        distributions: { where: { isEnabled: true } },
      },
    });
    if (!release || release.isDeleted) {
      throw new NotFoundException('الإصدار غير موجود');
    }
    if (release.distributions.length === 0) {
      throw new BadRequestException(
        'لا يمكن نشر إصدار بدون قناة توزيع (Distribution) مفعّلة. أضف رابط تحميل أولاً.',
      );
    }

    return this._transition(uuid, ['DRAFT', 'TESTING'], 'PUBLISHED', {
      publishedAt: new Date(),
    });
  }

  /** إهمال إصدار: PUBLISHED → DEPRECATED */
  async deprecate(uuid: string) {
    return this._transition(uuid, ['PUBLISHED'], 'DEPRECATED');
  }

  /** إلغاء إصدار: أي حالة → REVOKED */
  async revoke(uuid: string) {
    return this._transition(
      uuid,
      ['DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED'],
      'REVOKED',
    );
  }

  /** إضافة قناة توزيع */
  async addDistribution(releaseUuid: string, dto: CreateDistributionDto) {
    const release = await this.prisma.release.findUnique({
      where: { uuid: releaseUuid },
    });
    if (!release || release.isDeleted) {
      throw new NotFoundException('الإصدار غير موجود');
    }

    return this.prisma.releaseDistribution.create({
      data: {
        releaseId: release.id,
        channelType: dto.channelType as any,
        platform: dto.platform as any,
        downloadUrl: dto.downloadUrl,
        fileSize: dto.fileSize ? BigInt(dto.fileSize) : null,
      },
    });
  }

  /** تعديل قناة توزيع */
  async updateDistribution(
    uuid: string,
    data: { downloadUrl?: string; fileSize?: number; isEnabled?: boolean },
  ) {
    const dist = await this.prisma.releaseDistribution.findUnique({
      where: { uuid },
    });
    if (!dist) {
      throw new NotFoundException('قناة التوزيع غير موجودة');
    }

    return this.prisma.releaseDistribution.update({
      where: { uuid },
      data: {
        ...(data.downloadUrl !== undefined && {
          downloadUrl: data.downloadUrl,
        }),
        ...(data.fileSize !== undefined && {
          fileSize: BigInt(data.fileSize),
        }),
        ...(data.isEnabled !== undefined && { isEnabled: data.isEnabled }),
      },
    });
  }

  /** حذف قناة توزيع */
  async deleteDistribution(uuid: string) {
    const dist = await this.prisma.releaseDistribution.findUnique({
      where: { uuid },
    });
    if (!dist) {
      throw new NotFoundException('قناة التوزيع غير موجودة');
    }

    return this.prisma.releaseDistribution.delete({ where: { uuid } });
  }

  // ── Helper: تحويل حالة الإصدار ────────────────────────────────────────
  private async _transition(
    uuid: string,
    allowedFrom: string[],
    to: string,
    extraData: Record<string, any> = {},
  ) {
    const release = await this.prisma.release.findUnique({
      where: { uuid },
    });
    if (!release || release.isDeleted) {
      throw new NotFoundException('الإصدار غير موجود');
    }

    if (!allowedFrom.includes(release.status)) {
      throw new BadRequestException(
        `لا يمكن تحويل الإصدار من "${release.status}" إلى "${to}"`,
      );
    }

    return this.prisma.release.update({
      where: { uuid },
      data: { status: to as any, ...extraData },
      include: { distributions: true },
    });
  }
}
