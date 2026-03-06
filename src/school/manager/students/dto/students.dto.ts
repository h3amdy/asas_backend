// src/school/manager/students/dto/students.dto.ts
import {
    IsDateString, IsEnum, IsInt, IsOptional, IsString,
    MaxLength, Min, MinLength, IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

// ─── SRS-STU-02: Create Student ───────────────────────────────

export class CreateStudentDto {
    @IsString()
    @MinLength(2)
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsOptional()
    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
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

    @IsString()
    @MinLength(6)
    password!: string;

    @IsInt()
    @Min(1)
    gradeId!: number;

    @IsInt()
    @Min(1)
    sectionId!: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    parentId?: number;
}

// ─── SRS-STU-04: Update Student ───────────────────────────────

export class UpdateStudentDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(100)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    displayName?: string;

    @IsOptional()
    @IsString()
    @IsEnum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })
    gender?: string;

    @IsOptional()
    @IsDateString()
    birthDate?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
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
    addressDetails?: string;
}

// ─── SRS-STU-05: Section Transfer ─────────────────────────────

export class SectionTransferDto {
    @IsInt()
    @Min(1)
    newSectionId!: number;
}

// ─── SRS-STU-06: Grade Transfer ───────────────────────────────

export class GradeTransferDto {
    @IsInt()
    @Min(1)
    newGradeId!: number;

    @IsInt()
    @Min(1)
    newSectionId!: number;
}

// ─── SRS-STU-07: Drop Enrollment ──────────────────────────────

export class DropEnrollmentDto {
    @IsString()
    @IsEnum(['DROPPED', 'TRANSFERRED_OUT', 'REPEATED'], {
        message: 'status must be DROPPED, TRANSFERRED_OUT, or REPEATED',
    })
    status!: 'DROPPED' | 'TRANSFERRED_OUT' | 'REPEATED';
}

// ─── SRS-STU-08: Re-Enroll ────────────────────────────────────

export class ReEnrollDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    gradeId?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    sectionId?: number;
}

// ─── SRS-STU-10: Reset Password ───────────────────────────────

export class ResetPasswordDto {
    @IsString()
    @MinLength(6)
    newPassword!: string;
}

// ─── SRS-STU-09: Toggle Active ────────────────────────────────

export class ToggleActiveDto {
    @IsBoolean()
    isActive!: boolean;
}
