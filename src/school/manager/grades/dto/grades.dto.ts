// src/school/manager/grades/dto/grades.dto.ts
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateGradeDto {
    @IsOptional()
    @IsInt()
    dictionaryId?: number;

    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    displayName!: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    shortName?: string;

    @IsInt()
    @Min(0)
    sortOrder!: number;

    @IsOptional()
    @IsBoolean()
    isLocal?: boolean;
}

export class UpdateGradeDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    displayName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    shortName?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;
}

export class CreateSectionDto {
    @IsString()
    @MinLength(1)
    @MaxLength(20)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsInt()
    @Min(1)
    orderIndex!: number;
}

export class UpdateSectionDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(20)
    name?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    orderIndex?: number;
}
