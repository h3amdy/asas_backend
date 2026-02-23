// src/school/manager/academic-years/dto/academic-years.dto.ts
import { IsArray, IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class TermInputDto {
    @IsString()
    @MinLength(2)
    name!: string;

    @IsInt()
    @Min(1)
    @Max(3)
    orderIndex!: number;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export class CreateYearDto {
    @IsString()
    @MinLength(4)
    @MaxLength(20)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    termsCount?: number;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermInputDto)
    terms?: TermInputDto[];
}

export class UpdateYearDto {
    @IsOptional()
    @IsString()
    @MinLength(4)
    @MaxLength(20)
    name?: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export class UpdateTermDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}
