// src/owner/imports/dto/import.dto.ts
import {
    IsString, IsArray, IsOptional, IsEnum,
    ValidateNested, MinLength, MaxLength, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════════════════
//  Student Import DTOs
// ═══════════════════════════════════════════════════════════════════════════

class StudentParentDto {
    // ─── النهج ج: يقبل كلا الصيغتين ────────────────────────────
    // صيغة 1: name (اسم واحد كامل)
    @IsOptional()
    @IsString()
    name?: string;

    // صيغة 2: أسماء مجزأة (تُجمع في الـ Service)
    @IsOptional()
    @IsString()
    first_name?: string;

    @IsOptional()
    @IsString()
    second_name?: string;

    @IsOptional()
    @IsString()
    last_name?: string;

    @IsString()
    @Matches(/^7\d{8}$/, { message: 'رقم هاتف ولي الأمر يجب أن يكون 9 أرقام ويبدأ بـ 7' })
    phone!: string;

    @IsOptional()
    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
    gender?: string;

    @IsOptional()
    @IsString()
    relationship?: string;
}

class StudentRecordDto {
    // ─── النهج ج: يقبل كلا الصيغتين ────────────────────────────
    // صيغة 1: student_name (اسم واحد كامل)
    @IsOptional()
    @IsString()
    @MaxLength(100)
    student_name?: string;

    // صيغة 2: أسماء مجزأة (تُجمع في الـ Service)
    @IsOptional()
    @IsString()
    first_name?: string;

    @IsOptional()
    @IsString()
    second_name?: string;

    @IsOptional()
    @IsString()
    third_name?: string;

    @IsOptional()
    @IsString()
    last_name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^7\d{8}$/, { message: 'رقم الهاتف يجب أن يكون 9 أرقام ويبدأ بـ 7' })
    phone?: string;

    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
    gender!: string;

    @IsString()
    grade_code!: string;

    // يقبل section أو section_name
    @IsOptional()
    @IsString()
    section?: string;

    @IsOptional()
    @IsString()
    section_name?: string;

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

// ═══════════════════════════════════════════════════════════════════════════
//  Teacher Import DTOs
// ═══════════════════════════════════════════════════════════════════════════

class TeacherAssignmentDto {
    @IsString()
    subject_code!: string;

    // يقبل sections (مصفوفة) أو section_name (نص واحد)
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    sections?: string[];

    @IsOptional()
    @IsString()
    section_name?: string;

    @IsOptional()
    @IsString()
    @IsEnum(['PRIMARY', 'ASSISTANT'], { message: 'role must be PRIMARY or ASSISTANT' })
    role?: string;
}

class TeacherRecordDto {
    // ─── النهج ج: يقبل كلا الصيغتين ────────────────────────────
    // صيغة 1: teacher_name (اسم واحد كامل)
    @IsOptional()
    @IsString()
    @MaxLength(100)
    teacher_name?: string;

    // صيغة 2: أسماء مجزأة
    @IsOptional()
    @IsString()
    first_name?: string;

    @IsOptional()
    @IsString()
    second_name?: string;

    @IsOptional()
    @IsString()
    third_name?: string;

    @IsOptional()
    @IsString()
    last_name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^7\d{8}$/, { message: 'رقم الهاتف يجب أن يكون 9 أرقام ويبدأ بـ 7' })
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
