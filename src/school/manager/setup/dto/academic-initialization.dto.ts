// src/school/manager/setup/dto/academic-initialization.dto.ts
import { IsArray, ArrayMinSize, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * فصل دراسي في التهيئة — التواريخ إجبارية
 */
export class InitTermDto {
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

/**
 * السنة في التهيئة — الاسم فقط، التواريخ تُحسب من الفصول
 */
export class InitYearDto {
    @IsString()
    @MinLength(4)
    @MaxLength(20)
    name!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => InitTermDto)
    terms!: InitTermDto[];
}

/**
 * صف في التهيئة — stage إجباري للمخصص (يُتحقق في Service)
 */
export class InitGradeDto {
    @IsOptional()
    @IsInt()
    dictionaryId?: number;

    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    displayName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    shortName?: string;

    @IsInt()
    @Min(0)
    sortOrder!: number;

    @IsOptional()
    @IsEnum(['KG', 'BASIC', 'SECONDARY', 'OTHER'])
    stage?: string;
}

export class AcademicInitializationDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => InitGradeDto)
    grades!: InitGradeDto[];

    @ValidateNested()
    @Type(() => InitYearDto)
    year!: InitYearDto;
}
