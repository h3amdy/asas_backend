// src/school/manager/school-info/dto/update-school-info.dto.ts
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DeliveryPolicy } from '@prisma/client';
import { Transform } from 'class-transformer';

export class UpdateSchoolInfoDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    displayName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    phone?: string;

    @IsOptional()
    @IsEmail()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    province?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    district?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    addressArea?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    address?: string;

    @IsOptional()
    @IsUUID()
    logoMediaAssetUuid?: string;

    @IsOptional()
    @IsEnum(DeliveryPolicy)
    deliveryPolicy?: DeliveryPolicy;
}
