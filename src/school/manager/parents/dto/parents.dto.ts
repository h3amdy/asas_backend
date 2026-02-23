// src/school/manager/parents/dto/parents.dto.ts
import { IsArray, IsEmail, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateParentDto {
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsString()
    @MinLength(6)
    @MaxLength(20)
    phone!: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    province?: string;

    @IsOptional()
    @IsString()
    district?: string;

    @IsOptional()
    @IsString()
    addressArea?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;
}

export class UpdateParentDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    name?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    @MaxLength(20)
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    province?: string;

    @IsOptional()
    @IsString()
    district?: string;

    @IsOptional()
    @IsString()
    addressArea?: string;
}

export class LinkChildrenDto {
    @IsArray()
    @IsInt({ each: true })
    studentUserIds!: number[];
}
