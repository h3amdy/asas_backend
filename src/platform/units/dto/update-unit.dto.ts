// src/school/teacher/units/dto/update-unit.dto.ts
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUnitDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    orderIndex?: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string;
}
