import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  /** نظرة عامة على النظام */
  async overview() {
    const [totalApps, totalReleases, totalDevices, publishedReleases] =
      await Promise.all([
        this.prisma.app.count({ where: { isDeleted: false } }),
        this.prisma.release.count({ where: { isDeleted: false } }),
        this.prisma.deviceInstallation.count(),
        this.prisma.release.count({
          where: { isDeleted: false, status: 'PUBLISHED' },
        }),
      ]);

    // توزيع الأجهزة حسب المنصة
    const devicesByPlatform = await this.prisma.deviceInstallation.groupBy({
      by: ['platform'],
      _count: { id: true },
    });

    return {
      totalApps,
      totalReleases,
      publishedReleases,
      totalDevices,
      devicesByPlatform: devicesByPlatform.map((d) => ({
        platform: d.platform,
        count: d._count.id,
      })),
    };
  }

  /** توزيع الأجهزة حسب الإصدار لتطبيق معين */
  async devicesByVersion(appUuid: string) {
    const app = await this.prisma.app.findUnique({
      where: { uuid: appUuid },
    });
    if (!app || app.isDeleted) {
      throw new NotFoundException('التطبيق غير موجود');
    }

    const devices = await this.prisma.deviceInstallation.groupBy({
      by: ['currentVersion', 'currentBuild', 'platform'],
      where: { appCode: app.code },
      _count: { id: true },
      orderBy: { currentBuild: 'desc' },
    });

    const total = devices.reduce((sum, d) => sum + d._count.id, 0);

    return {
      appCode: app.code,
      appName: app.name,
      totalDevices: total,
      versions: devices.map((d) => ({
        version: d.currentVersion,
        build: d.currentBuild,
        platform: d.platform,
        count: d._count.id,
        percentage: total > 0 ? ((d._count.id / total) * 100).toFixed(1) : '0',
      })),
    };
  }
}
