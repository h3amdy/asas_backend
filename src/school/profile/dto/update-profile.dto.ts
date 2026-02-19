// src/school/profile/dto/update-profile.dto.ts
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO لتعديل الملف الشخصي
 * جميع الحقول اختيارية — فقط الحقول المُرسلة يتم تحديثها
 */
export class UpdateProfileDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(50)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    displayName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    gender?: string;

    @IsOptional()
    @IsEmail()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    province?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    district?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    addressArea?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    addressDetails?: string;
}
