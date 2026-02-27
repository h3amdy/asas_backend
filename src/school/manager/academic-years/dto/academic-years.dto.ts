// src/school/manager/academic-years/dto/academic-years.dto.ts
import { IsArray, ArrayMinSize, IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TermInputDto {
    @IsString()
    @MinLength(2)
    name!: string;

    @IsInt()
    @Min(1)
    @Max(3)
    orderIndex!: number;

    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;
}

export class CreateYearDto {
    @IsString()
    @MinLength(4)
    @MaxLength(20)
    name!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => TermInputDto)
    terms!: TermInputDto[];
}

export class UpdateYearDto {
    @IsOptional()
    @IsString()
    @MinLength(4)
    @MaxLength(20)
    name?: string;
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

export class AddTermDto {
    @IsString()
    @MinLength(2)
    name!: string;

    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;
}
