import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckUpdateDto } from '../dto/check-update.dto';

export interface CheckUpdateResponse {
  updateAvailable: boolean;
  updatePolicy: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  latestVersion: string | null;
  latestBuild: number | null;
  minimumBuild: number | null;
  releaseNotes: string | null;
  download: {
    url: string;
    fileSize: number | null;
    checksum: string | null;
  } | null;
}

@Injectable()
export class UpdateCheckService {
  private readonly logger = new Logger(UpdateCheckService.name);

  constructor(private prisma: PrismaService) {}

  async checkUpdate(dto: CheckUpdateDto): Promise<CheckUpdateResponse> {
    // 1. البحث عن التطبيق
    const app = await this.prisma.app.findUnique({
      where: { code: dto.appCode },
    });

    if (!app || app.isDeleted || app.status !== 'ACTIVE') {
      // تطبيق غير مسجل — لا يوجد تحديث
      await this._upsertDevice(dto, null, null);
      return this._noUpdate();
    }

    // 2. البحث عن تعيين مدرسة محدد (SchoolReleaseAssignment)
    let targetRelease = await this._findSchoolAssignment(dto.schoolCode, dto.platform);

    // 3. إذا لم يُوجد تعيين — جلب آخر إصدار منشور
    if (!targetRelease) {
      targetRelease = await this.prisma.release.findFirst({
        where: {
          appId: app.id,
          status: 'PUBLISHED',
          channel: 'STABLE',
          isDeleted: false,
        },
        orderBy: { versionCode: 'desc' },
        include: {
          distributions: {
            where: {
              isEnabled: true,
              platform: dto.platform as any,
            },
            take: 1,
          },
        },
      });
    }

    // 4. لا يوجد إصدار منشور
    if (!targetRelease) {
      await this._upsertDevice(dto, app.id, null);
      return this._noUpdate();
    }

    // 5. Upsert الجهاز
    await this._upsertDevice(dto, app.id, targetRelease.id);

    // 6. المقارنة وتحديد سياسة التحديث
    const currentBuild = dto.currentBuild;
    const latestBuild = targetRelease.versionCode;

    // الجهاز محدّث
    if (currentBuild >= latestBuild) {
      return this._noUpdate();
    }

    // تحديد السياسة
    let updatePolicy: 'OPTIONAL' | 'REQUIRED' = targetRelease.updatePolicy as any;

    // إذا الإصدار الحالي أقل من الحد الأدنى المدعوم → إجباري بالقوة
    if (
      targetRelease.minimumSupportedVersionCode &&
      currentBuild < targetRelease.minimumSupportedVersionCode
    ) {
      updatePolicy = 'REQUIRED';
    }

    // البحث عن رابط التحميل
    const distribution = targetRelease.distributions?.[0] || null;

    return {
      updateAvailable: true,
      updatePolicy,
      latestVersion: targetRelease.versionName,
      latestBuild: targetRelease.versionCode,
      minimumBuild: targetRelease.minimumSupportedVersionCode,
      releaseNotes: targetRelease.releaseNotesAr,
      download: distribution
        ? {
            url: distribution.downloadUrl,
            fileSize: distribution.fileSize
              ? Number(distribution.fileSize)
              : null,
            checksum: targetRelease.checksum,
          }
        : null,
    };
  }

  // ── إيجاد تعيين مدرسة محدد ────────────────────────────────────────────
  private async _findSchoolAssignment(schoolCode?: number, platform?: string) {
    if (!schoolCode) return null;

    const school = await this.prisma.school.findUnique({
      where: { schoolCode },
      select: { id: true },
    });
    if (!school) return null;

    const assignment = await this.prisma.schoolReleaseAssignment.findFirst({
      where: {
        schoolId: school.id,
        isActive: true,
        release: {
          isDeleted: false,
          status: { in: ['PUBLISHED', 'TESTING'] },
        },
      },
      orderBy: { assignedAt: 'desc' },
      include: {
        release: {
          include: {
            distributions: {
              where: {
                isEnabled: true,
                ...(platform ? { platform: platform as any } : {}),
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!assignment) return null;
    return assignment.release;
  }

  // ── تسجيل/تحديث الجهاز (Heartbeat ضمني) ──────────────────────────────
  private async _upsertDevice(dto: CheckUpdateDto, appId: number | null, releaseId: number | null) {
    try {
      // البحث عن المدرسة بالكود
      let schoolId: number | null = null;
      if (dto.schoolCode) {
        const school = await this.prisma.school.findUnique({
          where: { schoolCode: dto.schoolCode },
          select: { id: true },
        });
        schoolId = school?.id || null;
      }

      await this.prisma.deviceInstallation.upsert({
        where: { installationId: dto.installationId },
        create: {
          installationId: dto.installationId,
          platform: dto.platform as any,
          appId,
          appCode: dto.appCode,
          packageName: dto.packageName,
          currentVersion: dto.currentVersion,
          currentBuild: dto.currentBuild,
          releaseId,
          osVersion: dto.osVersion,
          deviceModel: dto.deviceModel,
          schoolId,
        },
        update: {
          currentVersion: dto.currentVersion,
          currentBuild: dto.currentBuild,
          platform: dto.platform as any,
          packageName: dto.packageName,
          appId,
          releaseId,
          osVersion: dto.osVersion,
          deviceModel: dto.deviceModel,
          schoolId,
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      // تسجيل الجهاز لا يجب أن يمنع فحص التحديث
      this.logger.warn(`Failed to upsert device: ${error.message}`);
    }
  }

  // ── رد "لا يوجد تحديث" ────────────────────────────────────────────────
  private _noUpdate(): CheckUpdateResponse {
    return {
      updateAvailable: false,
      updatePolicy: 'NONE',
      latestVersion: null,
      latestBuild: null,
      minimumBuild: null,
      releaseNotes: null,
      download: null,
    };
  }
}
