// src/school/manager/school-info/school-info.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateSchoolInfoDto } from './dto/update-school-info.dto';

@Injectable()
export class SchoolInfoService {
  constructor(private readonly prisma: PrismaService) {}

  async getSchoolInfo(schoolId: number) {
    const school = await this.prisma.school.findFirst({
      where: { id: schoolId, isDeleted: false },
      select: {
        uuid: true,
        name: true,
        displayName: true,
        schoolCode: true,
        appType: true,
        phone: true,
        email: true,
        logoMediaAssetId: true,
        logoMediaAsset: { select: { uuid: true } },
        address: true,
        province: true,
        district: true,
        addressArea: true,
        educationType: true,
        deliveryPolicy: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
      },
    });
    if (!school) throw new NotFoundException('SCHOOL_NOT_FOUND');
    return school;
  }

  async updateSchoolInfo(schoolId: number, dto: UpdateSchoolInfoDto) {
    const data: Record<string, any> = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.province !== undefined) data.province = dto.province;
    if (dto.district !== undefined) data.district = dto.district;
    if (dto.addressArea !== undefined) data.addressArea = dto.addressArea;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.deliveryPolicy !== undefined)
      data.deliveryPolicy = dto.deliveryPolicy;

    // Logo: resolve UUID → ID, or null to remove — داخل معاملة مع قفل FOR UPDATE لمنع سباق الصور الشخصية (SEC-PRF-01)
    const runInTx = async (tx: Prisma.TransactionClient) => {
      if (dto.logoMediaAssetUuid !== undefined) {
        if (dto.logoMediaAssetUuid) {
          if (typeof tx.$queryRaw === 'function') {
            await tx.$queryRaw`
              SELECT id
              FROM media_assets
              WHERE uuid = ${dto.logoMediaAssetUuid}
              FOR UPDATE
            `;
          }

          const asset = await tx.mediaAsset.findFirst({
            where: {
              uuid: dto.logoMediaAssetUuid,
              schoolId,
              ownerType: 'SCHOOL',
              isDeleted: false,
            },
          });
          if (!asset) throw new NotFoundException('LOGO_ASSET_NOT_FOUND');
          if (asset.kind === 'VIDEO') {
            throw new BadRequestException({
              code: 'VIDEO_NOT_ALLOWED_HERE',
              message: 'VIDEO assets can only be linked to lesson_block_items',
            });
          }
          // SEC-MEDIA-03: الشعار يُنشر للعامة ← صورة فقط، ولا يُربط بأصل فشلت معالجته
          if (asset.kind !== 'IMAGE' || asset.processingStatus === 'ERROR') {
            throw new BadRequestException({
              code: 'IMAGE_REQUIRED',
              message: 'School logo must be a valid IMAGE asset',
            });
          }

          // SEC-PRF-01: منع ربط الصورة الشخصية لمستخدم كشعار مدرسة
          const txWithUser = tx as unknown as {
            user?: {
              count?: (args: {
                where: { avatarMediaAssetId: number };
              }) => Promise<number>;
            };
          };
          if (typeof txWithUser.user?.count === 'function') {
            const avatarUsageCount = await txWithUser.user.count({
              where: { avatarMediaAssetId: asset.id },
            });
            if (avatarUsageCount > 0) {
              throw new BadRequestException({
                code: 'AVATAR_ASSET_IN_USE',
                error: 'AVATAR_ASSET_IN_USE',
                message: 'Cannot link a user profile avatar as the school logo',
              });
            }
          }

          data.logoMediaAssetId = asset.id;
        } else {
          // null → remove logo
          data.logoMediaAssetId = null;
        }
      }

      await tx.school.update({ where: { id: schoolId }, data });
    };

    if (typeof this.prisma.$transaction === 'function') {
      await this.prisma.$transaction(runInTx, {
        timeout: 15_000,
        maxWait: 10_000,
      });
    } else {
      await runInTx(this.prisma as unknown as Prisma.TransactionClient);
    }

    return this.getSchoolInfo(schoolId);
  }
}
