// src/school/manager/students/dto/students.dto.ts
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateStudentDto {
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsOptional()
    @IsString()
    gender?: string;

    @IsOptional()
    @IsDateString()
    birthDate?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
    province?: string;

    @IsOptional()
    @IsString()
    district?: string;

    @IsOptional()
    @IsString()
    addressArea?: string;

    @IsInt()
    @Min(1)
    gradeId!: number;

    @IsInt()
    @Min(1)
    sectionId!: number;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;
}

export class UpdateStudentDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    name?: string;

    @IsOptional()
    @IsString()
    gender?: string;

    @IsOptional()
    @IsDateString()
    birthDate?: string;

    @IsOptional()
    @IsString()
    phone?: string;

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

export class TransferStudentDto {
    @IsInt()
    @Min(1)
    gradeId!: number;

    @IsInt()
    @Min(1)
    sectionId!: number;
}
