// src/school/manager/students/dto/students.dto.ts
import {
    IsDateString, IsEnum, IsInt, IsOptional, IsString,
    MaxLength, Min, MinLength, IsBoolean,
} from 'class-validator';
import {
    PersonName, OptionalPersonPhone, PersonGender, PersonEmail, PERSON,
} from '../../../../shared/validation/person';

// ─── SRS-STU-02: Create Student ───────────────────────────────

export class CreateStudentDto {
    @PersonName()
    name!: string;

    @IsOptional()
    @PersonGender()
    gender?: string;

    @IsOptional()
    @IsDateString()
    birthDate?: string;

    @OptionalPersonPhone()
    phone?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.PROVINCE_MAX)
    province?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.DISTRICT_MAX)
    district?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.ADDRESS_AREA_MAX)
    addressArea?: string;

    @IsString()
    @MinLength(PERSON.PASSWORD_MIN)
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
    @PersonName()
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.NAME_MAX)
    displayName?: string;

    @IsOptional()
    @PersonGender()
    gender?: string;

    @IsOptional()
    @IsDateString()
    birthDate?: string;

    @OptionalPersonPhone()
    phone?: string;

    @IsOptional()
    @PersonEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.PROVINCE_MAX)
    province?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.DISTRICT_MAX)
    district?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.ADDRESS_AREA_MAX)
    addressArea?: string;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.ADDRESS_DETAILS_MAX)
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
    @MinLength(PERSON.PASSWORD_MIN)
    newPassword!: string;
}

// ─── SRS-STU-09: Toggle Active ────────────────────────────────

export class ToggleActiveDto {
    @IsBoolean()
    isActive!: boolean;
}
