// src/school/manager/teachers/dto/teachers.dto.ts
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// ─── SRS-TCH-02: Create Teacher ───────────────────────────

export class CreateTeacherDto {
    // ── البيانات الشخصية (users) ──

    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsString()
    @IsIn(['MALE', 'FEMALE'])
    gender!: string;

    @IsString()
    @MinLength(6)
    @MaxLength(20)
    phone!: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    province?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    district?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    addressArea?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;

    // ── البيانات المهنية (teachers) ──

    @IsOptional()
    @IsString()
    @MaxLength(100)
    specialization?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    qualification?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    experience?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string;
}

// ─── SRS-TCH-04: Update Teacher ───────────────────────────

export class UpdateTeacherDto {
    // ── البيانات الشخصية (users) ──

    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name?: string;

    @IsOptional()
    @IsString()
    @IsIn(['MALE', 'FEMALE'])
    gender?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    @MaxLength(20)
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    province?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    district?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    addressArea?: string | null;

    // ── البيانات المهنية (teachers) ──

    @IsOptional()
    @IsString()
    @MaxLength(100)
    specialization?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    qualification?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    experience?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string | null;
}

// ─── SRS-TCH-05: Reset Password ──────────────────────────

export class ResetPasswordDto {
    @IsOptional()
    @IsString()
    @MinLength(6)
    newPassword?: string;
}

// ─── SRS-TCH-07: Toggle Active ───────────────────────────

export class ToggleActiveDto {
    @IsBoolean()
    isActive!: boolean;
}
