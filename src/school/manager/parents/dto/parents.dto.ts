// src/school/manager/parents/dto/parents.dto.ts
import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// ─── SRS-PAR-02: Create Parent ────────────────────────────

export class CreateParentDto {
    // ── البيانات الشخصية (users) ──

    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsOptional()
    @IsString()
    @IsIn(['MALE', 'FEMALE'])
    gender?: string;

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
}

// ─── SRS-PAR-04: Update Parent ────────────────────────────

export class UpdateParentDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name?: string;

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
}

// ─── SRS-PAR-08: Link Children ────────────────────────────

export class LinkChildrenDto {
    @IsArray()
    @IsInt({ each: true })
    studentUserIds!: number[];
}

// ─── SRS-PAR-06: Reset Password ───────────────────────────

export class ResetPasswordDto {
    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;
}

// ─── SRS-PAR-05: Toggle Active ────────────────────────────

export class ToggleActiveDto {
    @IsBoolean()
    isActive!: boolean;
}
