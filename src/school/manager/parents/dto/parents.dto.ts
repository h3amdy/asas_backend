// src/school/manager/parents/dto/parents.dto.ts
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
    PersonName, PersonPhone, PersonGender, PersonEmail, PERSON,
} from '../../../../shared/validation/person';

// ─── SRS-PAR-02: Create Parent ────────────────────────────

export class CreateParentDto {
    // ── البيانات الشخصية (users) ──

    @PersonName()
    name!: string;

    @IsOptional()
    @PersonGender()
    gender?: string;

    @PersonPhone()
    phone!: string;

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
}

// ─── SRS-PAR-04: Update Parent ────────────────────────────

export class UpdateParentDto {
    @IsOptional()
    @PersonName()
    name?: string;

    @IsOptional()
    @PersonGender()
    gender?: string;

    @IsOptional()
    @PersonPhone()
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
}

// ─── SRS-PAR-08: Link Children ────────────────────────────

export class LinkChildrenDto {
    @IsArray()
    @IsString({ each: true })
    studentUuids!: string[];
}

// ─── SRS-PAR-06: Reset Password ───────────────────────────

export class ResetPasswordDto {
    @IsOptional()
    @IsString()
    @MinLength(PERSON.PASSWORD_MIN)
    password?: string;
}

// ─── SRS-PAR-05: Toggle Active ────────────────────────────

export class ToggleActiveDto {
    @IsBoolean()
    isActive!: boolean;
}
