// src/school/teacher/units/dto/create-unit.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUnitDto {
    @IsString()
    @IsNotEmpty({ message: 'اسم الوحدة مطلوب' })
    @MaxLength(200)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title!: string;

    @IsInt()
    @Min(1)
    orderIndex!: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string;
}
