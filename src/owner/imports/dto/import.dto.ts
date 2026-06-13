// src/owner/imports/dto/import.dto.ts
import {
    IsString, IsArray, IsOptional, IsEnum,
    ValidateNested, IsObject, MinLength, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Student Import DTOs ──────────────────────────────────────

class StudentParentDto {
    @IsString()
    @MinLength(2)
    name!: string;

    @IsString()
    phone!: string;

    @IsOptional()
    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
    gender?: string;
}

class StudentRecordDto {
    @IsString()
    @MinLength(2)
    @MaxLength(100)
    student_name!: string;

    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
    gender!: string;

    @IsString()
    grade_code!: string;

    @IsString()
    section!: string;

    @IsOptional()
    @IsString()
    birth_date?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => StudentParentDto)
    parent?: StudentParentDto;
}

export class PreviewStudentsImportDto {
    @IsString()
    _schema!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StudentRecordDto)
    students!: StudentRecordDto[];
}

// ─── Teacher Import DTOs ──────────────────────────────────────

class TeacherAssignmentDto {
    @IsString()
    subject_code!: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    sections?: string[];
}

class TeacherRecordDto {
    @IsString()
    @MinLength(2)
    @MaxLength(100)
    teacher_name!: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
    gender!: string;

    @IsOptional()
    @IsString()
    specialization?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TeacherAssignmentDto)
    assignments?: TeacherAssignmentDto[];
}

export class PreviewTeachersImportDto {
    @IsString()
    _schema!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TeacherRecordDto)
    teachers!: TeacherRecordDto[];
}
