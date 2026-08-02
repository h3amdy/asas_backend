// src/school/manager/teachers/dto/teachers.dto.ts
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
    PersonName, OptionalPersonPhone, PersonGender, PersonEmail, PERSON,
} from '../../../../shared/validation/person';
import { TEACHER } from '../../../../shared/validation/teacher/teacher.constants';

// ─── SRS-TCH-02: Create Teacher ───────────────────────────

export class CreateTeacherDto {
    // ── البيانات الشخصية (users) ──

    @PersonName()
    name!: string;

    @PersonGender()
    gender!: string;

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
    @MinLength(PERSON.PASSWORD_MIN)
    password?: string;

    // ── البيانات المهنية (teachers) ──

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.SPECIALIZATION_MAX)
    specialization?: string;

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.QUALIFICATION_MAX)
    qualification?: string;

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.EXPERIENCE_MAX)
    experience?: string;

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.NOTES_MAX)
    notes?: string;
}

// ─── SRS-TCH-04: Update Teacher ───────────────────────────

export class UpdateTeacherDto {
    // ── البيانات الشخصية (users) ──

    @IsOptional()
    @PersonName()
    name?: string;

    @IsOptional()
    @PersonGender()
    gender?: string;

    @OptionalPersonPhone()
    phone?: string;

    @IsOptional()
    @PersonEmail()
    email?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.PROVINCE_MAX)
    province?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.DISTRICT_MAX)
    district?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(PERSON.ADDRESS_AREA_MAX)
    addressArea?: string | null;

    // ── البيانات المهنية (teachers) ──

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.SPECIALIZATION_MAX)
    specialization?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.QUALIFICATION_MAX)
    qualification?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.EXPERIENCE_MAX)
    experience?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(TEACHER.NOTES_MAX)
    notes?: string | null;
}

// ─── SRS-TCH-05: Reset Password ──────────────────────────

export class ResetPasswordDto {
    @IsOptional()
    @IsString()
    @MinLength(PERSON.PASSWORD_MIN)
    newPassword?: string;
}

// ─── SRS-TCH-07: Toggle Active ───────────────────────────

export class ToggleActiveDto {
    @IsBoolean()
    isActive!: boolean;
}
