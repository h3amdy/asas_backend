// src/school/manager/school-info/school-info.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateSchoolInfoDto } from './dto/update-school-info.dto';

@Injectable()
export class SchoolInfoService {
    constructor(private readonly prisma: PrismaService) { }

    async getSchoolInfo(schoolId: number) {
        const school = await this.prisma.school.findFirst({
            where: { id: schoolId, isDeleted: false },
            select: {
                uuid: true, name: true, displayName: true, schoolCode: true, appType: true,
                phone: true, email: true,
                logoMediaAssetId: true,
                logoMediaAsset: { select: { uuid: true } },
                address: true, province: true, district: true, addressArea: true,
                educationType: true, deliveryPolicy: true,
                primaryColor: true, secondaryColor: true, backgroundColor: true,
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
        if (dto.deliveryPolicy !== undefined) data.deliveryPolicy = dto.deliveryPolicy;

        // Logo: resolve UUID → ID, or null to remove
        if (dto.logoMediaAssetUuid !== undefined) {
            if (dto.logoMediaAssetUuid) {
                const asset = await this.prisma.mediaAsset.findFirst({
                    where: { uuid: dto.logoMediaAssetUuid, schoolId, isDeleted: false },
                });
                if (!asset) throw new NotFoundException('LOGO_ASSET_NOT_FOUND');
                data.logoMediaAssetId = asset.id;
            } else {
                // null → remove logo
                data.logoMediaAssetId = null;
            }
        }

        await this.prisma.school.update({ where: { id: schoolId }, data });
        return this.getSchoolInfo(schoolId);
    }
}

